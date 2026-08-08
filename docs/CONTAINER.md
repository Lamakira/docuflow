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
the full dependency tree (`vite`, `esbuild`, and `typescript` are all
devDependencies), a second install stage that resolves the runtime tree only,
and the runtime image that copies `dist/`, those runtime dependencies, and
`migrations/` in. Nothing from the build stage's toolchain ships.

`npm run build` writes three things: `dist/public` (the client), `dist/index.cjs`
(the server), and `dist/migrate.mjs` (the migration runner). The runner is ESM
where the server is CJS, because it resolves the journal beside itself with
`import.meta.url` — a value esbuild's `cjs` format leaves empty.

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

The runner takes `DATABASE_URL` and nothing else, where the server takes the
whole list. That is deliberate and is `scripts/lib/db.ts`'s doing: the
operational scripts resolve their URL through `shared/databaseUrl.ts` instead of
importing `server/config.ts`, so a migration cannot be blocked by an
object-storage variable it will never read. It carries into the image with them.
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
cache — `mode=max` exports every intermediate stage, which is what makes those
layers reusable, and at this image's size a copy per pull request would evict
both the image cache and the npm cache out of one 10 GB per-repository budget.
Pull requests read main's entry, which is what they branched from.

Nothing is pushed to a registry: there is no deployment target yet, and no
registry credential belongs in this repository until Phase 2 provisions a fresh
one.

## Known gaps

Two things this image does not do, each waiting on a ticket rather than an
oversight:

- **Transcript scraping is inoperable** (#37). `server/browser-transcript.ts:4`
  launches Chromium from a hard-coded Replit Nix path, so it cannot work off
  Replit with or without a browser in the image. The build therefore skips
  Playwright's ~400 MB browser download rather than paying for one the code will
  not look at, and #37 is the removal gate on that skip. Loom and Fathom
  scraping fails at launch until that path is replaced.
- **The image is large** (#36, ~1.1 GB) because `package.json` puts the client's
  dependencies — `react-icons`, `lucide-react`, `@tiptap`, `@radix-ui` — under
  `dependencies`, so `npm ci --omit=dev` installs them into a runtime that only
  ever serves them pre-bundled from `dist/public`. Splitting client from server
  dependencies is the fix, and it is a `package.json` change with its own blast
  radius rather than a Dockerfile one.
