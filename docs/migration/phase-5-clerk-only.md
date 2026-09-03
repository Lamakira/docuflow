# Phase 5: Clerk is the only web session

- **Recorded:** 2026-09-03
- **Ticket:** [#111](https://github.com/Lamakira/docuflow/issues/111) (ADR-0007, ADR-0017)
- **Verdict:** rehearsal only. **No production cutover of this removal has been run yet** — the counts below are blank on purpose and are filled by the operator from the real run.

The drain ([#109](https://github.com/Lamakira/docuflow/issues/109)) and the
cutover ([#110](https://github.com/Lamakira/docuflow/issues/110)) left a flag, a
Replit OIDC login, and an `X-API-Key` Owner impersonation beside Clerk. This
ticket takes those leftovers away. A User signs in at Clerk, the browser
presents that session, and DocuFlow resolves it to the linked `users.id`.
`WorkspaceContext` is still built from that User's Membership, so
authentication moved and authorization did not.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `Authorization: Bearer <provider session>` | Entered the Workspace while `DOCUFLOW_IDENTITY_DUAL_AUTH` was on | Enters the Workspace — unconditional |
| Replit OIDC (`GET /api/login`, `/api/callback`, `/api/logout`) | Entered the Workspace | `410 Gone`, no session |
| `POST /api/auth/login`, `POST /api/auth/register` | `410 Gone` stubs from #110 | Unmounted (`404`) |
| `X-API-Key` (`MCP_API_KEY`) | Impersonated the Owner | Ignored; `401` on guarded routes |
| `DOCUFLOW_IDENTITY_DUAL_AUTH` | Gated whether a Clerk session was read | Gone. `server/config.ts` does not read it |
| `REPL_ID`, `ISSUER_URL` | OIDC client and issuer | Gone from `server/config.ts` |
| `POST /api/agent/auth/login` | Device access token | Unchanged — Devices keep their own path |

`GET /api/login` stays mounted and answers `410` so a leftover bookmark, or the
previous SPA's "Continue with Replit" button, is told what happened rather than
falling through to the SPA shell. `server/config.ts` does not read `REPL_ID` or
`ISSUER_URL` for that answer, or for anything else.

## Rollback

Redeploy the previous image ([#110](https://github.com/Lamakira/docuflow/issues/110)).
There is no flag left to flip: on this image a Clerk session is the web path,
and turning a removed variable off does nothing. Nothing is written when the
image moves in either direction, so there is still no down migration and no
session to invalidate. Device Enrollment rows are untouched.

## Window

Filled from the real cutover. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Image deployed (UTC) | |
| Users linked at cutover | |
| Sign-ins observed in the first 24h | |
| Rollbacks | |

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/smoke/identity-clerk-only.test.ts`, plus the suites named below):

- A linked User presenting a provider session reached `/api/auth/user` and a
  Workspace-scoped read with `DOCUFLOW_IDENTITY_DUAL_AUTH` unset, and again with
  it spelled `off`.
- `GET /api/auth/config` reported `enabled: true` without the flag.
- `GET /api/login`, `/api/callback`, and `/api/logout` were `410` with `REPL_ID`
  set, and the callback minted no session.
- A matching `X-API-Key` / `MCP_API_KEY` was `401` on `/api/admin/users`.
- `POST /api/agent/auth/login` still minted a Device access token, and
  `GET /api/agent/devices` listed that Device — Device Enrollment is intact.
- Agent pairing, refresh, and timer characterization stayed green.
- Boot no longer prints `dual-auth`, and `server/config.ts` no longer exports
  `identityDualAuthEnabled` or `mcpApiKey`.

## Exit

Clerk is the only web authentication path. Enrolled Devices stay on the token
path this phase does not touch.
