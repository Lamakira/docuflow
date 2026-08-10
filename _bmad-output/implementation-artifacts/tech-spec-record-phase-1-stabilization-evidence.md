---
title: 'Record Phase 1 stabilization evidence'
type: 'chore'
created: '2026-08-10'
status: 'done'
baseline_commit: '74c7a211719bb9a00e8474bbce9e3d40a20a94a2'
context:
  - 'CONTEXT.md'
  - 'docs/adr/0017-migrate-in-place-through-nine-gated-phases.md'
  - 'docs/adr/0018-build-in-a-parallel-environment-with-snapshot-rehearsed-cutover.md'
---

# Record Phase 1 stabilization evidence

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Phase 1 implementation tickets are closed, but ADR-0017 requires per-phase evidence and the repository has no `docs/migration/` trail. Without a consolidated record, completed stabilization work, its proof, and its remaining exit gates are easy to conflate.

**Approach:** Add one evidence document evaluated at the current merged `main` commit. It will map each Phase 1 gate to durable repository artifacts and the successful main CI run, explicitly distinguish implemented code from deployed-environment proof, and keep the phase open where CD/synthetic staging is absent.

## Boundaries & Constraints

**Always:** Treat ADR-0018 as the execution-environment amendment to ADR-0017; cite exact issues, PRs, commits, CI run, and repository paths; record both positive evidence and known gaps; use the glossary vocabulary; state a clear phase verdict; keep the record reproducible from public repository evidence.

**Ask First:** Closing umbrella issues, changing an ADR, declaring the phase complete despite an unmet gate, creating a deployment target, or moving CD/synthetic staging into Phase 2.

**Never:** Include production URLs, credentials, customer content, raw production/rehearsal data, invented verifier results, claims about deployed secrets or telemetry sinks, or treat issue closure alone as proof.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Verified gate | Code/tests and a green main CI run exist | Mark verified and cite durable evidence | Note limits of what source/CI proves |
| Partial gate | Implementation exists but deployment proof does not | Mark partial, not complete | Name the exact missing artifact/action |
| Missing gate | No implementation or verifier exists | Mark open | Do not infer completion from related tickets |
| Superseded execution detail | ADR-0017 conflicts with ADR-0018 | Apply ADR-0018 while retaining phase content | Explain the amendment locally |

</frozen-after-approval>

## Code Map

- `docs/migration/phase-1-stabilization.md` -- new phase-gate evidence record and authoritative completion verdict.
- `docs/adr/0017-migrate-in-place-through-nine-gated-phases.md` -- Phase 1 gates and evidence-trail requirement.
- `docs/adr/0018-build-in-a-parallel-environment-with-snapshot-rehearsed-cutover.md` -- isolated-environment amendment.
- `.github/workflows/ci.yml` -- executable CI and image verification evidence.
- `.github/workflows/desktop-release.yml` -- existing production-oriented release path that must be recorded as an ADR-0018 conflict, not mistaken for server synthetic-staging CD.
- `tests/README.md` -- characterization and contract-suite inventory.
- `migrations/README.md` -- migration journal, runner, verifier, and operational contract.

## Tasks & Acceptance

**Execution:**
- [x] `docs/migration/phase-1-stabilization.md` -- create a dated record for merged main SHA `74c7a211719bb9a00e8474bbce9e3d40a20a94a2`; include all nine gates with stable numbering and strict statuses, full issue/PR/merge identities, current CI evidence and job scope, follow-up hardening, limitations, complete local prerequisites, and remaining exit actions. Qualify absence claims as server CD/synthetic staging specifically; record the production-oriented desktop release workflow as an unresolved ADR-0018 conflict without reproducing its production URL.

**Acceptance Criteria:**
- Given the Phase 1 ADR gates, when the evidence record is read, then every gate has an explicit Verified, Partial, or Open status with supporting paths and tracker references.
- Given main CI run `31387706740`, when CI evidence is cited, then its commit, successful test/image result, timestamp, and link are recorded without claiming external deployment.
- Given no server deployment target or synthetic staging workflow exists, when the verdict is stated, then Phase 1 remains open pending implementation or an explicit architecture amendment.
- Given ADR-0018, when environment evidence is described, then the document prohibits production connections and frames future execution in the isolated parallel environment.

## Spec Change Log

- 2026-08-10: Implemented the Phase 1 evidence record; verification and review remain pending.
- 2026-08-10, review iteration 1: Review found that the first draft overclaimed broad stabilization, defined `Verified` too weakly, omitted the existing production-oriented desktop release workflow, supplied incomplete reproduction commands, and embedded a prohibited recording identifier in a nominal absence check. The implementation task and verification section now require stable gate numbering, full commit identities, server-specific CD language, explicit ADR-0018 conflict disclosure, database prerequisites, image-check scope qualification, correct negative assertions, and untracked-file whitespace checks. This avoids a falsely clean Phase 1 verdict and prevents sensitive identifiers entering the evidence trail. **KEEP:** exact main SHA and CI timestamps; strict Verified/Partial/Open vocabulary; nine-gate table; issue/PR traceability; clear Open verdict; repository-versus-operational-proof distinction; follow-up hardening inventory; no production data or secrets.
- 2026-08-10, review iteration 2: Adversarial, edge-case, and acceptance review narrowed the proof claims. `Verified` now requires a successful applicable verifier in the pinned CI run; telemetry and signing-key persistence are Partial; migration-entry-point and boot-mutation language matches the actual checks; individual CI job conclusions are explicit; the local recipe clears remote-database overrides; absolute links are host-allowlisted; and the desktop release conflict is documented without inventing a separate Phase 1 gate.
- 2026-08-10: Verification and review completed; the evidence record is ready for repository review.

## Design Notes

The evidence document is a phase gate, not a retrospective and not a second architecture specification. Its status vocabulary is deliberately strict: **Verified** means repository/CI evidence exists at the evaluated commit; **Partial** means implementation exists but operational proof is absent; **Open** means the gate itself is not implemented or has not been reassigned by decision.

## Verification

**Commands:**
- `rg -n '^\| G[1-9] ' docs/migration/phase-1-stabilization.md` -- exactly nine stable gate rows are present and individually reviewable.
- `rg -F '74c7a211719bb9a00e8474bbce9e3d40a20a94a2' docs/migration/phase-1-stabilization.md && rg -F '31387706740' docs/migration/phase-1-stabilization.md` -- both evaluated commit and CI run are pinned.
- `! rg -n 'https?://[^ )]*(app|api)\.docuflow\.com|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|Authorization:[[:space:]]*(Bearer|Basic)|[?&](Policy|Signature|Key-Pair-Id)=' docs/migration/phase-1-stabilization.md` -- no production endpoint literal, private key, authorization value, or signed-provider query is present.
- `! rg -n -P 'https?://(?!github\.com/)' docs/migration/phase-1-stabilization.md` -- every absolute link in the public evidence record uses the approved public GitHub host; repository paths remain relative.
- `! rg -n '[[:blank:]]+$' docs/migration/phase-1-stabilization.md _bmad-output/implementation-artifacts/tech-spec-record-phase-1-stabilization-evidence.md` -- new untracked documentation has no trailing whitespace before staging.
- `git diff --check` -- staged/tracked documentation has no whitespace errors at closeout.
- `git ls-tree --name-only 74c7a211719bb9a00e8474bbce9e3d40a20a94a2 .github/workflows/` -- inventory the complete workflow set at the evaluated revision before asserting that server CD or synthetic staging is absent.

**Manual checks:**
- Resolve every relative Markdown link from `docs/migration/phase-1-stabilization.md`; verify every full merge SHA is an ancestor of the evaluated main SHA.
- Confirm reproduction instructions start and stop the disposable PostgreSQL service and distinguish image construction from the additional runtime probes owned by CI.

**Recorded results (2026-08-10):** nine distinct G1-G9 rows found; evaluated SHA and CI run found; sensitive-pattern and non-GitHub absolute-link scans returned no matches; both new files returned no trailing-whitespace matches; `git diff --check` passed; all 60 relative Markdown links resolved; every cited full merge SHA was verified as an ancestor of the evaluated revision; the evaluated workflow inventory contained only `ci.yml` and `desktop-release.yml`, with server image push disabled; CI run `31387706740` and its `test` and `image` job conclusions were confirmed through the GitHub Actions API.
