# Phase 2 deployments and databases

- **Recorded:** 2026-08-13
- **Status:** **Not published.** Nothing about the *published* environment is observed — geography, publish timestamp, production database, and deployment Secrets are all empty cells. What is recorded is the account and the development workspace, where the app was brought up on 2026-08-13. The decisions an agent can settle from the platform's own documentation are settled here — the deployment topology, the driver, where migrations run, what the scrub and the key verifier do — and the acts only a human can perform against the Replit console are listed as an ordered checklist with the cells their results go in.
- **Ticket:** [#53](https://github.com/Lamakira/docuflow/issues/53). This document is the record that ticket fills; it is not evidence that the ticket is done.
- **Sources read:** `docs.replit.com`, 2026-08-13. Provider statements, not dashboard observations, and three of them contradict what earlier records in this repository assert — see [Corrections](#corrections-to-earlier-records).

## Authority and scope

[ADR-0021](../adr/0021-run-the-compute-on-replit-and-supersede-the-render-hosting-decision.md) puts both runtimes on Replit and names the platform mechanics the phases have to execute against: a permanent publishing geography, a Reserved VM for the worker, migrations as the deployment Build command, and the Dockerfile demoted from deployment artifact to CI harness. [ADR-0018](../adr/0018-build-in-a-parallel-environment-with-snapshot-rehearsed-cutover.md) requires that all of it happen in a parallel environment holding no production credential, URL, or data-plane connection, and that production data arrive only as restored snapshots. [ADR-0022](../adr/0022-provision-r2-in-phase-2-and-replace-the-gcs-move-with-a-snapshot-copy.md) and [ADR-0023](../adr/0023-prefer-replit-provided-capability-wherever-an-exit-can-be-proved.md) specify the object half of those snapshots and move it onto Replit App Storage. [ADR-0015](../adr/0015-own-audit-privacy-and-compliance-controls-behind-platform-ports.md) puts secrets in the platform's secret store.

The [provider inventory](phase-2-provider-inventory.md) registers the accounts. This document configures what those accounts run: the deployments, the databases behind them, and the rehearsal path that lets production data into the environment safely. Boundaries with the rest of Phase 2 are unchanged — CD and the pre-deploy gate belong to [#54](https://github.com/Lamakira/docuflow/issues/54), telemetry sinks to [#55](https://github.com/Lamakira/docuflow/issues/55), the signing key to [#56](https://github.com/Lamakira/docuflow/issues/56), the AWS evidence account to [#57](https://github.com/Lamakira/docuflow/issues/57), Cloudflare and spend alerts to [#58](https://github.com/Lamakira/docuflow/issues/58), and the phase record to [#61](https://github.com/Lamakira/docuflow/issues/61).

**No secret value belongs in this file**, under the three tiers the inventory already sets out. That includes `DATABASE_URL`: the operator name and the host *suffix* are recorded here, the connection string never is.

## Before the first publish: the one-way doors

Four settings cannot be changed after the act that fixes them. Three of the four are fixed by publishing, and publishing is one click.

| # | Door | What it fixes | When it closes | Status |
| --- | --- | --- | --- | --- |
| 1 | **Plan tier** | Whether a geography can be chosen at all. Free publishes to North America by default | Before the publish, or the publish makes the choice for you | **Pro** — confirmed 2026-08-13 from the account. Replit lists publishing-geography selection on Core, Pro, and Enterprise |
| 2 | **Workspace geography** | Where *development* compute, the development database, and any Object Storage created before publishing live | At workspace creation — already closed for an existing App | *(unrecorded)* |
| 3 | **Publishing geography** | Where the published compute, the production database, and published Object Storage live, colocated | At the first publish, permanently | *(unrecorded — must read **Europe (EU)** before publishing)* |
| 4 | **Project separation** | Whether this is the parallel environment ADR-0018 requires or a second deployment of production | At project creation | **Separate** — confirmed 2026-08-13: `docuflow` is the parallel project; production is the App named `Techma documentation platform` |

Door 2 is new information. ADR-0021 states that "development environments run in North America regardless of publishing geography", and the register repeats it. Replit's current documentation does not: **workspace geography is selectable by Pro customers** across North America, Europe (EU), and Asia, and is fixed when the workspace is created. Publishing geography and workspace geography "do not need to match", and Replit notes that "resources such as Object Storage can be created before you publish and may not match your published geography."

The consequence is procedural and it is easy to miss: an App created in a North American workspace **stays** North American on the development side even when it publishes to the EU, and no later setting fixes it. If this App's workspace is not EU, the residency rule that follows from it — no restored production snapshot in the development database — binds exactly as ADR-0021 says. If it is EU, the rule is weaker in residency terms and still stands on isolation grounds, because a development database is not the published one. Record which is true rather than assuming either.

### The publish, step by step

1. Confirm the App is the parallel one and not production. Record its name and the production App's name in the table below.
2. Confirm the plan tier in billing. Recorded: **Pro**.
3. Read and record the workspace geography before touching anything else.
4. Publishing tool → Adjust settings: set the geography to **Europe (EU)**. Do not publish until the selector reads Europe (EU).
5. Confirm the deployment type is **Autoscale** and that build and run come from [`.replit`](../../.replit).
6. Set the Secrets the boot refusal requires — see [Secrets](#secrets-and-the-boot-refusal). `DATABASE_URL` is supplied by the platform; the rest are not.
7. Publish. Record the UTC timestamp: it is the moment the geography became permanent.
8. Check `/health`. It returns `{"status":"ok"}` and touches no database, which is what makes it a liveness check and not a readiness one — see [Health](#what-health-does-and-does-not-prove).
9. Read the deployment's boot line. If it says `over neon` rather than `over pg`, `.replit`'s `[env]` did not reach the published app: set `DB_DRIVER=pg` there too before anything else is judged.
10. Read the production database's host suffix and record the operator. Never record the connection string.

## The publish record

| | |
| --- | --- |
| Replit App (parallel) | `docuflow` — confirmed 2026-08-13 to be the parallel project and not production |
| Production Replit App, for contrast | `Techma documentation platform` — a different App, recorded so the separation is checkable rather than asserted |
| Plan tier at publish | **Pro** |
| Workspace geography | *(unrecorded)* |
| **Published geography** | *(unrecorded — target: Europe (EU))* |
| **Publish timestamp (UTC)** | *(unrecorded)* |
| Deployment type | *(unrecorded — expected Autoscale)* |
| Published URL | *(unrecorded)* |
| `/health` after publish | *(unrecorded)* |
| Development database operator | **Replit-hosted** — confirmed 2026-08-13 by the driver requirement below; host suffix still unread |
| Production database operator | *(unrecorded — does not exist until the publish)* |
| Repository and branch the App tracks | this repository, `main` — confirmed 2026-08-13 |
| App runs in the workspace | **Yes** — 2026-08-13. Node 24, dependencies installed, the journal's five migrations applied by `npm run db:migrate`, the site served by the "Start application" workflow |

The App tracking `main` has a consequence for everything below: **`.replit` reaches the App by merge, not by hand.** A change to the deployment's build command is a pull request, which is the property this ticket wants — but it also means the App runs whatever `main` says, so an unmerged branch is not what publishes.

It cuts the other way too, and this is the part that goes wrong quietly. Work done **in** the App — by the Agent or by hand — lives in that checkout until somebody commits and pushes it, so the App can be running code the repository does not have. On 2026-08-13 that was already true: bringing the app up in the workspace changed the upload contract in the web uploaders, and none of it is in `main` at the revision this document was written against. **What publishes is `main`.** An App whose working copy is ahead of `main` will publish something other than what was tested there, which is the same class of surprise `.replit`-by-hand would have been. Commit it, or accept that the publish does not include it.

## Gate: can one project run HTTP and a Reserved VM worker at once?

**Answered from documentation — 2026-08-13. The documented answer is no.** Recorded as a documentation answer, not a dashboard observation: the console may offer something the docs do not describe, and step 4 of the checklist above is where that gets checked.

| | |
| --- | --- |
| **The question** | ADR-0021's third gate: can one Replit project run an Autoscale HTTP deployment and a Reserved VM worker deployment simultaneously? |
| **What the documentation says** | Deployment type is **a property of the App**, selected "in the Publishing tool under **Adjust settings**, in the **Deployment type** dropdown". The `.replit` reference carries a single `[deployment]` table and a single `deploymentTarget`. No page describes two deployments of one App, and no page forbids it either — the case is simply absent. |
| **The reading** | A single-valued dropdown and a single-valued config key are how a platform expresses one-of. Absence of a prohibition is not permission when the configuration surface has nowhere to put the second value. |
| **The decision** | **The worker gets its own Replit project against this same repository.** That is the branch ADR-0021 provided for, taken on the documented shape of the configuration rather than on an experiment nobody has run. |

### What that costs, and how the repository absorbs it

One repository, one `.replit`, two projects that need different values in it. The worker project cannot simply take `main`'s file: it needs `deploymentTarget = "vm"` and a worker run command. Three ways out, and the choice is recorded here so Phase 3 does not rediscover it:

- **Edit `.replit` in the worker project.** Rejected: the file drifts from the repository silently, and the deployment configuration stops being reviewable in a diff, which is the property this whole phase is buying.
- **A Scheduled deployment instead of a Reserved VM.** Rejected on ADR-0013's terms. A scheduled job "runs a command on a schedule, then stops"; the scheduler is lease-elected and continuous, and the worker-lag SLO is 95% of jobs started under 60 seconds. A process that is absent between runs cannot hold a lease.
- **One `.replit`, one entry point, role from the environment.** **Chosen.** The worker project sets a variable — `DOCUFLOW_ROLE=worker` — and its deployment type is set in its own Publishing tool, where the HTTP project sets Autoscale. What differs between the projects is then a deployment-type dropdown and one variable, not a divergent file. Phase 3 builds the entry point that reads the variable; nothing in this ticket does, because there is no worker yet.

The one value that cannot live in the shared `.replit` is `deploymentTarget`, which the worker project's Publishing tool must carry instead. Record it in that project's row in the inventory when Phase 3 creates it.

## Databases

### One dialect, two operators, and only one variable

`DATABASE_URL` is what Replit supplies, in both environments. The `PG*` variables **are not provided on Replit's current infrastructure** — the documentation restricts them to apps still on the legacy Neon infrastructure and says to use `DATABASE_URL` instead.

This repository resolves either, in [`shared/databaseUrl.ts`](../../shared/databaseUrl.ts), with `DATABASE_URL` taking priority. That fallback is not dead code and it is not for Replit: it is what a local container, CI, and the harness use. [`docs/DB_ENV_SETUP.md`](../DB_ENV_SETUP.md) carries a checklist headed "Checklist avant de retirer DATABASE_URL sur Replit" — **that checklist is obsolete on this platform.** There is no supported state in which a Replit app runs on `PG*` variables with `DATABASE_URL` removed.

### `DB_DRIVER=pg`, in both environments

Set in [`.replit`](../../.replit)'s `[env]` block, which the [inventory](phase-2-provider-inventory.md) already designates as its home. Three reasons, in order of weight:

**Observed, not only reasoned: 2026-08-13.** Bringing the app up in the Replit workspace required `pg`; the serverless driver does not reach the App's database. That is the first reason below, confirmed rather than predicted.

1. **The Neon serverless driver may not reach the database at all.** It speaks WebSockets to Neon's endpoint. Replit's development databases have been Replit-hosted Postgres — Helium — since 2025-12-04, and the production database on current infrastructure is created by Replit at publish rather than provisioned on Neon. `pg` reaches both: node-postgres over TLS talks to a Neon database exactly as it talks to a container, which is why every operational script in `scripts/` already uses it and why ADR-0016 forbids Neon-only features.
2. **It is the instrumented path.** [`docs/OBSERVABILITY.md`](../OBSERVABILITY.md) records that the Neon driver is uninstrumented, so query spans appear under `DB_DRIVER=pg` and not under the default. Leaving the two environments on different drivers would produce different traces from the same code.
3. **It removes a difference that buys nothing here.** The serverless driver exists for environments that cannot hold a TCP connection. A long-lived Autoscale container can.

**Do not assume `[env]` reaches the published app, and check the boot line before believing it did.** `[env]` is documented as workspace configuration; whether a deployment inherits it is not stated anywhere in the `.replit` reference. The failure mode if it does not is the quiet kind, which is why it is called out here rather than left to be discovered: `server/config.ts` treats anything other than `pg` as `neon`, so an unset variable is not a boot refusal but a driver that cannot reach the database, failing at the first query instead of at startup. Read the published deployment's log for `[config] production — database DATABASE_URL over pg (…)` — `logConfigSummary` masks the password in it — and if it says `over neon`, set `DB_DRIVER=pg` in the published environment's own variables as well.

| | |
| --- | --- |
| Published boot line reports `over pg` | *(unrecorded)* |
| `DB_DRIVER` also set in the published environment's variables | *(unrecorded — needed only if `[env]` does not propagate)* |

### Pooling, and the `-pooler` hostname

`-pooler` is a **Neon** hostname convention — Neon publishes a direct and a pooled endpoint per project and the pooled one is selected by inserting `-pooler` into the host. It is meaningful only if the database on the other end is Neon. Nothing in Replit's current database documentation offers a pooled hostname, which makes this a question to close by observation, and the observation is one line: look at the host in the Database pane.

- If the host contains `neon.tech` — legacy Neon — the pooled endpoint is available and worth using from Autoscale.
- If it contains `helium` — Replit's own Postgres — there is no `-pooler` host to use, and the pool that matters is the client-side one.

**The client-side pool is not one pool but two, per process.** [`server/db.ts`](../../server/db.ts) opens a `pg.Pool`, and [`server/auth.ts`](../../server/auth.ts) hands `connect-pg-simple` a `conString`, which opens a second one. Both take node-postgres's default of 10 connections, so **one instance can hold 20**, and Autoscale multiplies that by the instance count. Record the database's connection limit from its dashboard, divide by twenty, and if the answer is smaller than the maximum instance count, cap the pools before it becomes an incident rather than after.

| Question | Answer | Recorded from |
| --- | --- | --- |
| Development database operator | *(unrecorded)* | Database pane, host suffix |
| Production database operator | *(unrecorded)* | Database pane, host suffix |
| Is a `-pooler` host offered? | *(unrecorded — expected only on Neon)* | Database pane |
| Connection limit | *(unrecorded)* | Database pane |
| Max Autoscale instances | *(unrecorded)* | Publishing tool |
| Pool caps needed? | *(follows from the three above)* | — |

### Migrations run as the Build command

```toml
[deployment]
deploymentTarget = "autoscale"
build = ["sh", "-c", "npm run build && node dist/migrate.mjs"]
run = ["npm", "run", "start"]
```

ADR-0021 places the gated pre-deploy step here, and the mechanism is that **a failing Build command fails the build and blocks the publish**. Three details make this the only correct home:

- **Not at boot.** #24 removed boot-time DDL; the server creates nothing.
- **Not in `run`.** Autoscale runs `run` in every instance. [`scripts/migrate.ts`](../../scripts/migrate.ts) takes no advisory lock, so two instances starting together would race the journal.
- **After `npm run build`, not before.** `dist/migrate.mjs` is a build output (#35).

One thing to verify at the first publish and record here: **whether the Build command's environment carries the production `DATABASE_URL`.** If it does not, the runner refuses for want of a database and the build fails — which blocks **every** publish, not just one, until the build command is changed back. That is the gate working as designed and it is also, on the first publish, indistinguishable from a broken deployment, so read the build log rather than guessing at a red X. The fallback if the build environment has no database is an operator-run `node dist/migrate.mjs` before the publish, and it is a weaker gate because nothing enforces it.

| | |
| --- | --- |
| Build log shows the migration runner | *(unrecorded)* |
| Migrations applied to the production database at publish | *(unrecorded)* |
| `npm run db:migrate:status` against production is clean | *(unrecorded)* |

### Agent-applied schema propagation

Replit documents the behaviour plainly: "At the time of publishing, any changes you've made with Agent to the structure of your development database (adding and deleting columns or tables) are applied to your production database." **No setting to disable it is documented.** That is the honest finding, and it changes what "turn it off" means for this ticket.

Say plainly what that does to the acceptance criterion, because half-meeting it quietly would be worse than missing it: #53 asks that "Agent schema propagation is demonstrably off", and **on this platform it cannot be turned off — only left unused.** What is demonstrable is that nothing travels the path, not that the path is closed. A later Replit release could add the toggle; until then, every claim in this section is about our own conduct rather than about a setting.

The control is therefore procedural, not a toggle, and it has one rule: **the Agent is never asked to change the schema in this project.** Every column and table arrives through [`migrations/`](../../migrations), applied by the runner. The journal stays the single authority ADR-0021 requires, and the propagation path stays empty because nothing puts anything into it.

Two things back that up rather than leaving it to discipline:

- [`npm run db:verify`](../../scripts/verify-schema.ts) diffs a real database against the journal in both directions. A column that exists in a database and not in the journal is exactly what out-of-band DDL looks like, which is the fault #24 existed for. Run it against production after the first publish, and after any publish that follows a schema change.
- The acceptance demonstration is a negative test, run once: make a schema change in the development database **without** the journal, publish, and confirm production did not receive it. If it did, this environment cannot hold the ADR-0021 line and that is a finding, not a formality.

| | |
| --- | --- |
| A toggle exists in the console | *(unrecorded — none is documented)* |
| Negative test performed | *(unrecorded)* |
| Result | *(unrecorded)* |
| `db:verify` against production | *(unrecorded)* |

## Secrets and the boot refusal

Secrets live in Replit Secrets, per project and per environment, per ADR-0015. `.replit` is in the repository and may hold only non-secret configuration — today `PORT` and `DB_DRIVER`.

[`server/config.ts`](../../server/config.ts) resolves every variable once at module load and **aborts boot listing every one that is absent or unusable**, rather than failing later on the first request that needs it. What it requires, and therefore what a published environment must carry before it can start:

| Variable | Held as | Supplied by |
| --- | --- | --- |
| `DATABASE_URL` | Secret | The platform, at publish |
| `SESSION_SECRET` | Secret | Generated |
| `JWT_SECRET` | Secret | Generated, written `<key-id>:<secret>` ([#56](https://github.com/Lamakira/docuflow/issues/56)) |
| `PRIVATE_OBJECT_DIR` | `[env]` or Secret | The App Storage bucket root |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `[env]` or Secret | The same bucket |

The storage credential is **not** on that list any more, and the reason is worth stating because it inverts what the inventory says: probed on 2026-08-13 in the provisioned App, the Google client cannot reach an App Storage bucket at all, so [#59](https://github.com/Lamakira/docuflow/issues/59) made the credential optional — supplying one selects Google, supplying none selects App Storage, which authenticates itself. A published environment that names no credential is correctly configured.

The refusal is not deployment infrastructure and must not be papered over by any: nothing in `.replit`, no default, and no fallback value may make a missing `SESSION_SECRET` boot. Confirm it still fires by reading the deployment log of a deliberately incomplete publish, or by the existing coverage in [`tests/smoke/config.test.ts`](../../tests/smoke/config.test.ts), which pins the message.

| | |
| --- | --- |
| Secrets present in the **development** workspace (names only) | 2026-08-13: `SESSION_SECRET` in Replit Secrets; `JWT_SECRET` generated; `DATABASE_URL` from the platform; the bucket roots in a git-ignored `.env` |
| Secrets present in the published environment (names only) | *(unrecorded — the publish has not happened)* |
| Secrets scoped separately for development and production | *(unrecorded)* |
| No value copied from the production project | *(unrecorded)* |
| Boot refusal observed to still fire | Indirectly, 2026-08-13: the app would not start until every required variable was supplied |

Two things about that development-side state are worth carrying rather than leaving in a chat log. **The bucket roots are placeholders** until an App Storage bucket exists, so uploads fail — and the rehearsal scrub reads those same roots to decide which bucket is "ours", which means a placeholder root would make every storage URL in a restored database look foreign. Fix the roots before rehearsing, not after. And **variables that live in a git-ignored `.env` in the workspace do not travel to the published environment**: the deployment reads Secrets and `.replit`, so every root and every secret has to exist there too, or the boot refusal fires on the published app exactly as designed.

## What `/health` does and does not prove

[`server/app.ts`](../../server/app.ts) answers `/health` with `{"status":"ok"}` before authentication and without touching the database. It proves the process is up and serving. It does not prove the database is reachable, migrated, or the right one — a published app with an unmigrated production database returns `ok` and then fails every request that reads a table.

So the acceptance criterion "boots and passes its health check" is met by two observations, not one: `/health` returning `ok`, **and** `npm run db:migrate:status` reporting nothing pending against the production database.

## Snapshot rehearsal

ADR-0018 lets production data in only as a restored snapshot; ADR-0022 specifies the pair — a logical database export and a key-preserving object copy taken at or after it — and ADR-0023 leaves that specification intact while moving the bucket to App Storage. Two properties have to hold before restored data is used, and both are now checkable by command:

1. **No absolute production storage URL survives in the database.** ADR-0023 made this sharper rather than softer: an App Storage destination is Google-backed, so a production URL and one of ours share the `storage.googleapis.com` host that [`server/downloadRoutes.ts`](../../server/downloadRoutes.ts) validates. Only the bucket name separates them, and `downloadRoutes.ts` redirects clients straight at `desktop_releases.storage_url`. An unscrubbed row reconnects this environment to production storage as data, with no credential involved.
2. **Every storage key the database names resolves in the destination bucket.** Keys the bucket holds that the database does not name are expected — they postdate the export. The reverse is a dangling key.

[`scripts/snapshot-rehearsal.ts`](../../scripts/snapshot-rehearsal.ts) performs both:

```bash
npm run snapshot:check                       # report; changes nothing; exit 1 on findings
npm run snapshot:scrub                       # apply the recorded rewrites, then re-check
npm run snapshot:check -- --keys manifest.txt   # also verify keys against the copy manifest
npm run snapshot:check -- --against "$URL"      # a database other than the configured one
```

Three properties of it are deliberate:

- **The scan is driven by `information_schema`, not a table list.** ADR-0022 asks for "a check across every column that can hold one, not a fix to the one table known today", so every `text`, `varchar`, `character`, `json`, `jsonb`, and **array** column in the public schema is scanned — URLs buried inside JSON included. Arrays are on that list because `information_schema` reports every array type under the single name `ARRAY`: a `text[]` column is not reported as text, and the first version of this scan walked straight past `crm_project_notes.mentioned_user_ids`.
- **"Ours" comes from the object-storage roots the environment is already configured with**, not a new variable. A second place to name the bucket is a second place to get it wrong.
- **A finding in a column no rule covers fails the run with the database untouched.** One rule is recorded, because ADR-0022 settled one: a foreign `desktop_releases.storage_url` becomes `/downloads/{platform}`, the local path `downloadRoutes.ts` already understands, which reports the platform unavailable until this environment has built its own installer ([#60](https://github.com/Lamakira/docuflow/issues/60)). Anything else is a decision for a human, and guessing at it is the failure this check exists to prevent.

The **residency guard** refuses to run when `REPLIT_DEV_DOMAIN` is set — the signal that the process is in the workspace rather than the published app — unless `ALLOW_DEVELOPMENT_REHEARSAL=1` is set explicitly, in the same shape as the harness's `ALLOW_REMOTE_TEST_DB` and config's `ALLOW_REMOTE_OTLP`. It is a heuristic and is documented as one: it enforces ADR-0021's rule at the one moment the rule is easy to break, and the override exists for synthetic data.

### The procedure

1. **Export**, operator-run, from the production stack: a logical dump, held on the operator's machine, never in this repository, its CI, or its Secrets.
2. **Copy the objects**, at or after the export, key-preserving, into this environment's bucket. Write the manifest — object names, sizes, checksums, counts, both timestamps. It is the Phase 2 evidence artifact and names no credential.
3. **Import** into a database in the **published** environment. Never into a Replit development database whose workspace is outside the published geography.
4. **Scrub**: `npm run snapshot:scrub`. It refuses rather than guesses.
5. **Verify keys**: `npm run snapshot:check -- --keys manifest.txt`. Exit 0 is the gate.
6. **Record** the run: timestamps, row counts, what was scrubbed, dangling keys if any.

### Exercised once against a synthetic export — 2026-08-13

Run locally against PostgreSQL 16, on synthetic rows only. No production data, no production credential, no Replit resource was involved; the check itself is what was being tested.

| Step | Result |
| --- | --- |
| Source database built from the journal, seeded with synthetic rows | 1 user, 2 documents, 1 desktop release carrying a production-shaped URL |
| `pg_dump` logical export | 71,267 bytes |
| Import into a second database | 2 documents, 1 release |
| `snapshot:check` before scrubbing | **exit 1** — `desktop_releases.storage_url` (1 row): `https://storage.googleapis.com/docuflow-production/installers/…` |
| `snapshot:scrub` | 1 row rewritten to `/downloads/windows`; re-check clean |
| `snapshot:check --keys` against a manifest missing one object | **exit 1** — dangling: `.private/uploads/doc-missing` |
| `snapshot:check --keys` against the complete manifest | **exit 0** — every key the database names resolves |

The two failure cases are in the record on purpose. A rehearsal that only ever shows a clean run has not shown that the check can fail.

Automated coverage is in [`tests/smoke/snapshot-rehearsal.test.ts`](../../tests/smoke/snapshot-rehearsal.test.ts), including the case that matters most: a foreign URL in a column no rule covers refuses the run and leaves the database unchanged.

## The Dockerfile is not the deployment artifact

Replit documents no container deployment path, so the image built in Phase 1 is not what publishes. It stays as the CI harness and as portability insurance — the thing that keeps ADR-0021 cheap to undo. [`docs/CONTAINER.md`](../CONTAINER.md) now says so at the top, so a reader who arrives at an 800-line container document does not conclude that the deployment runs it.

## Corrections to earlier records

Three claims held elsewhere in this repository do not survive the platform's current documentation. All three are recorded here, and the two load-bearing ones are also carried back into [ADR-0021](../adr/0021-run-the-compute-on-replit-and-supersede-the-render-hosting-decision.md) and the [inventory](phase-2-provider-inventory.md).

### Point-in-time restore is contested, not answered

The inventory records the PITR gate as **Answered — yes, 7 days on Core and 28 on Pro**, citing Replit's documentation on 2026-08-12. Read again on 2026-08-13, Replit's documentation says both of these things:

- The **Pro plan page** advertises a "4× database recovery window": "Restore your database to any point in time within the last 28 days, instead of the standard 7 days."
- The **database reference** attributes point-in-time restore to the **legacy Neon** infrastructure and gives current **Helium** databases a rollback-to-checkpoint feature instead — restore to an Agent checkpoint, which is not a point in time.

Both are provider statements and they do not agree. Which one governs this environment depends on what operator the published production database turns out to run, which is precisely the cell the publish fills. Until then the gate is **Contested**, and ADR-0016's five-minute RPO is unmet on this platform in the same way it was before — with one difference that matters to [#57](https://github.com/Lamakira/docuflow/issues/57): if production is Helium, the nightly logical exports to the AWS evidence account are the recovery point of record again, not merely the immutable evidence copy.

Nothing here says the earlier answer was carelessly recorded. It cited what the billing page still says. The lesson is narrower and worth keeping: a plan page describes a plan, and a reference page describes an operator, and this platform changed its operator between them.

### Development environments are not unconditionally North American

Covered above under [the one-way doors](#before-the-first-publish-the-one-way-doors). Pro selects workspace geography; the selection is fixed at workspace creation.

### `PG*` variables are not provided on current infrastructure

Covered above under [databases](#one-dialect-two-operators-and-only-one-variable). The fallback in this repository remains correct for local and CI use, and the Replit-specific checklist in `docs/DB_ENV_SETUP.md` is obsolete.

## What downstream tickets need from this document

| Ticket | Needs |
| --- | --- |
| [#54](https://github.com/Lamakira/docuflow/issues/54) | Whether the Build command's environment carries `DATABASE_URL`. It decides whether the pre-deploy gate can live in the build at all |
| [#55](https://github.com/Lamakira/docuflow/issues/55) | `DB_DRIVER=pg`, so query spans exist; and the published service name for `OTEL_SERVICE_NAME` |
| [#56](https://github.com/Lamakira/docuflow/issues/56) | The published project whose Secrets hold `JWT_SECRET` across a restart |
| [#57](https://github.com/Lamakira/docuflow/issues/57) | The PITR finding. If production is Helium, the nightly exports are the recovery point of record and not only the evidence copy |
| [#58](https://github.com/Lamakira/docuflow/issues/58) | The published URL and geography, for the Cloudflare front |
| [#60](https://github.com/Lamakira/docuflow/issues/60) | The scrub rule: restored installer rows report the platform unavailable until this environment publishes its own |
| [#61](https://github.com/Lamakira/docuflow/issues/61) | This document, filled, as the deployment and database half of the Phase 2 record |
| Phase 3 | The worker is a **second Replit project** on this repository, Reserved VM, its role selected by `DOCUFLOW_ROLE=worker` rather than by a divergent `.replit` |

Phase 2 does not close on a document of empty cells. Each one is filled by a human act against a dashboard, and no status here may be inferred from a merged pull request.
