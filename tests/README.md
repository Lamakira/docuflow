# Test harness

HTTP-seam tests against the real Express app and a real PostgreSQL, per the
testing decisions in [Spec #18](https://github.com/Lamakira/docuflow/issues/18):
the primary seam is the HTTP contract; external providers get stubbed, never
application internals.

## Running

```bash
npm run test:db:up   # start the disposable Postgres (docker-compose.test.yml, port 5433)
npm test             # vitest run
npm run test:watch   # watch mode
npm run test:db:down # stop the database
```

## How it works

- `tests/setup.ts` fixes the environment **before any server module loads**
  (`DATABASE_URL`, `DB_DRIVER=pg`, test secrets, object-storage layout). `server/config.ts`
  resolves all of it at import and refuses to boot when a required variable is missing,
  so server code is only ever imported dynamically, never at a module's top level.
- `tests/global-setup.ts` pushes the schema from `shared/schema.ts` into the
  test database once per run (`drizzle-kit push`), pending migration-journal
  consolidation (#24), then applies the vector DDL described below.
- `tests/helpers/app.ts` boots the real app assembly (`server/app.ts`) —
  the exact middleware chain production uses, minus Vite/static and listen.
- `tests/helpers/db.ts` truncates all tables between tests.
- `DB_DRIVER=pg` makes `server/db.ts` use the standard node-postgres driver;
  production default remains Neon's serverless driver.

### The database image is pgvector, not plain Postgres

`document_embeddings.embedding` and `company_document_embeddings.embedding` are
`vector(1536)` columns that `server/embeddings.ts` writes and orders by through
raw SQL — but no Drizzle column and no committed migration creates them; they
were applied out of band. A bare schema push therefore produces a database in
which every embedding write fails silently, which would make the retrieval
suites freeze a local accident instead of the real contract. `tests/global-setup.ts`
recreates the extension and both columns after the push. Fold this into the
migration journal in #24 and the workaround can go.

## Provider fakes (ADR-0018)

`vitest.config.ts` aliases each vendor package to an in-memory fake in
`tests/fakes/`, so the stub sits at the provider boundary and no application
module knows it is under test:

| Package                 | Fake                    | What it does                                                                 |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `@google-cloud/storage` | `tests/fakes/gcs.ts`    | In-memory bucket, and deterministic signed URLs. `putObject` seeds an object, `objectMetadata` reads its ACL, `signedUrlCalls` lists what was signed. |
| `openai`                | `tests/fakes/openai.ts` | Deterministic bag-of-words embeddings, canned chat and Whisper replies, call log. |
| `resend`                | `tests/fakes/resend.ts` | Always-succeeding delivery into an inspectable outbox.                        |
| `playwright`            | `tests/fakes/playwright.ts` | Throws — the Loom/Fathom transcript scraper must never be reached.        |

One provider boundary is crossed with a raw `fetch` rather than an SDK: the signed
storage URL itself, which the server PUTs to when it relays a desktop-agent
screenshot — the one upload the server performs instead of handing the URL to the
client. `tests/fakes/network.ts` answers it from memory (the PUT lands in the same
in-memory bucket `tests/fakes/gcs.ts` serves from) and makes every **other** `fetch`
throw, so a suite cannot quietly reach a real service. Postgres and supertest do
not use `fetch`, so nothing legitimate is blocked.

All four fakes are module-level singletons; `tests/setup.ts` resets them in a
global `beforeEach` alongside the database.

## Safety (ADR-0018)

The harness **refuses non-local database hosts** unless
`ALLOW_REMOTE_TEST_DB=1` is set. It truncates every table — never point it at
a database you care about, and never at anything production-related.

## Conventions

- Characterization suites freeze **current** behavior, bugs and quirks
  included — a test failing after a refactor means the contract moved.
  Document captured quirks with a comment at the assertion.
- Assert externally visible behavior (status, body, headers, side effects
  through other endpoints), never implementation details.
- New external-provider stubs belong at the provider client boundary, not
  inside application modules.
- Build fixtures through the HTTP API (`tests/helpers/fixtures.ts`), not through
  `storage`. The one exception is `tests/helpers/auth.ts`, which writes the admin
  role directly: every route that can grant it is itself admin-only, so there is
  no HTTP path to the first admin.
- Sign desktop agents in with `loginDevice` from `tests/helpers/agent.ts`, which
  returns a request agent already carrying the bearer token. The same module
  mints tokens with the harness's fixed `JWT_SECRET`, for the middleware branches
  (an expired token, a token for a deleted device) no live login can produce.
- Get every request from `newAgent`/`registerUser` rather than `supertest`
  directly, authenticated or not. They attach a unique `X-Forwarded-For`, which
  keeps unrelated suites from spending each other's rate-limit budget;
  `rate-limits.test.ts` is the one exception — it pins an address on purpose and
  characterizes the limiter itself.
- Build signed storage URLs with `fakeSignedUrl`/`signedUrlPattern` from
  `tests/fakes/gcs.ts` instead of writing a storage host into a suite.

## Suites

`tests/smoke/` holds the two boot-level suites from the harness ticket.
`tests/characterization/` freezes the legacy web API
([#20](https://github.com/Lamakira/docuflow/issues/20)) and the desktop agent v1
protocol ([#21](https://github.com/Lamakira/docuflow/issues/21), the `agent-*`
suites — `docs/agent-protocol.md` has drifted, so the tests encode the
implementation and each suite's header lists what the document gets wrong):

| Suite                            | Covers                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| `auth-session`                   | register/login/logout, session persistence, `isAuthenticated` variants, MCP key |
| `users-admin`                    | user directory, admin CRUD, generated passwords, account emails, SuperAdmin guards |
| `projects-documents`             | projects, retired endpoints, the TipTap page tree, search            |
| `crm-clients-contacts`           | clients and their contact people                                    |
| `crm-projects`                   | CRM projects, pagination, stage history, review clock, assignment    |
| `crm-tags-notes`                 | tags, project tags, notes and mention notifications                 |
| `company-documents`              | folders, native pages, uploaded files, streaming and download        |
| `tasks-members-reminders`        | tasks, project membership, per-user reminders                       |
| `time-tracking`                  | start/pause/resume/stop/activity, visibility, stats                 |
| `agent-timer`                    | the desktop agent's device login and its half of the shared tracker  |
| `agent-auth`                     | device login, refresh, revocation, and the retired pairing endpoints |
| `agent-ingestion`                | heartbeats, timer sync, policy delivery, activity event batches      |
| `agent-screenshots`              | the agent's presign / upload / confirm flow and the tombstone it hits |
| `agent-workspace`                | the agent's project and task pickers, capabilities, and day totals   |
| `screenshots`                    | evidence upload, listing, image serving, tombstones                 |
| `notifications-org-settings`     | the bell, screenshot policy, timezones, Help Center screenshots      |
| `daily-updates`                  | per-project daily updates and the admin dashboards                  |
| `modules-fields`                 | admin-configurable CRM modules and custom fields                    |
| `objects-uploads`                | signed URLs, object ACLs, public objects, audio notes               |
| `chat-embeddings`                | retrieval-augmented chat and the embedding pipeline                 |
| `admin-analytics`                | analytics dashboards and the CSV export                             |
| `desktop-downloads`              | public installer endpoints and CI release registration              |
| `teams`                          | teams and invite links (still mounted, no longer used by the SPA)    |
| `transcripts`                    | transcript status and sync on the no-video paths                    |
| `rate-limits`                    | the global limiter, the screenshot budget, and where the auth limiter is actually mounted |
