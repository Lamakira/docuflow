# The container

One image, both runtimes (ADR-0016). By default it runs the HTTP server; the
Phase 3 worker will be this same image started with a different command. That is
why the [`Dockerfile`](../Dockerfile) ends in a `CMD` rather than an
`ENTRYPOINT` — `docker run <image> <other command>` replaces it without a
rebuild — and why the image carries no configuration of its own.

The migration runner is the first command to use that (#35): `node
dist/migrate.mjs` applies the journal from inside the image, so the gated
pre-deploy step ADR-0016 requires runs against the same digest the service does.

## Build

```bash
docker build -t docuflow .
```

Four stages: a shared base holding the dependency manifest, a build stage with
the full dependency tree (the toolchain and everything the client is built from
are devDependencies), a second install stage that resolves the runtime tree only,
and the runtime image that copies `dist/`, those runtime dependencies, and
`migrations/` in. Nothing from the build stage's toolchain ships.

`npm run build` writes three things: `dist/public` (the client), `dist/index.cjs`
(the server), and `dist/migrate.mjs` (the migration runner). The runner is ESM
where the server is CJS, because it resolves the journal beside itself with
`import.meta.url` — a value esbuild's `cjs` format leaves empty.

### What the image installs

`dependencies` is the server's runtime tree and nothing else, derived rather
than chosen. `script/bundles.ts` inlines a short allowlist into
`dist/index.cjs` and marks every other package external, so what the runtime
stage has to install is exactly what the bundle left external. The build emits
an esbuild `metafile` saying what that is, and
[`tests/smoke/server-bundle.test.ts`](../tests/smoke/server-bundle.test.ts)
holds the manifest to it in both directions: nothing imported that is missing,
nothing installed that is never imported.

Everything else is a devDependency, the client's entire dependency set included.
The build stage installs the full tree, so `dist/public` is built from exactly
the packages it was before — they simply stop being installed a second time into
a runtime that only ever serves them pre-bundled. That is what took the image
from 1.17 GB to 676 MB (#36), and `node_modules` inside it from 655 MB to
259 MB.

Three kinds of entry sit outside that derivation:

- **Imports never reached in production.** `vite` and the two plugins
  `vite.config.ts` loads are imports of the bundle, because `server/index.ts`
  dynamic-imports `./vite` when it is not production. esbuild keeps a dynamic
  import lazy, so the `require` is emitted and never runs — `serveStatic` is
  what answers under `NODE_ENV=production`. The smoke test lists them, with that
  reason.
- **Optional native speedups.** `ws` is bundled and `require`s `bufferutil` and
  `utf-8-validate` inside a try/catch. `utf-8-validate` is declared nowhere, so
  it is absent and `ws` falls back to its JavaScript implementation.
  `bufferutil` is an `optionalDependencies` entry, which `npm ci --omit=dev`
  installs — `--omit=dev` omits the dev half and nothing else — so it is
  external for the same reason every other installed package is. Bundling it
  would inline node-gyp-build with it and move the prebuild lookup to `dist/`,
  where it throws inside that same try/catch: the image would carry the speedup,
  `ws` would fall back anyway, and nothing would say so.
- **Imports the build cannot see.** None today. `sharp` looked like one —
  `server/agentRoutes.ts` loads it as `await import("sharp" as any)` so that a
  missing libvips degrades to storing raw PNGs instead of failing boot — but the
  cast is TypeScript's and esbuild reads through it to a string literal. A
  specifier assembled at runtime would be invisible, and would have to be carried
  by hand in the smoke test's `CARRIED_BY_HAND` with a note saying where it is.

What the derivation cannot prove is that a declared package *loads*: `sharp`
wants libvips, `bcrypt` a prebuilt binary for this glibc and this Node. CI
imports every `dependencies` entry inside the built image, which is where that
half is answered — see below.

`.dockerignore` is an allow-list: everything is excluded, then the files the
build actually opens are added back. The repository holds a gigabyte of
desktop-agent build output that no server build reads, and a deny-list would
have to keep growing to stay ahead of it. **A new top-level input to the build
needs a line in `.dockerignore` as well as a `COPY` in the `Dockerfile`** — the
`COPY` then fails loudly rather than the file silently going missing.

## Run

The image reads every setting from the environment, resolved by
[`server/config.ts`](../server/config.ts) and nowhere else. A container short of
a required variable stops in its first second, naming all of them at once —
`docs/CONFIGURATION.md` lists what each one is and `.env.example` is the
template.

The schema is not applied by boot. Boot reads the database and never changes it
(#24), so the journal is applied first, by its own command, against the same
database — see `migrations/README.md`. From a checkout that is
`npm run db:migrate`; from the image it is `node dist/migrate.mjs`, which is
what a host with no checkout runs.

```bash
# Schema first. --status and --dry-run change nothing, ledger included, so
# either is safe to point at a database you are only asking about.
docker run --rm \
  -e DATABASE_URL=postgresql://user:password@host:5432/docuflow \
  docuflow node dist/migrate.mjs --status

docker run --rm \
  -e DATABASE_URL=postgresql://user:password@host:5432/docuflow \
  docuflow node dist/migrate.mjs

docker run --rm -p 5000:5000 \
  -e DATABASE_URL=postgresql://user:password@host:5432/docuflow \
  -e SESSION_SECRET=... \
  -e JWT_SECRET=2026-08:... \
  -e PRIVATE_OBJECT_DIR=/my-bucket/.private \
  -e PUBLIC_OBJECT_SEARCH_PATHS=/my-bucket/public \
  -e GCS_SERVICE_ACCOUNT_KEY="$(base64 -w0 key.json)" \
  docuflow
```

The runner needs a database and nothing else, where the server needs the whole
list. It resolves that database the way everything here does, through
[`shared/databaseUrl.ts`](../shared/databaseUrl.ts): `DATABASE_URL`, or the
`PG*` set it assembles one from. What it does *not* read is the rest — and that
is `scripts/lib/db.ts`'s doing, which opens a pool directly instead of importing
`server/config.ts`, so a migration cannot be blocked by an object-storage
variable it will never use. That carries into the image with it.
`--baseline <version>` is here too, and `migrations/README.md` is when to reach
for it — a database that predates the journal needs it exactly once.

Against a plain PostgreSQL — a local container, a CI service — add
`-e DB_DRIVER=pg`: the default Neon serverless driver speaks WebSockets to Neon
and cannot reach one. That is a server setting only; the migration runner is
node-postgres under every setting, which is ADR-0016's "no Neon-only features"
made literal — it reaches Neon and a local container the same way.

**`DB_DRIVER` is permanent configuration, not a migration flag.** The test
harness (#27) introduced it as a seam and left it without the owner and removal
gate ADR-0017 requires of a temporary switch; defining the image is what settles
it, because the image is the one thing every host runs. Which driver the server
wants is a property of the database it is pointed at — Neon's serverless driver
for Neon, node-postgres for anything reachable over plain TCP — and that stays
true after the migration ends, so the seam becomes a documented setting rather
than something to remove. Both drivers ship in the image deliberately.

`pg`'s place in `dependencies` follows from the same reading, and is correct as
it stands: it loads at boot under either driver, statically imported by
[`server/db.ts`](../server/db.ts), and again by `connect-pg-simple`, which is
handed a `conString` in [`server/auth.ts`](../server/auth.ts) and builds its own
pool from it whatever Drizzle was given. It is not a test-only dependency.

The server binds `0.0.0.0` on `PORT`, which defaults to 5000, so a host that
injects its own port is served by the same image. `/health` answers before
authentication and touches nothing, and the image's `HEALTHCHECK` calls it every
30 seconds.

ADR-0018 applies to every value above: this is a parallel environment, so each
one is a fresh credential provisioned for this effort, never a production one.

## What CI does with it

`.github/workflows/ci.yml` builds the image on every push to main and every pull
request, with the layer cache in the Actions cache so an unchanged
`package-lock.json` reuses both `npm ci` layers. Only pushes to main write that
cache — `mode=max` exports every intermediate stage, including the build stage
carrying the full dependency tree, and a copy of that per pull request would
evict both the image cache and the npm cache out of one 10 GB per-repository
budget. Pull requests read main's entry, which is what they branched from.

Then it runs it, which is the part no test can stage. `tests/smoke/migrate-bundle.test.ts`
and `tests/smoke/server-bundle.test.ts` both reason about the runtime dependency
tree from the checkout's — the first stages a `/app` that borrows this
repository's `node_modules`, the second reads the manifest rather than an
install. Neither can see `npm ci --omit=dev` as the image runs it. So CI loads
the image and runs four things against the real tree: an `import()` of every
`dependencies` entry read out of the image's own `package.json`, which is where
a package that resolves but cannot initialise — `sharp` without libvips,
`bcrypt` without a matching binary — is caught; `node dist/migrate.mjs --status`
with no database configured, which has to fail in `shared/databaseUrl.ts`'s
words rather than on a missing module; a listing of `/app/migrations`, which has
to hold the journal; and the default `CMD`, waited on until the image's own
`HEALTHCHECK` reports `healthy`.

That first check is what stands in for exercising routes by hand. It is
shallower — a module load, not the route that reaches it — and broader: every
entry rather than the handful anyone thinks to try, on every push rather than
once at review. `Cannot find module` is the failure it exists for, and that one
it answers completely.

Every value passed there is a placeholder that
reaches nothing — `/health` answers before authentication and both the pool and
the session store connect on first use, so this is a boot test, and ADR-0018
keeps real URLs and credentials out of the workflow.

Nothing is pushed to a registry: there is no deployment target yet, and no
registry credential belongs in this repository until Phase 2 provisions a fresh
one.

## Known gaps

Two things about this image, each waiting on a ticket rather than an oversight:

- **Transcript scraping is inoperable** (#37). `server/browser-transcript.ts:4`
  launches Chromium from a hard-coded Replit Nix path, so it cannot work off
  Replit with or without a browser in the image. The build therefore skips
  Playwright's ~400 MB browser download rather than paying for one the code will
  not look at, and #37 is the removal gate on that skip. Loom and Fathom
  scraping fails at launch until that path is replaced.
- **Most of what is left is one package** (#43). `pdf-parse` is 115 MB of the
  runtime tree's 259 MB, because it vendors its own copy of `pdfjs-dist` instead
  of sharing the one the client is built with. Nothing in the packaging can move
  it: the server really does extract PDFs, on a request rather than at boot.
  Getting that extraction from something smaller is a dependency change with a
  behavioural blast radius, not the packaging move #36 was — which is what #43
  owns, and the removal gate on this entry.
