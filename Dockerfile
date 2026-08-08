# syntax=docker/dockerfile:1

####
# The one image both runtimes ship from (#25, ADR-0016).
#
# Today it runs the HTTP server. The Phase 3 worker will be this same image
# started with a different command, so the entry point is a CMD and not an
# ENTRYPOINT: `docker run <image> node dist/something-else.cjs` replaces it
# without rebuilding, and the two runtimes stay one digest apart from nothing.
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

# `playwright` ships a postinstall that downloads ~400 MB of browsers. The
# transcript scraper that uses it launches Chromium from a hard-coded Replit Nix
# path (`server/browser-transcript.ts:4`), so a browser here would not be the one
# it looks for: the feature is inoperable in a container either way, and paying
# for the download would only hide that.
#
# Temporary (ADR-0017): #37 owns removing this, gated on that launch path no
# longer naming a machine — at which point whether the image carries a browser
# becomes a real decision instead of a moot one.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./

####
# Stage 2: the build. Needs the full tree — vite, esbuild, and typescript are all
# devDependencies.
####
FROM base AS build

RUN --mount=type=cache,target=/root/.npm npm ci

# Listed file by file rather than `COPY . .` so that editing a doc, a test, or
# the desktop agent does not invalidate this layer.
COPY tsconfig.json vite.config.ts tailwind.config.ts postcss.config.js ./
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY script ./script

# Writes dist/public (the client bundle, served by server/static.ts from
# `<dist>/public`) and dist/index.cjs (the server).
RUN npm run build

####
# Stage 3: the runtime dependency tree, installed separately so the devDependency
# half never reaches the final image.
####
FROM base AS runtime-deps

# `script/build.ts` bundles a short allowlist into dist/index.cjs and marks every
# other dependency external, so the server still resolves most of its imports
# from node_modules at runtime. This tree is not optional.
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
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

# `/health` answers before authentication and touches nothing, which is what
# makes it safe to call every 30 seconds forever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.cjs"]
