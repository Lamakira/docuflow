# Configuration

Everything the server needs comes from environment variables, read in exactly
one place: [`server/config.ts`](../server/config.ts). No other server module
reads `process.env`, so the full surface is one file long and one file wide.

[`.env.example`](../.env.example) is the committed template — copy it to `.env`
and fill it in.

## ADR-0018: never production values

This repository is a **parallel environment**. It must never contain a
production credential, a production URL, or production data — not in a file, not
in a shell export, not temporarily. Every account it points at (database, object
storage, email, AI, identity) is a fresh one provisioned for this effort, and
production data only ever arrives here as a restored snapshot loaded into those
fresh accounts.

`.env` is git-ignored, which stops an accident from being committed; it does not
make a production secret acceptable to put there.

## How variables reach the process

| Context | Mechanism |
| --- | --- |
| `npm run dev`, `npm start` | Node loads `.env` if it exists (`--env-file-if-exists=.env`) |
| The container | `docker run -e` or `--env-file`; the image carries no configuration of its own ([docs/CONTAINER.md](CONTAINER.md)) |
| Deployments | The platform's own environment configuration |
| Tests | `tests/setup.ts` assigns fixed values before any server module loads; a developer's exported secrets never reach the harness |

A variable set in the real environment wins over `.env`, so an ops override never
needs the file edited.

## Required, and what happens when one is missing

`server/config.ts` resolves at import — that is, before the app assembles — and
aborts boot listing **every** required variable that is absent or unusable,
rather than letting the first request that needs one fail with a 500. A value
that cannot be read is reported the way a missing one is, so one restart shows
everything that needs attention rather than the first problem alone:

```
Configuration incomplete. Set the following, then start again:
  - SESSION_SECRET — signs session cookies; any long random string
  - PRIVATE_OBJECT_DIR — bucket root for private objects, e.g. /my-bucket/.private
.env.example lists every variable; docs/CONFIGURATION.md explains them.
```

Required:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, or all of `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | The one PostgreSQL database. `DATABASE_URL` wins when both are set; `PGPORT` defaults to 5432. See [DB_ENV_SETUP.md](DB_ENV_SETUP.md) |
| `SESSION_SECRET` | Signs session cookies. Rotating it logs everyone out |
| `JWT_SECRET` | Signs desktop-agent access tokens, as `<key-id>:<secret>`. See [Desktop access-token signing keys](#desktop-access-token-signing-keys) |
| `PRIVATE_OBJECT_DIR` | Bucket root for private objects, as `/<bucket>/<prefix>` |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Comma-separated bucket roots for public objects; the first receives public uploads |
| `GCS_SERVICE_ACCOUNT_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` | The storage identity. Either the key file's JSON inline, or a path to it. One or the other — see [Object storage](#object-storage) |

Optional — unset is a supported state, and the second column is what that state
is. Most gate one feature, which reports its own failure while it is missing:

| Variable | Effect while unset |
| --- | --- |
| `GCS_PROJECT_ID` | The project is taken from the key file's `project_id` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email sends fail and report why; the request that triggered them still succeeds |
| `OPENAI_API_KEY` | Embeddings, chat, and transcription fail when used |
| `FATHOM_API_KEY` | Fathom transcripts fall back to the browser scraper |
| `PLAYWRIGHT_CHROMIUM_PATH` | That scraper launches the browser Playwright installed — `npx playwright install chromium` on a developer machine, the copy under `PLAYWRIGHT_BROWSERS_PATH` in the image. Name one only for a host carrying its own; a path with nothing at it stops boot rather than a scrape ([docs/CONTAINER.md](CONTAINER.md)) |
| `JWT_PREVIOUS_SECRET` | Only the current signing key is accepted, which is the steady state. Set it during a rotation — see below |
| `MCP_API_KEY` | The MCP admin-impersonation header is refused. Phase 5 removes it |
| `DESKTOP_RELEASE_CI_TOKEN` | Release registration is refused |
| `APP_URL` | Links in outbound email fall back to the Replit domain variables, then `http://localhost:5000` |
| `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN` | Set by the Replit runtime, never by hand. The first entry stands in for `APP_URL` while that is unset. They leave with the OIDC login in Phase 5 |
| `PORT` | 5000 |
| `NODE_ENV` | `development`. The production build replaces the read with a literal (`script/bundles.ts`), so a deployment sets it rather than a person |
| `DB_DRIVER` | Neon's serverless driver; `pg` selects node-postgres for a database that driver cannot reach. Permanent configuration and not a migration flag (#25): the database this points at decides it, so there is nothing to remove ([docs/CONTAINER.md](CONTAINER.md)) |
| `REPL_ID`, `ISSUER_URL` | Replit OIDC login fails. Phase 5 removes both |
| `OTEL_EXPORTER` | The environment decides: nothing under test, the console in development, nothing in production until a collector is named — see [Telemetry](#telemetry) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | No collector, so nothing is exported over OTLP. Instrumentation still runs |
| `OTEL_SERVICE_NAME` | `docuflow-server` |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | 60000 |
| `ALLOW_REMOTE_OTLP` | A non-local `OTEL_EXPORTER_OTLP_ENDPOINT` is refused outright (ADR-0018) |

`MCP_API_KEY` and `DESKTOP_RELEASE_CI_TOKEN` are read per request rather than at
boot, so rotating either takes effect without a restart.

## Desktop access-token signing keys

The desktop agent authenticates with an hour-long HS256 token, minted at login
and at every refresh by [`server/desktopTokens.ts`](../server/desktopTokens.ts).
The key it is signed with comes from the environment, written as an id and a
secret joined by a colon:

```
JWT_SECRET=2026-08:9f3c…            # openssl rand -hex 32 for the secret
```

The id is not a secret — it travels in the header of every token that key signs
(`kid`), which is how a verifier picks the right key when two are in
circulation. It has to be short and printable: letters, digits, `.`, `-`, `_`.
Keeping it in the same variable as the secret is deliberate; the two cannot be
rotated apart.

The secret must be **at least 32 characters**, and boot refuses a shorter one.
The id is validated against a pattern, and the secret is the half that actually
holds the door — it would be the wrong one to check less carefully.

**There is no generated fallback, and boot fails without the variable.** A key
the process invents does not survive the process: every agent's token would stop
verifying at the next restart, at every deploy, and on any second replica —
which is exactly what happened before this was required. Failing at boot is the
loud version of a failure that otherwise arrives an hour later as a fleet-wide
sign-out.

### Rotating the key

`JWT_PREVIOUS_SECRET` is the overlap. While it is set, tokens signed with either
key verify, and every newly issued one carries the current key's id — so a
rotation costs nobody their session:

1. **Introduce.** Put the new key in `JWT_SECRET` with a new id, and move the
   old value verbatim into `JWT_PREVIOUS_SECRET`. Restart. New tokens now name
   the new key; the ones already out there still verify against the old one.
2. **Wait.** One access-token lifetime — an hour — counted from the moment the
   **last** replica picked the new configuration up, not from the first restart.
   A replica still on the old value goes on minting tokens signed with the old
   key, and those live an hour from when they were issued. The boot line below is
   what tells you a replica has caught up.
3. **Retire.** Clear `JWT_PREVIOUS_SECRET` and restart.

Both keys must have different ids; boot refuses a pair that does not, because a
`kid` naming two secrets is the one question it exists to answer. The boot line
reports the ids in use, and never the secrets:

```
[config] production — … desktop tokens on key 2026-08, retiring 2026-05, …
```

One case sits outside the two-key rule. A token carrying **no** `kid` at all —
the shape the server issued before
[#23](https://github.com/Lamakira/docuflow/issues/23) — is checked against every
key configured, because the deploy that introduced ids would otherwise sign the
whole fleet out at once. Nothing has issued such a token since, so the branch is
a contract step rather than a permanent one, scheduled for removal under B1 in
[RELEASE_CANDIDATE_CHECKLIST.md](RELEASE_CANDIDATE_CHECKLIST.md). Until it goes,
a `kid`-less token is as good as its signature and no better — which is what it
was before ids existed.

Rotating the key does **not** sign devices out on its own. Device tokens — the
long-lived credential the agent stores and refreshes with — are a separate
credential, held as a hash in the database, and are untouched by any of this.

## Object storage

Objects live in one Google Cloud Storage bucket, addressed through two roots
written as `/<bucket>/<prefix>`:

```
PRIVATE_OBJECT_DIR=/docuflow-objects/.private
PUBLIC_OBJECT_SEARCH_PATHS=/docuflow-objects/public
```

Uploads and downloads never pass through this process: the server mints a V4
signed URL and the client transfers directly against the bucket. Signing needs a
key that can sign, so the identity must be a **service account** in every
environment.

Two ways to supply that service account, and boot requires one of them:

1. `GCS_SERVICE_ACCOUNT_KEY` — the key file's JSON, verbatim on one line or
   base64-encoded. Base64 is what survives secret stores that mangle the
   newlines inside `private_key`.
2. `GOOGLE_APPLICATION_CREDENTIALS` — a path to that same key file, read by the
   Google SDK rather than by this app. `server/config.ts` reads it only to know
   a credential exists and to name the mode on the boot line.

Both are environment variables, which is what lets boot refuse an environment
that names neither instead of failing at the first signature. Bare workload
identity — a Google host inferring an identity with no variable set — is
deliberately not a third mode: nothing this app runs on is a Google host, so it
would be a path no deployment has ever exercised.

The bucket needs CORS allowing `PUT` and `GET` from the app's origin, since
browsers upload to it directly.

### Against ADR-0016 and ADR-0012

[ADR-0016](adr/0016-host-on-render-neon-and-r2-with-an-independent-aws-evidence-account.md)
puts files, screenshots, and installers on **Cloudflare R2** behind an S3-shaped
port, and [ADR-0012](adr/0012-store-files-behind-a-workspace-keyed-object-storage-port.md)
requires storage to sit behind one shared infrastructure port. Neither holds
here yet: this is the legacy stack, addressed as GCS directly, and the settings
above are GCS-shaped (`GCS_SERVICE_ACCOUNT_KEY`, `GCS_PROJECT_ID`). The de-Replit
work moved the credentials out of the Replit sidecar without introducing the
port — that is the migration's own phase, not this one. Recorded here so the
next reader sees the gap rather than reading the ADRs as already satisfied.

## The release scripts

`scripts/upload-to-gcs.mjs` and `scripts/release-desktop.mjs` are plain `.mjs`
entry points, so they cannot import `server/config.ts` — a TypeScript module —
and read their own environment through `scripts/gcs-client.mjs` instead. It
applies the same rules and the same validation: one of `GCS_SERVICE_ACCOUNT_KEY`
or `GOOGLE_APPLICATION_CREDENTIALS`, the installer bucket from
`INSTALLER_GCS_BUCKET`, and no identifier hard-coded in the repository.

| Variable | Purpose |
| --- | --- |
| `INSTALLER_GCS_BUCKET` | Bucket the desktop installers are published to. Required by both scripts; no default |
| `DOCUFLOW_API_URL` | The deployment `release-desktop.mjs` registers the release against. No default: a release must name where it is publishing to (ADR-0018) |
| `DESKTOP_RELEASE_CI_TOKEN` | Bearer token those registrations present. No default |
| `GH_REPO` | Repository the installer workflow runs on. Defaults to this project's |
| `GH_WORKFLOW` | Workflow file to dispatch. Defaults to `desktop-release.yml` |

## Tests

The harness reads two variables of its own, in `tests/test-db-url.ts` rather than
in `server/config.ts` — the server never sees them, and `tests/setup.ts` fixes
every server variable before any server module loads, so a developer's exported
secrets never reach a suite.

| Variable | Effect while unset |
| --- | --- |
| `TEST_DATABASE_URL` | The `docker-compose.test.yml` Postgres on `localhost:5433`. Whatever it points at is truncated between tests, so it must be disposable |
| `ALLOW_REMOTE_TEST_DB` | A non-local `TEST_DATABASE_URL` is refused outright (ADR-0018). `1` permits one, and should only ever name a throwaway database |

## Telemetry

What the OpenTelemetry SDK collects is fixed; where it goes is these variables.
[docs/OBSERVABILITY.md](OBSERVABILITY.md) is the whole picture — what is
instrumented, and the IDs-only rule any new field has to satisfy.

`OTEL_EXPORTER` is `none`, `console`, or `otlp`. Unset, the environment decides:

| Environment | Exporter | Why |
| --- | --- | --- |
| `NODE_ENV=test` | `none` | A suite must not print spans, hold a batch open, or depend on what is listening on the machine. An endpoint in the shell is ignored here; `OTEL_EXPORTER=otlp` is the deliberate override |
| An endpoint is set | `otlp` | Naming a collector is how you ask for one |
| `NODE_ENV=development` | `console` | `npm run dev` shows a trace without a collector to run |
| `NODE_ENV=production` | `none` | Until Phase 2 sets an endpoint. A production process printing every span fills its log drain with them |

`none` is a destination, not a switch: the SDK starts, the libraries are
patched, spans are created and discarded, and every log line still carries the
trace id of the request it came from — which is what production has out of this
ticket, and what makes Phase 2 a variable. `NODE_ENV=test` is the one case that
skips the SDK entirely (`server/telemetry.ts`), so no suite runs through a
patched express or pg.

`OTEL_EXPORTER_OTLP_ENDPOINT` is the collector's **root** — `http://localhost:4318`
— and each signal appends its own `/v1/traces`, `/v1/metrics`, `/v1/logs`.
`OTEL_EXPORTER_OTLP_HEADERS` is `key=value,key2=value2`, the format a collector's
own documentation gives; it is where a hosted sink's ingest token goes, and the
boot line prints the endpoint and never the headers.

Boot refuses an endpoint that is not on this machine unless `ALLOW_REMOTE_OTLP=1`
is set — the same deliberate opt-out `ALLOW_REMOTE_TEST_DB` is for the harness.
ADR-0018 keeps this environment's telemetry on local collectors until Phase 2
provisions sinks of its own.

`OTEL_METRIC_EXPORT_INTERVAL_MS` is how long the console exporter waits between
metric dumps. Shortening it is the only reason to set it: 60 seconds is a long
time to watch a terminal to find out whether a counter is moving.

There is no sampling variable. Every trace is kept, which is what a deployment
this size wants; Phase 2 adds a rate when it has an ingest bill to trade detail
against, and can add it without touching application code.

## Email

`RESEND_API_KEY` is a plain Resend API key; `RESEND_FROM_EMAIL` is the verified
sender, defaulting to `DocuFlow <noreply@resend.dev>`. While the key is unset,
every send returns a failure that the caller reports — no request fails because
email is unconfigured.

## Adding a variable

A variable the server reads goes in `server/config.ts` and nowhere else; a
variable only a release script or the test harness reads stays where it is read.
Either way:

- add it to `.env.example` with a placeholder and a one-line comment. That file
  is the register of record — every variable the repository reads is listed
  there, whichever process reads it;
- add it to the right table above — Required, Optional, the release scripts, or
  Tests;
- decide the tier deliberately. Required means the app will not boot without it,
  which is the whole point: a variable checked at boot cannot surface as a 500 on
  the first request that needed it.
