# Phase 1 stabilization evidence

- **Recorded:** 2026-08-10
- **Evaluated revision:** [`74c7a211719bb9a00e8474bbce9e3d40a20a94a2`](https://github.com/Lamakira/docuflow/commit/74c7a211719bb9a00e8474bbce9e3d40a20a94a2) (`main`)
- **Verdict:** **Open** — repository implementation and CI/image checks exist, but the server CD and synthetic-staging gate is not complete.

## Authority and scope

[ADR-0017](../adr/0017-migrate-in-place-through-nine-gated-phases.md) defines the Phase 1 gates and requires a per-phase evidence trail. [ADR-0018](../adr/0018-build-in-a-parallel-environment-with-snapshot-rehearsed-cutover.md) amends the execution environment: deployment and rehearsal work must use an isolated parallel environment with fresh accounts and secrets, never production connections, credentials, URLs, or data-plane access. The nine phases and their gates otherwise remain in force.

This record evaluates durable repository artifacts and CI at the revision above. Its vocabulary is strict:

- **Verified** — implementation exists and an applicable repository or CI verifier ran successfully in the pinned CI run.
- **Partial** — implementation exists, but the operational proof needed to finish the gate does not.
- **Open** — the gate is not implemented or has not been reassigned by an architecture decision.

Repository and CI evidence cannot prove that a service was deployed, a secret was provisioned, a migration ran against a deployed database, or telemetry reached a collector. No operational result is inferred from source, issue closure, or a green CI run.

Relative repository links below are navigation aids. Audit each linked artifact at the evaluated revision, not at a later branch tip; full merge identities are recorded separately for ancestry checks.

## Phase 1 gates

| ID | Gate from ADR-0017 | Status | Evidence at the evaluated revision | Limit / remaining proof |
| --- | --- | --- | --- | --- |
| G1 | Remove Replit sidecar and connector dependencies | **Verified** | [Issue #22](https://github.com/Lamakira/docuflow/issues/22) / [PR #30](https://github.com/Lamakira/docuflow/pull/30), merge `815000277248c52e71d776e57bbf7854dad6de1c`; centralized runtime configuration in [`server/config.ts`](../../server/config.ts), direct provider configuration in [`server/objectStorage.ts`](../../server/objectStorage.ts) and [`server/email.ts`](../../server/email.ts), and configuration tests in [`tests/smoke/config.test.ts`](../../tests/smoke/config.test.ts). | The cited runtime configuration and provider paths no longer require the retired sidecar or connectors. Replit OIDC remains intentionally assigned to Phase 5; this is not a repository-wide claim about every Replit-related development dependency or an external host. |
| G2 | Containerize the application | **Verified** | [Issue #25](https://github.com/Lamakira/docuflow/issues/25) / [PR #34](https://github.com/Lamakira/docuflow/pull/34), merge `f7fdff054b3254708095664a83af6e7e637d04fa`; [`Dockerfile`](../../Dockerfile), [`.dockerignore`](../../.dockerignore), [`docs/CONTAINER.md`](../CONTAINER.md), and the `image` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). | CI builds without pushing and then performs separate runtime probes inside the built image. This is image verification, not deployment evidence. |
| G3 | Add CI/CD with synthetic staging | **Partial** | Continuous integration exists in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): the `test` and `image` jobs run for pull requests and pushes to `main`. [Issue #25](https://github.com/Lamakira/docuflow/issues/25) / [PR #34](https://github.com/Lamakira/docuflow/pull/34), merge `f7fdff054b3254708095664a83af6e7e637d04fa`. | No server deployment target, server CD job, or synthetic-staging workflow exists. [`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml) is a production-oriented desktop installer release path: tag-triggered publish steps upload installers and register release metadata using configured secrets. That production coupling conflicts with ADR-0018 and remains unresolved; it is neither server CD nor synthetic staging. Implement the missing server path in the isolated parallel environment, or amend the architecture explicitly. |
| G4 | Consolidate schema changes into plain-SQL migrations and apply them as a gated pre-deploy step | **Partial** | [Issue #24](https://github.com/Lamakira/docuflow/issues/24) / [PR #33](https://github.com/Lamakira/docuflow/pull/33), merge `d869dd411568739a9e2a1d52020b193cb24fccf3`: ordered journal in [`migrations/`](../../migrations), runner in [`scripts/migrate.ts`](../../scripts/migrate.ts), verifier in [`scripts/verify-schema.ts`](../../scripts/verify-schema.ts), and migration/parity tests described in [`migrations/README.md`](../../migrations/README.md). [Issue #35](https://github.com/Lamakira/docuflow/issues/35) / [PR #41](https://github.com/Lamakira/docuflow/pull/41), merge `541d68bcb4df570d446272866d9bff3c9f12673a`, adds the shipped `dist/migrate.mjs` entry point and image checks. | The journal, runner, verifier, and shipped/runnable entry point are verified. The image probe checks packaging and refusal without database configuration; no server CD workflow runs the entry point against a synthetic-staging database as a pre-deploy gate. |
| G5 | Delete boot-time DDL and data mutation | **Verified** | [Issue #24](https://github.com/Lamakira/docuflow/issues/24) / [PR #33](https://github.com/Lamakira/docuflow/pull/33), merge `d869dd411568739a9e2a1d52020b193cb24fccf3`; [`server/index.ts`](../../server/index.ts) no longer invokes the legacy DDL, seed, or backfill routines during boot, while [`tests/smoke/boot-ddl-parity.test.ts`](../../tests/smoke/boot-ddl-parity.test.ts), [`tests/smoke/db-scripts.test.ts`](../../tests/smoke/db-scripts.test.ts), and [`tests/smoke/migrations.test.ts`](../../tests/smoke/migrations.test.ts) preserve and verify those behaviors through explicit commands. | Verification uses disposable databases; it does not show the journal or scripts ran in a deployed environment. |
| G6 | Capture legacy web API characterization tests | **Verified** | Harness: [Issue #19](https://github.com/Lamakira/docuflow/issues/19) / [PR #27](https://github.com/Lamakira/docuflow/pull/27), merge `f3d05fed7acf38f01473ec21115050251fd1f2b4`. Web contract: [Issue #20](https://github.com/Lamakira/docuflow/issues/20) / [PR #28](https://github.com/Lamakira/docuflow/pull/28), merge `61c51c674642fbe4cf86f00f0cf31cf1a452cecd`. The HTTP-seam rules and suite inventory are in [`tests/README.md`](../../tests/README.md); executable suites are in [`tests/characterization/`](../../tests/characterization). | These suites freeze the behavior they exercise at the HTTP seam; they do not claim exhaustive coverage of every undocumented behavior. |
| G7 | Capture desktop v1 protocol contract tests | **Verified** | [Issue #21](https://github.com/Lamakira/docuflow/issues/21) / [PR #29](https://github.com/Lamakira/docuflow/pull/29), merge `d603722f1fe7a8de8f34228431e6a439510de969`; the `agent-*` characterization suites in [`tests/characterization/`](../../tests/characterization) and their inventory in [`tests/README.md`](../../tests/README.md). | Tests encode the current implementation where prose protocol documentation has drifted, as recorded in the test inventory. |
| G8 | Establish the OpenTelemetry baseline | **Partial** | [Issue #26](https://github.com/Lamakira/docuflow/issues/26) / [PR #39](https://github.com/Lamakira/docuflow/pull/39), merge `6370cf9eb75b45687c89d105aa6b22e6da762d19`; [`server/telemetry.ts`](../../server/telemetry.ts), [`server/telemetryRedaction.ts`](../../server/telemetryRedaction.ts), [`server/logger.ts`](../../server/logger.ts), [`tests/smoke/telemetry.test.ts`](../../tests/smoke/telemetry.test.ts), and [`docs/OBSERVABILITY.md`](../OBSERVABILITY.md). | Configuration, logger integration, and IDs-only redaction behavior are tested. The suite deliberately does not start the SDK or exercise an exporter, and no isolated-environment collector receipt is recorded, so end-to-end initialization and export remain unproved. |
| G9 | Replace the ephemeral desktop JWT secret with a persistent versioned signing key | **Partial** | [Issue #23](https://github.com/Lamakira/docuflow/issues/23) / [PR #32](https://github.com/Lamakira/docuflow/pull/32), merge `fb400a3aea8927788b9e60eeb35a86f54d992b68`; versioned key parsing and startup refusal in [`server/config.ts`](../../server/config.ts), signing/rotation behavior in [`server/desktopTokens.ts`](../../server/desktopTokens.ts) and [`server/signingKeys.ts`](../../server/signingKeys.ts), and restart/rotation tests in [`tests/smoke/desktop-tokens.test.ts`](../../tests/smoke/desktop-tokens.test.ts). | The ephemeral fallback is removed and restart/rotation behavior is verified in tests. Persistence is a deployment property, and no isolated-environment provisioning or restart attestation is recorded, so the gate lacks its operational proof. |

## Current CI evidence

[`CI` run `31387706740`](https://github.com/Lamakira/docuflow/actions/runs/31387706740) was triggered by a push to `main` at `2026-08-10T12:22:26Z` for head SHA `74c7a211719bb9a00e8474bbce9e3d40a20a94a2`. It completed successfully at `2026-08-10T12:26:09Z`.

The `test` job concluded **success** after selecting the Node version declared by the image, installing dependencies, typechecking, building the application, and running the test harness against a disposable `pgvector/pgvector:pg16` PostgreSQL service. The `image` job also concluded **success** after building the Dockerfile with `push: false`. After construction, distinct runtime probes loaded every declared runtime dependency, exercised PDF extraction, launched a browser and checked its clipboard capability, checked the migration entry point and shipped journal, and booted the default command through the image health check. These probes establish properties of that constructed image; they do not demonstrate an external deployment, server CD, or synthetic staging.

## Issue and PR traceability

| Work | Issue | PR | Merge commit | Primary evidence |
| --- | --- | --- | --- | --- |
| Test harness | [#19](https://github.com/Lamakira/docuflow/issues/19) | [#27](https://github.com/Lamakira/docuflow/pull/27) | `f3d05fed7acf38f01473ec21115050251fd1f2b4` | [`tests/`](../../tests), [`vitest.config.ts`](../../vitest.config.ts) |
| Legacy web characterization | [#20](https://github.com/Lamakira/docuflow/issues/20) | [#28](https://github.com/Lamakira/docuflow/pull/28) | `61c51c674642fbe4cf86f00f0cf31cf1a452cecd` | [`tests/characterization/`](../../tests/characterization) |
| Desktop v1 characterization | [#21](https://github.com/Lamakira/docuflow/issues/21) | [#29](https://github.com/Lamakira/docuflow/pull/29) | `d603722f1fe7a8de8f34228431e6a439510de969` | [`tests/characterization/`](../../tests/characterization) |
| Remove Replit runtime coupling | [#22](https://github.com/Lamakira/docuflow/issues/22) | [#30](https://github.com/Lamakira/docuflow/pull/30) | `815000277248c52e71d776e57bbf7854dad6de1c` | [`server/config.ts`](../../server/config.ts), [`docs/CONFIGURATION.md`](../CONFIGURATION.md) |
| Version desktop signing keys | [#23](https://github.com/Lamakira/docuflow/issues/23) | [#32](https://github.com/Lamakira/docuflow/pull/32) | `fb400a3aea8927788b9e60eeb35a86f54d992b68` | [`server/desktopTokens.ts`](../../server/desktopTokens.ts), [`server/signingKeys.ts`](../../server/signingKeys.ts) |
| Consolidate migrations and remove boot mutations | [#24](https://github.com/Lamakira/docuflow/issues/24) | [#33](https://github.com/Lamakira/docuflow/pull/33) | `d869dd411568739a9e2a1d52020b193cb24fccf3` | [`migrations/`](../../migrations), [`scripts/migrate.ts`](../../scripts/migrate.ts) |
| Container and CI | [#25](https://github.com/Lamakira/docuflow/issues/25) | [#34](https://github.com/Lamakira/docuflow/pull/34) | `f7fdff054b3254708095664a83af6e7e637d04fa` | [`Dockerfile`](../../Dockerfile), [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |
| OpenTelemetry baseline | [#26](https://github.com/Lamakira/docuflow/issues/26) | [#39](https://github.com/Lamakira/docuflow/pull/39) | `6370cf9eb75b45687c89d105aa6b22e6da762d19` | [`server/telemetry.ts`](../../server/telemetry.ts), [`docs/OBSERVABILITY.md`](../OBSERVABILITY.md) |

## Follow-up hardening included in the evaluated revision

These merged changes strengthen the stabilized baseline but do not satisfy the missing server CD/synthetic-staging gate:

| Work | Issue / PR | Merge commit | Evidence |
| --- | --- | --- | --- |
| Desktop project-visibility parity | [#31](https://github.com/Lamakira/docuflow/issues/31) / [#40](https://github.com/Lamakira/docuflow/pull/40) | `52cca9e389ced854064c41a541fbb4f20c295092` | [`docs/adr/0019-gate-agent-project-access-on-existence-until-workspace-scoping-lands.md`](../adr/0019-gate-agent-project-access-on-existence-until-workspace-scoping-lands.md), agent characterization suites |
| Migration image entry point | [#35](https://github.com/Lamakira/docuflow/issues/35) / [#41](https://github.com/Lamakira/docuflow/pull/41) | `541d68bcb4df570d446272866d9bff3c9f12673a` | [`tests/smoke/migrate-bundle.test.ts`](../../tests/smoke/migrate-bundle.test.ts), [`Dockerfile`](../../Dockerfile) |
| Runtime dependency split | [#36](https://github.com/Lamakira/docuflow/issues/36) / [#42](https://github.com/Lamakira/docuflow/pull/42) | `96696a963e000de52af6e80d238af5daebad29df` | [`tests/smoke/server-bundle.test.ts`](../../tests/smoke/server-bundle.test.ts), [`docs/CONTAINER.md`](../CONTAINER.md) |
| Browser executable and image capability | [#37](https://github.com/Lamakira/docuflow/issues/37) / [#44](https://github.com/Lamakira/docuflow/pull/44) | `b6eb17d9ecc60fe41d9a8eede254ecf188f8ba6b` | [`tests/smoke/transcript-browser.test.ts`](../../tests/smoke/transcript-browser.test.ts), CI image probes |
| Transcript validation | [#45](https://github.com/Lamakira/docuflow/issues/45) / [#46](https://github.com/Lamakira/docuflow/pull/46) | `88dd3d8d65153878b0c5852b6a82c51f13ad7d9b` | [`server/browser-transcript.ts`](../../server/browser-transcript.ts), transcript-browser tests |
| Node toolchain alignment | [#38](https://github.com/Lamakira/docuflow/issues/38) / [#48](https://github.com/Lamakira/docuflow/pull/48) | `85c2304f21ac5e347b3f1785687c15f05c1bb124` | [`Dockerfile`](../../Dockerfile), [`package.json`](../../package.json), CI Node selection |
| PDF extraction/runtime hardening | [#43](https://github.com/Lamakira/docuflow/issues/43) / [#49](https://github.com/Lamakira/docuflow/pull/49) | `78b9c8a1d2d3efcba63eb97a28f72945f70fed49` | [`server/contentExtraction.ts`](../../server/contentExtraction.ts), content-extraction tests, CI image parser probe |
| Structured Loom transcription responses | [#47](https://github.com/Lamakira/docuflow/issues/47) / [#50](https://github.com/Lamakira/docuflow/pull/50) | `74c7a211719bb9a00e8474bbce9e3d40a20a94a2` | [`server/browser-transcript.ts`](../../server/browser-transcript.ts), sanitized fixture and transcript-browser tests |

## Limitations and remaining exit actions

At the evaluated revision, the workflow inventory contains only `ci.yml` and `desktop-release.yml`. The server CI workflow builds without pushing and the repository contains no server deployment target or synthetic-staging workflow. The separate desktop release workflow is production-oriented, conflicts with ADR-0018's isolation mandate, and does not close the server gate. Therefore Phase 1 remains **Open**, even though the implementation tickets above are closed and the pinned main CI run is green.

To close Phase 1:

1. Implement server CD to synthetic staging in ADR-0018's isolated parallel environment, using only fresh accounts, secrets, and non-production data.
2. Provision the versioned desktop signing key in that environment and capture a restart/rotation attestation without recording the secret.
3. Run the migration entry point as a gated pre-deploy step, deploy the evaluated image, exercise telemetry initialization/export, execute a synthetic verifier, and record revision, image identity, migration/verifier output, and deployment timestamp in this trail.

The production-oriented desktop release workflow remains a separate ADR-0018 architecture conflict requiring disposition. This record does not elevate it into an additional Phase 1 gate.

If server CD or synthetic staging is intentionally deferred, an explicit architecture amendment must reassign the gate before Phase 1 can close.

## Reproducing repository evidence locally

Prerequisites are the repository's declared Node/npm toolchain, Docker Engine with Docker Compose, enough resources to build the image, and local TCP port `5433` available. The test service must be `pgvector/pgvector:pg16`, not plain PostgreSQL, because the migration journal creates the `vector` extension and `vector(1536)` columns. The compose file supplies the disposable database name and credentials; the harness defaults to its local URL and refuses a non-local database unless explicitly overridden.

From a checkout of the evaluated revision, this sequence starts the disposable database, guarantees teardown on success or failure, and reproduces the host-side CI checks:

```bash
npm ci
unset TEST_DATABASE_URL ALLOW_REMOTE_TEST_DB
trap 'npm run test:db:down' EXIT
npm run test:db:up
npm run check
npm run build
npm test
```

Image construction is a separate check:

```bash
docker build -t docuflow:phase-1-evidence .
```

A successful local `docker build` proves construction only. The CI `image` job additionally runs the runtime dependency, PDF extraction, browser/clipboard, migration entry-point, journal-presence, and default-command health probes listed above. Reproducing those probes requires executing their commands from [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml); they are not implied by the build command.

Migration status, dry-run, live-schema verification, baseline, seed, and backfill procedures are documented in [`migrations/README.md`](../../migrations/README.md). None of these repository or image checks reproduces the absent synthetic-staging deployment or supplies operational proof.
