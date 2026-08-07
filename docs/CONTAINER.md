# The container

One image, both runtimes (ADR-0016). Today it runs the HTTP server; the Phase 3
worker will be this same image started with a different command. That is why the
[`Dockerfile`](../Dockerfile) ends in a `CMD` rather than an `ENTRYPOINT` —
`docker run <image> <other command>` replaces it without a rebuild — and why the
image carries no configuration of its own.

## Build

```bash
docker build -t docuflow .
```

Four stages: a shared base holding the dependency manifest, a build stage with
the full dependency tree (`vite`, `esbuild`, and `typescript` are all
devDependencies), a second install stage that resolves the runtime tree only,
and the runtime image that copies `dist/` and those runtime dependencies in.
Nothing from the build stage's toolchain ships.

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

The schema is not applied by the container. Boot reads the database and never
changes it (#24), so `npm run db:migrate` runs first, from a checkout, against
the same database — see `migrations/README.md`. Getting that into the image as a
second command is the deploy ticket's business, not this one's.

```bash
# Schema first, from a checkout.
DATABASE_URL=postgresql://user:password@host:5432/docuflow npm run db:migrate

docker run --rm -p 5000:5000 \
  -e DATABASE_URL=postgresql://user:password@host:5432/docuflow \
  -e SESSION_SECRET=... \
  -e JWT_SECRET=2026-08:... \
  -e PRIVATE_OBJECT_DIR=/my-bucket/.private \
  -e PUBLIC_OBJECT_SEARCH_PATHS=/my-bucket/public \
  -e GCS_SERVICE_ACCOUNT_KEY="$(base64 -w0 key.json)" \
  docuflow
```

Against a plain PostgreSQL — a local container, a CI service — add
`-e DB_DRIVER=pg`: the default Neon serverless driver speaks WebSockets to Neon
and cannot reach one.

The server binds `0.0.0.0` on `PORT`, which defaults to 5000, so a host that
injects its own port is served by the same image. `/health` answers before
authentication and touches nothing, and the image's `HEALTHCHECK` calls it every
30 seconds.

ADR-0018 applies to every value above: this is a parallel environment, so each
one is a fresh credential provisioned for this effort, never a production one.

## What CI does with it

`.github/workflows/ci.yml` builds the image on every push to main and every pull
request, with the layer cache in the Actions cache so an unchanged
`package-lock.json` reuses both `npm ci` layers. Nothing is pushed: there is no
deployment target yet, and no registry credential belongs in this repository
until Phase 2 provisions a fresh one.

## Known gaps

Three things this image does not do, each waiting on a ticket rather than an
oversight:

- **Transcript scraping is inoperable.** `server/browser-transcript.ts` launches
  Chromium from a hard-coded Replit Nix path, so it cannot work off Replit with
  or without a browser in the image. The build therefore skips Playwright's
  ~400 MB browser download rather than paying for one the code will not look at.
  Loom and Fathom scraping fails at launch until that path is replaced.
- **Migrations run outside the image**, as above. ADR-0016 makes them a gated
  pre-deploy step, which on Render means a command run against this image — so
  the deploy ticket needs a second built entry point for `scripts/migrate.ts`.
- **The image is large** (~1.1 GB) because `package.json` puts the client's
  dependencies — `react-icons`, `lucide-react`, `@tiptap`, `@radix-ui` — under
  `dependencies`, so `npm ci --omit=dev` installs them into a runtime that only
  ever serves them pre-bundled from `dist/public`. Splitting client from server
  dependencies is the fix, and it is a `package.json` change with its own blast
  radius rather than a Dockerfile one.
