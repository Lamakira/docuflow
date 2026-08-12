# Parallel-environment provider inventory

- **Recorded:** 2026-08-12
- **Revision:** [`ac3dfb02b44549e2414aab7ba971bed2ed52dbe9`](https://github.com/Lamakira/docuflow/commit/ac3dfb02b44549e2414aab7ba971bed2ed52dbe9) (`main`)
- **Status:** **Nothing is provisioned.** Every account below is **Not provisioned**, every identifier cell is empty, and both ADR-0021 procurement gates are **Unanswered**. This document is the register that [#52](https://github.com/Lamakira/docuflow/issues/52) fills; it is not evidence that #52 has been done.

## Authority and scope

[ADR-0018](../adr/0018-build-in-a-parallel-environment-with-snapshot-rehearsed-cutover.md) requires that migration work run in a fully isolated parallel environment on fresh accounts and secrets, holding no production credential, production URL, or data-plane connection to production. [ADR-0021](../adr/0021-run-the-compute-on-replit-and-supersede-the-render-hosting-decision.md) keeps the compute on Replit, which makes that isolation two separate Replit projects with disjoint secrets, and leaves ADR-0016's storage, evidence, and observability providers standing. [ADR-0022](../adr/0022-provision-r2-in-phase-2-and-replace-the-gcs-move-with-a-snapshot-copy.md) moves the environment's own R2 bucket into Phase 2. [ADR-0015](../adr/0015-own-audit-privacy-and-compliance-controls-behind-platform-ports.md) puts secrets in the platform's secret store.

This document is the accounts register for that environment: one row per provider, naming what was bought, where it lives, which variables its credentials occupy, and who can log in. It records **identities, never secret values**.

It does not provision anything. Account signup, plan upgrade, billing detail, and dashboard consent are human acts, and #52 is a human-run ticket. What an agent can supply — the variable surface the repository actually reads, the question each gate has to answer, and the shape of the record — is supplied here so that filling it in is transcription rather than design.

Boundaries with the rest of Phase 2: the first publish and the permanent geography choice belong to [#53](https://github.com/Lamakira/docuflow/issues/53), the AWS Object Lock configuration and nightly exports to [#57](https://github.com/Lamakira/docuflow/issues/57), spend-alert **thresholds** and the Cloudflare front to [#58](https://github.com/Lamakira/docuflow/issues/58), and the R2 bucket and the storage adapter that reaches it to [#59](https://github.com/Lamakira/docuflow/issues/59). #52 registers the accounts and the alert **contacts**; those tickets configure them.

Relative repository links below are navigation aids. Audit each linked artifact at the revision pinned above, not at a later branch tip — a variable this document names as read in one place may have moved by the time the row it justifies is filled.

## What may be written here, and what may not

Three tiers, and the middle one is the one that gets people:

- **Recorded in this file.** Anything that grants no access on its own: account or organization name, project name, DNS zone name, region and jurisdiction, plan tier, bucket name, variable names, the holder of the login, the alert recipient. Provider-issued account identifiers that are addresses rather than credentials — a Cloudflare account ID, an AWS account ID, a Sentry organization slug — are recorded, because a later ticket has to be able to name the account it targets, which is #52's whole purpose.
- **Recorded as a location, never as a value.** The login itself, and any identifier that is half of a credential pair or an ingest path: an R2 access key ID, a Sentry DSN, a database hostname carrying a role name. The inventory names the vault entry that holds it and who can open that entry. It does not reproduce it.
- **Never in this repository, in `.replit`, or in an evidence record.** API keys, tokens, secrets, passwords, connection strings, signed URLs, private keys, and anything derived from one.

`.env` is git-ignored, which stops an accident from being committed; it does not make a secret acceptable to put there. The same rule applies to this file with no ignore rule behind it at all.

## Status vocabulary

- **Provisioned** — the account exists, someone has signed into its dashboard, and the row below was filled from what that dashboard shows.
- **Not provisioned** — no account exists yet, or one exists and nobody has read its identifiers off the dashboard. These are the same status on purpose: an unread account cannot be named by a downstream ticket.
- **Answered** / **Unanswered** — for the two gates only. An answer is a statement from the provider or an observation from its dashboard, recorded with its date and where it came from. An expectation is not an answer.

No row may be filled from what a plan is assumed to include. Fill it from the dashboard.

Two kinds of value appear in the table below and they must not be confused. A cell marked **Required:** is a target this environment has to hit, taken from an ADR — it is what to buy, not what was observed. Every other filled cell is an observation and may only be written after someone read it off the provider. An empty cell is neither.

## Provider inventory

| Provider | Purpose | Status | Account identifier | Region / jurisdiction | Plan | Login held by | Spend-alert contact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Replit** (parallel project) | The compute plane; holds every other provider's secret | **Not provisioned** | — | **Required:** publish to **Europe (EU)**. Development runs in North America regardless | **Required:** **Core or above**, before the first publish, because Free publishes to North America | — | — |
| **Neon** (production database) | The authoritative PostgreSQL 16 | **Not provisioned** | — | Colocated with the published Replit geography (ADR-0021) — confirm on the dashboard | Arrives with the Replit project; not bought separately | — | Billed through Replit |
| **Replit Helium Postgres** (development database) | The development-environment database | **Not provisioned** | — | **North America** (ADR-0021) — confirm | Arrives with the Replit project | — | Billed through Replit |
| **Cloudflare** | DNS zone for the environment's own hostname; CDN, WAF, and edge rate limits in [#58](https://github.com/Lamakira/docuflow/issues/58) | **Not provisioned** | — | — | — | — | — |
| **Cloudflare R2** | Files, screenshots, Derived Artifacts, installers | **Not provisioned** | — | **Required:** the **`eu` jurisdiction**, set at bucket creation | — | — | — |
| **AWS** (standalone) | The Object-Locked evidence copy, and nothing else | **Not provisioned** | — | **Required:** **Frankfurt** (ADR-0016), set at bucket creation in [#57](https://github.com/Lamakira/docuflow/issues/57) | — | — | — |
| **Better Stack** | Logs, metrics, uptime, heartbeats, on-call, status page | **Not provisioned** | — | **Required:** the **EU region** | — | — | — |
| **Sentry** | Web and desktop error tracking | **Not provisioned** | — | **Required:** the **Germany region** | — | — | — |

Region and jurisdiction are chosen at creation on several of these and cannot be moved afterwards — the Replit publishing geography, the R2 jurisdiction, the AWS bucket region, the Better Stack region, and the Sentry region are all one-way doors.

**Frankfurt is nameable for AWS and not for Replit**, and the difference is documentation rather than preference: `eu-central-1` is a documented AWS region, while the EU city Replit publishes to is not documented at all. Claim **EU residency** for the Replit environment and never Frankfurt; ADR-0016's Frankfurt line survives for the AWS bucket, where it can be verified.

Whether the Replit project hosts **both** runtimes is not settled here. ADR-0021's third gate — whether one project can run an HTTP deployment and a Reserved VM worker deployment simultaneously — is undocumented and owned by [#53](https://github.com/Lamakira/docuflow/issues/53). If it cannot, the worker needs a **second Replit project** against this same repository, and that project gets its own row here with its own Secrets.

Two spend signals are recorded now so [#58](https://github.com/Lamakira/docuflow/issues/58) has somewhere to attach a threshold: **R2 stored-bytes growth** is watched as its own signal, and **Replit bills in two shapes** — the subscription plus deployment pricing, where a Reserved VM bills a fixed monthly amount whether or not it is busy while Autoscale bills per request. The always-on worker is therefore a standing cost, not a variable one.

The AWS account is standalone on purpose. It exists so that the evidence copy survives the compromise or loss of every other account in this table, which it does not do if it shares an organization, a payer, or an identity provider with them.

### Accounts this environment needs that #52's scope list does not name

ADR-0018 lists the accounts that must be fresh: "the database is a new Neon account, and hosting, object storage, the evidence account, identity, and billing all use fresh accounts and secrets provisioned for this effort." Three providers this environment holds credentials for appear in **neither** that list nor #52's scope — AI, email, and meeting transcripts. They are registered here because an account named by nothing is an account nobody buys and somebody eventually borrows:

| Provider | Purpose | Status | Consequence while absent |
| --- | --- | --- | --- |
| **OpenAI** | Embeddings, chat, transcription | **Not provisioned** | `OPENAI_API_KEY` is optional at boot; embeddings, chat, and transcription fail when used |
| **Resend** | Outbound email | **Not provisioned** | Sends fail and report why; the request that triggered them still succeeds |
| **Fathom** | Meeting transcripts | **Not provisioned** | Optional. Transcripts fall back to the browser scraper |

**None of the three blocks boot** — each is optional in [`server/config.ts`](../../server/config.ts), which is why they can be left to a later ticket. That is also the risk: an optional credential is the one somebody satisfies with a key they already have, and "it's only optional" is the sentence that gets a production key into this environment. Whoever fills this table should name the ticket that buys them; this document does not claim that decision.

[#58](https://github.com/Lamakira/docuflow/issues/58) also lists **Azure Speech** among the providers needing a spend alert, and it gets no row here because there is nothing yet to provision. [ADR-0014](../adr/0014-serve-retrieval-and-ai-through-an-intelligence-module.md) names it "provisionally Azure Speech for first-party speech-to-text (French and English launch languages), final selection gated on a consented benchmark" — an unselected future provider, not configuration hiding somewhere. Consistently, no variable in `server/config.ts` or [`.env.example`](../../.env.example) names it and no dependency in [`package.json`](../../package.json) reaches it. It needs a row when the benchmark selects it, not before.

## Variable occupancy

A Replit Secret reaches the process under the same name it is stored as, so #52's "environment-variable and Replit Secret names" collapse into one column rather than two. That is the one piece of unobserved product behavior this section rests on — confirm it at the dashboard under [#53](https://github.com/Lamakira/docuflow/issues/53) rather than inheriting it from here.

What differs per variable is *where* it is set: a **Secret**, scoped per project and per environment, or plain non-secret configuration in `.replit`'s `[env]` block, where `PORT` already sits. **No row marked Secret below may be written into `.replit`** — that file is in the repository. The `[env]` rows are precisely the ones that may.

The table covers variables a provisioned provider's credential or address occupies. Host-only settings such as `PLAYWRIGHT_CHROMIUM_PATH`, tuning such as `OTEL_METRIC_EXPORT_INTERVAL_MS`, and the test harness's own variables belong to no provider in this inventory and are documented in [`docs/CONFIGURATION.md`](../CONFIGURATION.md) instead. The **server's** variables are read in [`server/config.ts`](../../server/config.ts) and nowhere else; the release scripts and the harness read their own, which is the scoping [`.env.example`](../../.env.example) states and which the last two rows below depend on.

| Variable | Held as | Provider | Configured by |
| --- | --- | --- | --- |
| `DATABASE_URL` | Secret | Neon (production) / Helium (development) | [#53](https://github.com/Lamakira/docuflow/issues/53) |
| `DB_DRIVER` | `[env]` | Neon / Helium | [#53](https://github.com/Lamakira/docuflow/issues/53) — see [Databases](#databases-one-dialect-two-operators) |
| `SESSION_SECRET`, `JWT_SECRET`, `JWT_PREVIOUS_SECRET` | Secret | None — generated, not bought | [#56](https://github.com/Lamakira/docuflow/issues/56) |
| `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` | `[env]` | Cloudflare R2 | [#59](https://github.com/Lamakira/docuflow/issues/59) |
| The storage credential | Secret | Cloudflare R2 | [#59](https://github.com/Lamakira/docuflow/issues/59) — **name not yet fixed**, see below |
| `OTEL_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `ALLOW_REMOTE_OTLP` | `[env]` | Better Stack | [#55](https://github.com/Lamakira/docuflow/issues/55) |
| `OTEL_EXPORTER_OTLP_HEADERS` | Secret — it carries the ingest token | Better Stack | [#55](https://github.com/Lamakira/docuflow/issues/55) |
| The Sentry DSN | Secret | Sentry | [#55](https://github.com/Lamakira/docuflow/issues/55) — **name not yet fixed**, see below |
| The AWS evidence credentials | **Neither** — ADR-0016 confines them to the backup job's environment group, so they are not this project's Secrets and not `.replit` | AWS | [#57](https://github.com/Lamakira/docuflow/issues/57) — **names not yet fixed** |
| The Cloudflare zone | **No application variable.** The zone is fronting, not a runtime credential; any Cloudflare API token belongs to whoever automates DNS and never to this project's Secrets | Cloudflare | [#58](https://github.com/Lamakira/docuflow/issues/58) |
| `OPENAI_API_KEY` | Secret | OpenAI | Unassigned |
| `RESEND_API_KEY` | Secret | Resend | Unassigned |
| `RESEND_FROM_EMAIL` | `[env]` | Resend | Unassigned |
| `FATHOM_API_KEY` | Secret | Fathom | Unassigned |
| `APP_URL` | `[env]` | The environment's own hostname | [#53](https://github.com/Lamakira/docuflow/issues/53), [#58](https://github.com/Lamakira/docuflow/issues/58) |
| `MCP_API_KEY`, `DESKTOP_RELEASE_CI_TOKEN` | Secret | None — issued by us | Read per request, so rotating either needs no restart. `DESKTOP_RELEASE_CI_TOKEN` is **not** server-only: the release scripts and `server/downloadRoutes.ts` read it too, and the workflow that presents it is the unresolved ADR-0018 conflict in [#60](https://github.com/Lamakira/docuflow/issues/60) |
| `REPL_ID`, `ISSUER_URL`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN` | Set by the Replit runtime, never by hand | Replit | Leave with the OIDC login in Phase 5. `REPL_ID` is also read by [`vite.config.ts`](../../vite.config.ts), so removing it in Phase 5 touches the build and not only the login |

Two names in that table are deliberately blank, and neither is an oversight:

- **The storage credential.** [`server/objectStorage.ts`](../../server/objectStorage.ts) is a Google Cloud Storage client today, so the variables that exist are GCS-shaped — `GCS_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`, plus `GCS_PROJECT_ID`. ADR-0022 puts the S3-shaped adapter for R2 in #59, and the credential variables arrive with it. What survives the swap is the bucket-root form: ADR-0022 makes the bucket name and prefix configuration rather than identity, which is what lets a restored database resolve against a differently named bucket, and it names `PRIVATE_OBJECT_DIR` doing so — `normalizeObjectEntityPath` reduces uploads to `/objects/{entityId}` beneath it. ADR-0022 does not name `PUBLIC_OBJECT_SEARCH_PATHS`; it is the same shape, so treat its survival as expected rather than decided and settle it in #59. Provision the bucket under #52; name its variables under #59.
- **The Sentry DSN.** No Sentry SDK is installed at this revision — [`docs/OBSERVABILITY.md`](../OBSERVABILITY.md) records it as a known gap, with server-side `logError` already producing an OTLP record that Phase 2 has to point somewhere. #55 introduces the client and the variable together.

One requirement here is easy to miss and blocks the first telemetry export rather than failing quietly: boot **refuses** a non-local `OTEL_EXPORTER_OTLP_ENDPOINT` unless `ALLOW_REMOTE_OTLP=1` is also set. That refusal is ADR-0018 doing its job — it exists to stop this environment shipping telemetry to a production sink — and pointing at Better Stack is the first legitimate reason to opt out of it.

## Databases: one dialect, two operators

Neither database is bought here. Both arrive with the Replit project: **production is Neon**, **development is Replit's own Helium Postgres**. They are the same PostgreSQL 16 dialect and not the same operator, and three consequences follow.

**The migration journal is the single authority over schema in both.** Not Agent-applied schema changes propagated at publish; #53 turns that path off. Expand/contract discipline and the never-a-down-migration rule are load-bearing rather than merely prudent under ADR-0021, because a published app is rolled back by reverting the project to an earlier checkpoint and publishing again, not by redeploying a prior image.

**`DB_DRIVER` may not be the same value in both environments.** The default is Neon's serverless driver, which reaches PostgreSQL over WebSockets; `pg` selects node-postgres for a database that driver cannot reach. Whether Helium accepts the Neon driver is a question for #53, alongside the pooling and `-pooler` hostname question it already carries. It also has an observability edge: [`docs/OBSERVABILITY.md`](../OBSERVABILITY.md) records that the Neon driver is uninstrumented, so query spans appear under `DB_DRIVER=pg` and not under the default. Two environments on different drivers therefore produce different traces.

**No restored production snapshot may be loaded into the development database.** Replit development environments run in North America regardless of publishing geography, which makes ADR-0018's snapshot rehearsal a data-residency question and not only an isolation one. Rehearsal runs against a database in the published EU environment. The same binding applies to the object half of the snapshot pair under ADR-0022: the R2 bucket carries the `eu` jurisdiction, and no copy of it may be loaded into a Replit development environment either.

**We may not hold a Neon login at all.** A Replit-provisioned database is administered from Replit. If there is no Neon dashboard to sign into, the "Login held by" cell for Neon is honestly empty, and the PITR gate below becomes unanswerable by inspection — it has to be asked of Replit. Record which of the two situations is true, because it is the same shape of problem as the Clerk gate: a managed dependency whose controls we can neither see nor export from.

## The two ADR-0021 procurement gates

ADR-0021 leaves three questions gating execution. Two are procurement questions that #52 owns; both are recorded below and both are still **Unanswered**, which is the status this document ships in. The third — whether one Replit project can run an HTTP deployment and a Reserved VM worker deployment simultaneously — is a deployment-topology question owned by [#53](https://github.com/Lamakira/docuflow/issues/53), and is named here only so that a reader counting gates finds all three.

### Gate: point-in-time restore on the Replit production database

**Status: Unanswered.**

| | |
| --- | --- |
| **The question** | Does the Replit-provisioned production database support point-in-time restore, and at what retention window? |
| **What is documented today** | No PITR. Only a seven-day soft-delete window on **deleted** databases, which is recovery from deletion and not recovery to a point in time. |
| **How to answer it** | Ask Replit directly — this cannot be settled by reading the dashboard, because an absent control is indistinguishable from an undocumented one. Record the answer, its date, and who gave it. |
| **What to record either way** | The answer, verbatim in substance, with its retention figure if there is one. A "no" is as much of a result as a "yes" and closes the gate identically. |

**Until it is answered, ADR-0016's five-minute RPO is unevidenced on this platform.** The real recovery point is set by the nightly logical exports to the AWS evidence account under [#57](https://github.com/Lamakira/docuflow/issues/57), which the exposed `DATABASE_URL` does permit — so the honest RPO today is one night, not five minutes, and any document that repeats the five-minute figure before this gate closes is repeating an assumption. If the answer is "no PITR", that is not a blocker for Phase 2; it is a correction that ADR-0016's recovery targets need, and it should be raised as one.

### Gate: Clerk tenant ownership

**Status: Unanswered.** **Escalate; do not default.**

| | |
| --- | --- |
| **The question** | Can users be exported from the Replit-managed Clerk tenant, by any documented path? |
| **What is documented today** | The managed tenant is not reachable from the Clerk dashboard — it is administered from Replit's Auth tool — and no export path for its users is documented. |
| **How to answer it** | Ask Replit and Clerk both. An export path that exists only as an undocumented API call is worth recording as exactly that, because its availability is then someone's discretion rather than a contract. |
| **The decision it forces** | Per ADR-0021: Phase 5 adopts the managed tenant **only if** an export path is confirmed. Otherwise a **DocuFlow-owned Clerk account** is provisioned instead. |

The reason ADR-0021 calls this an escalation rather than a default is worth restating, because the cheap path is the one that looks free: a tenant we cannot export from converts ADR-0007's replaceable identity seam into a dependency whose exit cost is unknown. Unknown, not high — the cost cannot be estimated at all, which is what makes it unfit for a default. Phase 5 is far enough away that the answer can be waited on; it is not far enough away that the question can be forgotten, which is why it is registered here rather than there.

If the answer forces a DocuFlow-owned Clerk account, that account gets a row in the [provider inventory](#provider-inventory) with the rest, and it is a fresh account under ADR-0018 like every other.

## Demonstrating that the Replit project is separate

#52's acceptance requires that the parallel project be **demonstrably** separate from the production project, sharing no secrets. The pressure runs the other way — the subscription is already paid, which is exactly what tempts migration work into the production project — so the check is worth making explicit and recording as an observation rather than an intention:

- The parallel project is a **distinct Replit project**, not a branch, fork, or environment of the production one. Record its project name here.
- Its **Secrets pane is populated independently**. Record that the two projects' secret **names** overlap where the application requires the same variables, and that no **value** was copied between them. Every value in the parallel project is newly issued by its own provider account.
- **No production hostname, database, bucket, or collector** is named in this project's Secrets, in [`.replit`](../../.replit), or in this repository. `ALLOW_REMOTE_OTLP` and `ALLOW_REMOTE_TEST_DB` exist as deliberate opt-outs of exactly this rule and are set only against sinks and databases belonging to this environment.
- The desktop release workflow remains a known, unresolved ADR-0018 conflict, carried by [#60](https://github.com/Lamakira/docuflow/issues/60) — it is production-oriented and is not made compliant by anything in #52.

The acceptance criterion that **zero secret values reach the repository** is verified by inspection of the diff, and a reviewer should read every added line rather than trust a pattern. A pattern scan is a floor and not a substitute — and it carries no pathspec on purpose, because the files most likely to receive a secret by accident are `.replit` and `.env.example`, not the documentation:

```bash
git diff origin/main... | grep -nEi 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|postgres(ql)?://[^ ]*:[^ @]*@|Authorization:[[:space:]]*(Bearer|Basic)|(sk|rk|pk)-[A-Za-z0-9_-]{16,}|[?&](X-Amz-Signature|Signature|Policy|Key-Pair-Id)='
```

## What downstream tickets need from this document

| Ticket | Needs |
| --- | --- |
| [#53](https://github.com/Lamakira/docuflow/issues/53) | The Replit project and its plan tier, confirmed **Core or above before the first publish** — the geography is permanent and Free publishes to North America |
| [#54](https://github.com/Lamakira/docuflow/issues/54) | The project the CD path deploys to, and the database its pre-deploy migration gate runs against |
| [#55](https://github.com/Lamakira/docuflow/issues/55) | The Better Stack (EU) and Sentry (Germany) accounts, and their ingest configuration |
| [#56](https://github.com/Lamakira/docuflow/issues/56) | The Replit project whose Secrets hold the signing key across a restart |
| [#57](https://github.com/Lamakira/docuflow/issues/57) | The standalone AWS account, and — through the PITR gate above — the reason the nightly exports carry the real recovery point |
| [#58](https://github.com/Lamakira/docuflow/issues/58) | Every provisioned provider and its registered alert contact, so a threshold has a recipient |
| [#59](https://github.com/Lamakira/docuflow/issues/59) | The R2 bucket, its `eu` jurisdiction, and the account holding it |
| [#61](https://github.com/Lamakira/docuflow/issues/61) | This document, filled, as an input it cites. #61 writes `docs/migration/phase-2-lift-hosting.md` in the Phase 1 vocabulary — Verified / Partial / Open — and this register is not that record |

Phase 2 cannot close on an inventory of empty cells. Filling one is a human act performed against a provider dashboard, and no status here may be inferred from an issue being closed, a plan being purchased, or a green CI run.
