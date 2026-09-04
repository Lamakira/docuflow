# Phase 9: drop `users.password` and `users.last_generated_password`

- **Recorded:** 2026-09-04
- **Ticket:** [#161](https://github.com/Lamakira/docuflow/issues/161) (Spec [#157](https://github.com/Lamakira/docuflow/issues/157), ADR-0007, ADR-0017, ADR-0018)
- **Verdict:** rehearsal only. **No production cutover has been run yet** — the counts below are blank on purpose and are filled by the operator from the real run.

[#159](https://github.com/Lamakira/docuflow/issues/159) cut the desktop agent off
`users.password`. [#160](https://github.com/Lamakira/docuflow/issues/160) stopped
admin create and reset from writing a hash. This ticket drops the leftover
columns. Credentials live at the IdentityProvider. No down migration: rollback
is the previous image.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `users.password` | Nullable leftover hashes | Dropped (`0027_confused_captain_stacy`) |
| `users.last_generated_password` | Column still present, omitted from HTTP | Dropped |
| `hashPassword` / `verifyPassword` | Exported from `server/auth.ts` | Gone. bcrypt is not a runtime dependency |
| `SafeUser` / `toSafeUser` | Omitted password, last generated password, and subject id | Omits only the IdentityProvider subject id |
| Test helpers | Wrote a bcrypt hash onto the User | Create Users with no password field |
| `POST /api/agent/auth/login` | `410 Gone` | Unchanged. Inserting a hash cannot revive it: the column is gone |
| IdentityProvider import/invite | Import classified by hash on the row | Unlinked Users are listed for a password-set invite. `importPasswordUser` remains on the port for Clerk |

## Rollback

Redeploy the previous image. The columns are not recreated (no down migration).
Rows already written without a password stay. Pairing, Clerk web sessions, and
Device refresh are unchanged.

## Window

Filled from the real cutover. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Image deployed (UTC) | |
| Rollbacks | |

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/smoke/identity-password-column-dropped.test.ts`,
`tests/smoke/identity-invites.test.ts`, `tests/characterization/agent-auth.test.ts`,
`tests/smoke/web-auth-cutover.test.ts`):

| Gate | Status | Evidence |
| --- | --- | --- |
| A database migrated through the journal has neither column | **Verified** | `information_schema` in smoke; migration `0027_confused_captain_stacy` |
| `shared/schema.ts` and `toSafeUser` compile without the columns | **Verified** | schema + `tsc` |
| No server path verifies or writes a User password | **Verified** | `hashPassword` / `verifyPassword` / `updateUserPassword` removed; create-admin inserts no digest |
| Agent login cannot be revived by inserting a hash | **Verified** | `POST /api/agent/auth/login` stays 410; pairing still enrolls |
| Tests and helpers create Users without a password field | **Verified** | `tests/helpers/auth.ts` |
| IdentityProvider import/invite fakes still work | **Verified** | identity-provider + identity-invites smoke |
| Device pairing and Clerk web sessions stay green | **Verified** | password-column-dropped smoke; agent-auth + web-auth-cutover |
| Production column drop | **Open** | counts below are blank on purpose (ADR-0018) |

## Exit

Credentials are not on the User row. Clerk owns the password. Pairing is how a
Device enrolls. Rollback is the previous image.
