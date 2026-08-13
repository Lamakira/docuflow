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
- `tests/global-setup.ts` builds the test database once per run by applying the
  migration journal through `scripts/migrate.ts` — the same runner a deploy uses
  (#24), rather than a second path to a schema that could drift from it.
- `tests/helpers/app.ts` boots the real app assembly (`server/app.ts`) —
  the exact middleware chain production uses, minus Vite/static and listen.
- `tests/helpers/db.ts` truncates all tables between tests.
- `tests/helpers/runtimeTree.ts` is the single answer to what `npm ci --omit=dev`
  installs — `dependencies` and `optionalDependencies` both. The two bundle
  suites below read it rather than each keeping their own copy. Since #43 the
  image is that install *minus* `@napi-rs/canvas`, deleted by the `Dockerfile`
  after the install and guarded there; a package the manifest declares and the
  image does not have is a difference only CI can see, which is why the
  deletion is asserted in the Dockerfile itself rather than here.
- Telemetry is off (#26): `NODE_ENV=test` exports nothing, and `tests/setup.ts`
  clears every `OTEL_*` variable so a developer's shell cannot instrument a run.
  Nothing patches express or pg while a suite is running, and no exporter has to
  be silenced.
- `DB_DRIVER=pg` makes `server/db.ts` use the standard node-postgres driver.
  So does every other environment now: `.replit` sets it for the Replit
  workspace and the published app, because the Neon serverless driver's
  WebSocket transport does not reach a Replit-hosted database (#53). The
  serverless driver remains the code default and nothing sets it.

### The database image is pgvector, not plain Postgres

`document_embeddings.embedding` and `company_document_embeddings.embedding` are
`vector(1536)` columns that `server/embeddings.ts` writes and orders by through
raw SQL. Migration `0003_vector_embeddings` creates the extension and both
columns, so the image has to be one that carries pgvector — a plain `postgres`
image fails on `CREATE EXTENSION vector` and the run stops at global setup.

## Provider fakes (ADR-0018)

`vitest.config.ts` aliases each vendor package to an in-memory fake in
`tests/fakes/`, so the stub sits at the provider boundary and no application
module knows it is under test:

| Package                 | Fake                    | What it does                                                                 |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `@google-cloud/storage` | `tests/fakes/gcs.ts`    | In-memory bucket, and deterministic signed URLs. `putObject` seeds an object, `objectMetadata` reads its ACL, `signedUrlCalls` lists what was signed. |
| `openai`                | `tests/fakes/openai.ts` | Deterministic bag-of-words embeddings, canned chat and Whisper replies, call log. |
| `resend`                | `tests/fakes/resend.ts` | Always-succeeding delivery into an inspectable outbox.                        |
| `playwright`            | `tests/fakes/playwright.ts` | `launch()` throws by default. The transcript-browser suite opts into a response/page fake to verify Loom's listener timing and fallback suppression without opening a browser or reaching a provider. |

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
  mints tokens with the harness's fixed `JWT_SECRET` — a `<key-id>:<secret>` pair,
  both halves of which a minted token needs — for the middleware branches (an
  expired token, a token for a deleted device) no live login can produce.
- Get every request from `newAgent`/`registerUser` rather than `supertest`
  directly, authenticated or not. They attach a unique `X-Forwarded-For`, which
  keeps unrelated suites from spending each other's rate-limit budget;
  `rate-limits.test.ts` is the one exception — it pins an address on purpose and
  characterizes the limiter itself.
- Build signed storage URLs with `fakeSignedUrl`/`signedUrlPattern` from
  `tests/fakes/gcs.ts` instead of writing a storage host into a suite.

## Suites

`tests/smoke/` holds the boot-level suites: the ones from the harness ticket,
plus those that do **not** use the fixed environment but build their own and
import a server module again, which is what a boot is.
`config` ([#22](https://github.com/Lamakira/docuflow/issues/22)) clears the
variables, re-imports `server/config.ts`, and pins what each environment resolves
to, including the boot failures the rest of the harness can never reach.
`desktop-tokens` ([#23](https://github.com/Lamakira/docuflow/issues/23)) loads
`server/desktopTokens.ts` under one set of signing keys and presents its tokens
to the next load — a restart, and a key rotation — without going near the
database.
`migrations`, `boot-ddl-parity`, and `db-scripts`
([#24](https://github.com/Lamakira/docuflow/issues/24)) cover what boot used to
do and no longer does. `migrations` diffs a database built from the journal
against one built from `shared/schema.ts`, and pins the runner's ledger, its
refusal to run a migration whose file changed after it shipped, and the promise
that `--status` and `--dry-run` create nothing — not even the ledger.
`boot-ddl-parity` keeps the deleted boot DDL verbatim and checks the journal
still produces exactly what it produced; migration `0004` exists because it did
not. `db-scripts` freezes the rows `npm run db:seed` and
`npm run db:backfill:crm-links` write, which are the rows `server/index.ts` used
to write on every start.
`migrate-bundle` ([#35](https://github.com/Lamakira/docuflow/issues/35)) covers
the other form of the same runner: `dist/migrate.mjs`, built from
`script/bundles.ts` and run as a command against a staged `/app` with no
checkout in it, so the three things only the bundle can lose — an empty
`import.meta` under `format: "cjs"`, a journal that did not travel beside it, a
flag dropped in the move — fail here rather than during a deploy. It also pins
the bundle's external imports to what the image installs, which is the one
difference between that staging and the real image: the runtime stage installs
`npm ci --omit=dev`.
`server-bundle` ([#36](https://github.com/Lamakira/docuflow/issues/36)) asks the
same question of `dist/index.cjs` and answers it both ways round: nothing the
bundle imports is missing from the runtime tree, and nothing in that tree goes
unimported. Both come off the build's own metafile rather than the manifest,
because the two errors hide differently — a client package left in
`dependencies` costs disk and nothing else, while a server import missing from
it builds, typechecks, tests, boots, and then fails on the first request that
reached the route using it.

None of the three can see DDL applied to a database from outside this repository
— both sides of every comparison here are built from the repository. That is
`npm run db:verify`, which diffs the journal against a live database; see
`migrations/README.md`.
`telemetry` ([#26](https://github.com/Lamakira/docuflow/issues/26)) pins the
IDs-only rule from ADR-0016: what `server/telemetryRedaction.ts` drops, what it
keeps, and that the logger applies it to the console line as well as to the
record it exports. It exercises the rule rather than a running SDK on purpose —
starting one would patch express and pg for whatever ran next in the same
worker, which is the state this suite exists to keep the harness out of.
`transcript-browser` ([#37](https://github.com/Lamakira/docuflow/issues/37))
pins how the Loom/Fathom scraper finds a browser: no `executablePath` at all
unless `PLAYWRIGHT_CHROMIUM_PATH` names one, the two container flags kept as
flags, the refusal of an override naming nothing this host can run, and the
absence of any `/nix` store path under `server/` — the constant all of it
replaced. The `playwright` fake throws on `launch()` by default, so the options
are readable without a browser. That a browser *exists* where Playwright
looks is the image's half of the question, which only
`.github/workflows/ci.yml` can answer, and it does — by opening a page and
reading a clipboard inside the built image.
It also pins what a scrape may *call* a transcript
([#45](https://github.com/Lamakira/docuflow/issues/45)). `looksLikeTranscript`
decides that in Node rather than in the page, so it is answerable with neither
browser nor network, and the cookie banner Loom once served in place of a
transcript is kept verbatim as the thing that must not pass.
For Loom's network path, `tests/fixtures/loom-transcription-1.1.3.json` is a
content-neutral copy of the observed response shape: recording text and
identifiers were replaced, while root, phrase, timestamp, text, and ranges types
were retained. The opt-in provider fake covers listener-before-navigation,
delayed and unreadable response bodies, JSON-before-VTT ordering, capture
freezing, and the rule that definitive network results never touch rendered UI.
The remaining live check belongs to the built image because only that boundary
can prove its installed Playwright browser can load the supplied public URL; the
URL is passed at runtime and is never stored in this repository or test output.

`snapshot-rehearsal` ([#53](https://github.com/Lamakira/docuflow/issues/53))
covers the two checks a restored production snapshot must pass before anything
uses it (ADR-0022, ADR-0023): no absolute storage URL pointing at a bucket that
is not ours, and no storage key the database names that the destination lacks.
It is a smoke suite because the scan reads `information_schema` rather than a
table list — the failure it exists for is a column nobody thought of — so it
needs a real schema and not a fixture. The case that earns the suite is the
refusal: a foreign URL in a column no scrub rule covers stops the run and leaves
the database untouched, because rewriting it on a guess is the same mistake as
missing it.

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
| `content-extraction`             | the text an uploaded PDF, Word or text file comes out as, and the four outcomes the upload route distinguishes |
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
