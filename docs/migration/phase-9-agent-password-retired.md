# Phase 9: retire desktop email/password login

- **Recorded:** 2026-09-04
- **Ticket:** [#159](https://github.com/Lamakira/docuflow/issues/159) (Spec [#157](https://github.com/Lamakira/docuflow/issues/157), ADR-0007, ADR-0017, ADR-0018)
- **Verdict:** rehearsal only. **No production cutover has been run yet** — the counts below are blank on purpose and are filled by the operator from the real run.

[#158](https://github.com/Lamakira/docuflow/issues/158) restored pairing from a signed-in web session.
This ticket cuts the desktop agent off `users.password`. Pairing is the only way
to enroll a Device. Already enrolled Devices keep refreshing, heartbeating, and
submitting Timer Commands. Publishing an installer is out of scope.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `POST /api/agent/auth/login` | Mints a Device from email/`users.password` | `410 Gone`, message names pairing, body unread |
| `GET /api/agent/ping` | `agentAuth: email-password-v1` | `agentAuth: pairing-v1` |
| `GET /api/ping` | `agentAuth: email-password-v1` | `agentAuth: pairing-v1` |
| Desktop agent in this repository | Posts email/password to login | Completes pairing; does not call login |
| Devices page | Told the User to sign in with email/password | Mints a pairing code from the web session |
| `loginDevice` helper | `POST /api/agent/auth/login` | pairing start + complete |
| Enrolled Device refresh / heartbeat / timer | Device token path | Unchanged |

`users.password` is still on the row. Admin create/reset still write it. Those
writes stop on [#160](https://github.com/Lamakira/docuflow/issues/160); the
column drops on [#161](https://github.com/Lamakira/docuflow/issues/161).

## Rollback

Redeploy the previous image. Login mints Devices again and ping advertises
`email-password-v1`. Pairing stays up. Device Enrollment rows already written
stay; those Devices keep refreshing.

## Window

Filled from the real cutover. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Image deployed (UTC) | |
| 410 login observations in the first 24h | |
| Rollbacks | |

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/characterization/agent-auth.test.ts`, `tests/smoke/agent-auth.test.ts`,
`tests/characterization/agent-timer.test.ts`):

| Gate | Status | Evidence |
| --- | --- | --- |
| `POST /api/agent/auth/login` is 410 and names pairing, whatever is posted; no Device enrolled | **Verified** | characterization + smoke |
| `GET /api/agent/ping` no longer returns `agentAuth: "email-password-v1"` | **Verified** | characterization + smoke (`pairing-v1`) |
| An already enrolled Device still refreshes, heartbeats, and submits Timer Commands | **Verified** | characterization refresh; agent timer characterization stayed green |
| Helpers that enrolled via password login switch to pairing | **Verified** | `tests/helpers/agent.ts` `loginDevice` |
| Production login cutover | **Open** | counts below are blank on purpose (ADR-0018) |

## Exit

Pairing is the only enrollment path. Leftover agents that still post
email/password to login are told to pair. Enrolled Devices do not re-pair.
