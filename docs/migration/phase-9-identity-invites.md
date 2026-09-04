# Phase 9: create and reset Users through the IdentityProvider

- **Recorded:** 2026-09-04
- **Ticket:** [#160](https://github.com/Lamakira/docuflow/issues/160) (Spec [#157](https://github.com/Lamakira/docuflow/issues/157), ADR-0007, ADR-0017, ADR-0018)
- **Verdict:** rehearsal only. **No production cutover has been run yet** — the counts below are blank on purpose and are filled by the operator from the real run.

Admin create and password reset stop writing a bcrypt hash and stop showing
`lastGeneratedPassword`. They create or locate the DocuFlow User and send an
IdentityProvider password-set invite (the port from [#109](https://github.com/Lamakira/docuflow/issues/109)).
That invite is not a Workspace Invitation and grants no Membership. A created
User still needs an active Membership to enter the Workspace.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `POST /api/admin/users` | Wrote a bcrypt hash, returned `generatedPassword`, mailed credentials | Inserts `users.password` NULL, sends `IdentityProvider.sendPasswordSetInvite`, returns `inviteSent` |
| `POST /api/admin/users/:id/reset-password` | Called `hashPassword`, returned `newPassword`, mailed the new one | Sends `IdentityProvider.sendPasswordSetInvite`, leaves any existing hash, returns `inviteSent` |
| `GET /api/admin/users/:id` | Served `lastGeneratedPassword` in the clear | Omits `lastGeneratedPassword` (column still exists) |
| `users.password` | `NOT NULL` | Nullable in the journal. Existing hashes may remain until [#161](https://github.com/Lamakira/docuflow/issues/161) |
| `POST /api/auth/login` | Unmounted `404` | Unchanged |
| Membership | Seeded Membership on create | Unchanged. Invite grants none |

## Rollback

Redeploy the previous image. Create and reset write hashes again. Rows already
inserted with a NULL password stay; the previous image can still read them.
The column does not become `NOT NULL` again (no down migration).

## Window

Filled from the real cutover. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Image deployed (UTC) | |
| Admin creates observed in the first 24h | |
| Password-set invites observed | |
| Rollbacks | |

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/smoke/identity-invites.test.ts`, `tests/characterization/users-admin.test.ts`):

| Gate | Status | Evidence |
| --- | --- | --- |
| Creating a User does not persist a usable password hash and does not return or display `lastGeneratedPassword` | **Verified** | characterization + smoke |
| Reset sends `IdentityProvider.sendPasswordSetInvite` and does not call `hashPassword` | **Verified** | smoke against the Clerk fake; existing hash unchanged |
| `users.password` is nullable in the journal | **Verified** | `information_schema` in smoke; migration `0026_young_morg` |
| Membership and authorization are unchanged; a created User still needs an active Membership to enter the Workspace | **Verified** | smoke: create still writes one Membership; archived Membership is 401 after the invite is accepted |
| Web `/api/auth/login` stays unmounted | **Verified** | smoke `404` |
| Production invite cutover | **Open** | counts below are blank on purpose (ADR-0018) |

## Exit

New Users are invited at the IdentityProvider. DocuFlow no longer writes a
usable password hash on create or reset. The column remains until
[#161](https://github.com/Lamakira/docuflow/issues/161).
