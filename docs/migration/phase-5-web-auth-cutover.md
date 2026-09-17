# Phase 5 web auth cutover to Clerk

- **Recorded:** 2026-09-03
- **Ticket:** [#110](https://github.com/Lamakira/docuflow/issues/110) (ADR-0007, ADR-0017)
- **Flag:** `DOCUFLOW_IDENTITY_DUAL_AUTH` — owner @Lamakira, removal gate [#111](https://github.com/Lamakira/docuflow/issues/111)
- **Verdict:** rehearsal only. **No production cutover has been run yet** — the counts below are blank on purpose and are filled by the operator from the real run.

The drain ([#109](https://github.com/Lamakira/docuflow/issues/109)) gave a User
two ways into the same Workspace. This ticket takes the first one away. DocuFlow
no longer verifies a password or mints a session of its own for the browser: the
User signs in at Clerk, the browser presents that session, and DocuFlow resolves
it to the linked `users.id`. `WorkspaceContext` is still built from that User's
Membership, so authentication moved and authorization did not.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `POST /api/auth/login` (email/password) | 200, legacy session | `410 Gone` |
| `POST /api/auth/register` (email/password) | 201, legacy session, new User | `410 Gone`, no User created |
| `GET /api/auth/config` | — | Clerk publishable key and whether sign-in is available |
| `Authorization: Bearer <provider session>` | Enters the Workspace (drain) | Enters the Workspace — the only web way in |
| Replit OIDC (`/api/login`, `/api/callback`) | Enters the Workspace | Unchanged; removed by #111 |
| `X-API-Key` (`MCP_API_KEY`) | Impersonates the Owner | Unchanged; removed by #111 |
| `POST /api/agent/auth/login` (email/password) | Device access token | Unchanged — Devices keep their own path |

Both retired routes stay mounted and answer `410` to every payload, valid or
malformed. A browser still running the previous SPA build is told what happened
rather than getting a 404, and an endpoint that authenticates nobody does not
need to tell a known address from an unknown one. #111 deletes them.

### Two password surfaces deliberately survive

`users.password` is still read by the desktop agent's `POST /api/agent/auth/login`,
which ADR-0017's Phase 5 leaves alone, and still written by the admin-only
`POST /api/admin/users/:id/reset-password`. Neither is a web session. An admin
reset therefore no longer changes how that User signs in on the web — Clerk owns
that credential.

### `users.last_login_at`

The retired login route was its only writer. Clerk owns the sign-in, so there is
no login moment left on this side to hook; the first request of a provider
session now stamps it instead, conditional in SQL on an hour having passed. The
admin list keeps working, at an hour's resolution, and most requests touch no row.

## Where new Users come from

> **Reversed 2026-09-17 by [#230](https://github.com/Lamakira/docuflow/issues/230).**
> Self-service registration is **open** again. (Sign-up on the Clerk instance
> reads `public`; the disable this section asks for was never applied.) The
> reason recorded below — that an account created at Clerk's sign-up would be a
> dead end — stopped being true when
> [#217](https://github.com/Lamakira/docuflow/issues/217) gave a User with no
> Membership a first Workspace to name. The section is left as written, because
> it is what this phase did; see
> [`phase-8-self-service-registration.md`](phase-8-self-service-registration.md)
> for what replaced it.

Self-service registration is closed and the Workspace Invitation flow is not this
phase ([#105](https://github.com/Lamakira/docuflow/issues/105)). Until it lands,
an Administrator creates the account and the import links it:

```bash
# 1. Administrator creates the User (seat-gated, welcome email with a password)
#    POST /api/admin/users
# 2. Link it to Clerk by the hash that route just wrote
npm run identity:import:users
```

A Clerk account with no linked DocuFlow User reaches nothing: the link is read
from DocuFlow's own table, so a subject the provider will vouch for but nobody
imported is not a User here.

The sign-in page hides Clerk's sign-up link for the same reason — an account
created there would be a dead end. **Disable sign-up on the Clerk instance
itself** ([#107](https://github.com/Lamakira/docuflow/issues/107)) so the hosted
pages agree with the embedded one.

*(Both instructions above were withdrawn on 2026-09-17 by #230. The link is
shown and `/sign-up` serves Clerk's sign-up surface. The instance disable was
never carried out — it reads `sign_up.mode: "public"` — so the two surfaces had
in fact been disagreeing since the cutover, and now agree the other way.)*

## Rollback

Two steps, and both are needed:

1. `DOCUFLOW_IDENTITY_DUAL_AUTH` off — provider sessions stop being read.
2. Redeploy the previous image — `POST /api/auth/login` and `/api/auth/register`
   mint legacy sessions again.

The flag flip alone is not a rollback any more; on this image it locks every User
out of the web. Nothing is written when the flag moves in either direction, so
there is still no down migration and no session to invalidate. `users.password`
is untouched by this ticket, which is what makes step 2 restore a working login
rather than an empty one.

## Window

Filled from the real cutover. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Image deployed (UTC) | |
| Users linked at cutover | |
| Users still unlinked at cutover | |
| Sign-ins observed in the first 24h | |
| Rollbacks | |

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/smoke/web-auth-cutover.test.ts`, plus the suites named below):

- A login posting the User's own real password was `410` and left the cookie jar
  signed out — `/api/auth/user` still `null`, `/api/projects` still `401`.
- A registration post was `410` and created no `users` row.
- A malformed payload got the same `410` the valid one did, on both routes.
- A User linked by the #108 import and presenting a provider session was answered
  by `/api/auth/user` with their own row and passed a Workspace-scoped read.
- That first request stamped `last_login_at`.
- With the flag off, the same session was `401` — and so was everything else,
  which is the point of the second rollback step.
- `GET /api/auth/config` served the publishable key and never the secret, and
  reported `enabled: false` with the flag off.
- Agent pairing, refresh, and timer characterization stayed green, as did
  `POST /api/agent/auth/login` with the password an admin reset had just written.
- The whole harness now signs in through the provider — every suite that used to
  post to `/api/auth/register` reaches the app through a Clerk session, so the
  cutover is exercised by the full run rather than by one file.

## Exit

`dualAuthSession`, the flag, Replit OIDC, and `MCP_API_KEY` were removed together
in [#111](https://github.com/Lamakira/docuflow/issues/111) — see
[`phase-5-clerk-only.md`](phase-5-clerk-only.md).

The registration closure this phase recorded was lifted separately in
[#230](https://github.com/Lamakira/docuflow/issues/230) — see
[`phase-8-self-service-registration.md`](phase-8-self-service-registration.md).
