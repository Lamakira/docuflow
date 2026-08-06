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
| Deployments | The platform's own environment configuration |
| Tests | `tests/setup.ts` assigns fixed values before any server module loads; a developer's exported secrets never reach the harness |

A variable set in the real environment wins over `.env`, so an ops override never
needs the file edited.

## Required, and what happens when one is missing

`server/config.ts` resolves at import — that is, before the app assembles — and
aborts boot listing **every** required variable that is absent, rather than
letting the first request that needs one fail with a 500:

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
| `PRIVATE_OBJECT_DIR` | Bucket root for private objects, as `/<bucket>/<prefix>` |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Comma-separated bucket roots for public objects; the first receives public uploads |

Optional — each gates one feature, which reports its own failure while unset:

| Variable | Effect while unset |
| --- | --- |
| `GCS_SERVICE_ACCOUNT_KEY`, `GCS_PROJECT_ID` | Storage falls back to Application Default Credentials |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email sends fail and report why; the request that triggered them still succeeds |
| `OPENAI_API_KEY` | Embeddings, chat, and transcription fail when used |
| `FATHOM_API_KEY` | Fathom transcripts fall back to the browser scraper |
| `JWT_SECRET` | Desktop-agent tokens are signed with a key generated per boot, so a restart invalidates every one of them |
| `MCP_API_KEY` | The MCP admin-impersonation header is refused. Phase 5 removes it |
| `DESKTOP_RELEASE_CI_TOKEN` | Release registration is refused |
| `APP_URL` | Links in outbound email fall back to the Replit domain variables, then `http://localhost:5000` |
| `PORT` | 5000 |
| `DB_DRIVER` | Neon's serverless driver; `pg` selects node-postgres for a database that driver cannot reach |
| `REPL_ID`, `ISSUER_URL` | Replit OIDC login fails. Phase 5 removes both |

`MCP_API_KEY` and `DESKTOP_RELEASE_CI_TOKEN` are read per request rather than at
boot, so rotating either takes effect without a restart.

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

Credentials, in the order the client tries them:

1. `GCS_SERVICE_ACCOUNT_KEY` — the key file's JSON, verbatim on one line or
   base64-encoded. Base64 is what survives secret stores that mangle the
   newlines inside `private_key`.
2. Application Default Credentials — a key file named by
   `GOOGLE_APPLICATION_CREDENTIALS`, or workload identity on a Google host.

The bucket needs CORS allowing `PUT` and `GET` from the app's origin, since
browsers upload to it directly.

`scripts/upload-to-gcs.mjs` and `scripts/release-desktop.mjs` read the same
credentials and take the installer bucket from `INSTALLER_GCS_BUCKET`.

## Email

`RESEND_API_KEY` is a plain Resend API key; `RESEND_FROM_EMAIL` is the verified
sender, defaulting to `DocuFlow <noreply@resend.dev>`. While the key is unset,
every send returns a failure that the caller reports — no request fails because
email is unconfigured.

## Adding a variable

Read it in `server/config.ts` and nowhere else, then:

- add it to `.env.example` with a placeholder and a one-line comment;
- add it to the right table above;
- decide the tier deliberately. Required means the app will not boot without it.
