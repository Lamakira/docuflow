# syntax=docker/dockerfile:1

####
# The one image both runtimes ship from (#25, ADR-0016).
#
# By default it runs the HTTP server. The Phase 3 worker will be this same image
# started with a different command, so the entry point is a CMD and not an
# ENTRYPOINT: `docker run <image> node dist/something-else.cjs` replaces it
# without rebuilding, and the two runtimes stay one digest apart from nothing.
#
# `node dist/migrate.mjs` is the first command to use that (#35): the migration
# runner ADR-0016 makes a gated pre-deploy step, run against the same image the
# service runs, so no host needs a checkout to apply the schema.
#
# The image holds no configuration. Every setting arrives as an environment
# variable read by `server/config.ts` and nowhere else (#22), which refuses to
# boot naming each one it is short of — so a misconfigured container fails in its
# first second with a list, rather than on the first request that needed it.
# `docs/CONTAINER.md` has the run recipe; `.env.example` lists the variables.
####

# Debian rather than Alpine: bcrypt and sharp publish prebuilt binaries for
# glibc, and building them from source would mean a C toolchain and a Python in
# a stage whose whole job is to install dependencies.
#
# This exact version is what `.github/workflows/ci.yml` pins its `node-version`
# to, so the tree is typechecked, built, and tested on the Node it ships on.
# Bump both together — #38 owns collapsing the two copies into one.
ARG NODE_VERSION=22.21.1-bookworm-slim

####
# Stage 1: the dependency manifest, shared by both install stages.
####
FROM node:${NODE_VERSION} AS base

WORKDIR /app

# package-lock.json was written by npm 11, which leaves the esbuild peer of
# vitest's nested vite for the installer to resolve; the npm 10 bundled with node
# 22 rejects that as "Missing: @esbuild/...@0.28.1 from lock file". CI installs
# npm 11 for the same reason — keep the two in step.
#
# Temporary (ADR-0017): #38 owns removing this, gated on `npm ci` succeeding on
# the npm this base image already ships.
RUN npm install --global npm@11

# `playwright`'s postinstall downloads a browser set into whichever stage runs
# `npm ci`. Neither of the two that do ships anything but files it is asked for —
# the build stage emits `dist/`, the install stage a `node_modules` — so a
# browser downloaded here is one nothing ever launches.
#
# The image does carry a browser (#37): the runtime stage installs the one the
# scraper opens, and that is the copy that ships. This skip is what keeps it from
# being downloaded twice more to ship once.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./

####
# Stage 2: the build. Needs the full tree, which since #36 is most of the
# manifest: the toolchain (vite, esbuild, typescript) and every package the
# client bundle is built from are all devDependencies. Nothing here ships.
####
FROM base AS build

RUN --mount=type=cache,target=/root/.npm npm ci

# Listed file by file rather than `COPY . .` so that editing a doc, a test, or
# the desktop agent does not invalidate this layer.
COPY tsconfig.json vite.config.ts tailwind.config.ts postcss.config.js ./
COPY client ./client
COPY server ./server
COPY shared ./shared
# One letter apart and both required: `script/` is the build itself,
# `scripts/` holds the operational commands, one of which is now built too.
#
# From `scripts/` only what dist/migrate.mjs is built from. The rest of that
# directory is release and upload tooling that no build reads, and copying it
# whole would invalidate this layer — and the `npm run build` below it — every
# time one of those scripts is edited, which is the same thing the file-by-file
# list above exists to avoid.
COPY script ./script
COPY scripts/migrate.ts ./scripts/
COPY scripts/lib ./scripts/lib

# Writes dist/public (the client bundle, served by server/static.ts from
# `<dist>/public`), dist/index.cjs (the server), and dist/migrate.mjs (the
# migration runner, #35).
RUN npm run build

####
# Stage 3: the runtime dependency tree, installed separately so the devDependency
# half never reaches the final image.
####
FROM base AS runtime-deps

# `script/bundles.ts` bundles a short allowlist into dist/index.cjs and marks
# every other dependency external, so the server still resolves some of its
# imports from node_modules at runtime. This tree is not optional — it is just
# small now (#36): `dependencies` holds exactly what the bundle leaves external,
# derived from the build's metafile and checked by
# `tests/smoke/server-bundle.test.ts`, so what the client is built from no
# longer arrives here to be installed and never opened.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

####
# Stage 4: what ships.
####
FROM node:${NODE_VERSION} AS runtime

WORKDIR /app

# The production build already replaced `process.env.NODE_ENV` with a literal
# inside the bundle; this is for everything that reads it at runtime — express,
# the drivers, and any command that overrides the CMD.
ENV NODE_ENV=production

# server/config.ts defaults to 5000 when PORT is unset, and the server binds
# 0.0.0.0, so a host that injects its own PORT is served by the same image.
ENV PORT=5000
EXPOSE 5000

# Unprivileged from the start: the node images ship a `node` user, and nothing
# here writes outside /tmp.
COPY --chown=node:node --from=runtime-deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./

# The browser the transcript scraper opens (#37), installed by the `playwright`
# that just arrived in node_modules — so the build that lands is the one this
# exact library version asks for, and the version is not written down a second
# time here to drift from it.
#
# Ahead of the `dist` copy below deliberately. This layer is ~590 MB and changes
# with the lockfile; `dist` changes on every commit, and behind it every commit
# would download Chromium again.
#
# `--with-deps` is the apt half: the shared libraries a slim Debian does not
# ship (~325 MB, which is also why this cannot be a `COPY` from another stage).
# `--only-shell` is the browser half, and it is the half that runs — a headless
# `chromium.launch()` opens Chromium's headless shell, so the full browser that
# `install chromium` would put beside it is ~360 MB this image never starts. What
# does come with the shell is ffmpeg, for recording video that nothing here
# records.
#
# PLAYWRIGHT_BROWSERS_PATH puts it where the `node` user can reach it. The
# default is the installing user's home cache, and the user installing here is
# root; it is also what `server/browser-transcript.ts` relies on to name no path
# of its own.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps --only-shell chromium \
  && rm -rf /ms-playwright/ffmpeg-* /var/lib/apt/lists/* \
  && chmod -R a+rX /ms-playwright

COPY --chown=node:node --from=build /app/dist ./dist

# The journal, from the context rather than the build: nothing compiles it, and
# dist/migrate.mjs reads the `.sql` files at runtime from `<its own dir>/../
# migrations` — so /app/migrations is exactly where it looks. Copied whole,
# `legacy/` and `meta/` included, so the image's journal is the checkout's and
# there is no second answer to what "the journal" is.
COPY --chown=node:node migrations ./migrations

USER node

# `/health` answers before authentication and touches nothing, which is what
# makes it safe to call every 30 seconds forever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.cjs"]
