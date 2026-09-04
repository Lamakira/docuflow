# Phase 9: pair Devices from a signed-in web session

- **Recorded:** 2026-09-04
- **Ticket:** [#158](https://github.com/Lamakira/docuflow/issues/158) (Spec [#157](https://github.com/Lamakira/docuflow/issues/157), ADR-0007, ADR-0017, ADR-0018)
- **Verdict:** rehearsal only. **No production cutover has been run yet** — the counts below are blank on purpose and are filled by the operator from the real run.

Phase 5 left Devices on email/password login and answered `410` on the pairing
endpoints `docs/agent-protocol.md` still describes. This ticket restores that
flow: a signed-in User mints a code from the web session, the agent consumes it,
and the Device is enrolled the same way `POST /api/agent/auth/login` already
does. Password login stays up until [#159](https://github.com/Lamakira/docuflow/issues/159).
Enrolled Devices are untouched.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `POST /api/agent/pairing/start` | `410 Gone` | Clerk-mapped web session mints a row in `agent_pairing_codes` (10-minute TTL) |
| `POST /api/agent/pairing/complete` | `410 Gone` | Consumes the code; creates a Device and Device Enrollment; returns the login token shape |
| Unauthenticated start | `410` | `401 Unauthorized` |
| Used, expired, or unknown complete | `410` | `400`, no Device enrolled |
| `POST /api/agent/auth/login` | Mints a Device | Unchanged — still mints a Device |
| `GET /api/agent/ping` | `agentAuth: email-password-v1` | Unchanged |
| `WEB_SESSION_AGENT_PATHS` | devices / revoke / revoke-machine | Those plus `/api/agent/pairing/start` |

The pairing code is not logged (ADR-0016). The table already existed; nothing
was migrated.

## Rollback

Redeploy the previous image. Pairing start and complete become `410` again.
Device Enrollment rows already written stay; those Devices keep refreshing.

## Window

Filled from the real cutover. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Image deployed (UTC) | |
| Pairing completes observed in the first 24h | |
| Rollbacks | |

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/characterization/agent-auth.test.ts`, `tests/smoke/agent-auth.test.ts`):

| Gate | Status | Evidence |
| --- | --- | --- |
| Signed-in User starts a pairing code; unauthenticated start is 401 | **Verified** | characterization + smoke |
| Completing a used, expired, or unknown code enrolls nothing | **Verified** | characterization + smoke |
| Completing a valid code mints a hashed Device token, a Device Enrollment, and a one-hour access token | **Verified** | characterization |
| `POST /api/agent/auth/login` still mints a Device; ping still advertises `email-password-v1` | **Verified** | characterization + smoke; agent timer characterization stayed green |
| Production pairing cutover | **Open** | counts below are blank on purpose (ADR-0018) |

## Exit

Devices can pair from a Clerk-mapped web session. Email/password agent login is
still the expand surface; [#159](https://github.com/Lamakira/docuflow/issues/159)
retires it.
