# Phase 5 User import classification

- **Recorded:** 2026-09-03
- **Ticket:** [#108](https://github.com/Lamakira/docuflow/issues/108) (ADR-0007, ADR-0017)
- **Source:** local parallel-environment Postgres (`localhost:5433`, scratch database `docuflow_phase5`, built from the migration journal and `npm run db:seed`). Production connections are refused (ADR-0018).
- **Verdict:** rehearsal only. **No production classification has been taken yet** — the table below is blank on purpose and is filled by the operator from a real `--dry-run` before the import runs.

Users are imported into Clerk by the bcrypt hash already on `users.password`, so
imported accounts keep the password they have and nobody is reset. The Clerk
subject id lands on `users.identity_provider_subject_id` (migration `0025`).
`users.password` stays; Membership, Workspace Context, and Device Enrollment are
untouched.

## Classification

Decided by `classifyUserForImport` in
[`server/modules/identity/userImport.ts`](../../server/modules/identity/userImport.ts),
without reaching the provider:

| Action | Rule | What happens |
| --- | --- | --- |
| `already-linked` | `identity_provider_subject_id` is set | Skipped before the port. This is what makes a second run create no second Clerk User. |
| `password-set-invite` | `password` is not a bcrypt hash — Replit OIDC accounts carry the `REPLIT_OIDC_USER` placeholder | **Not** imported as a password User. No password is invented. The address is printed for a Clerk password-set invite. |
| `import` | `password` is a bcrypt hash | Sent to the port as a digest and linked by the subject id that comes back. |

## Query

```bash
npm run identity:import:users -- --dry-run   # classify only; reaches no provider
```

The equivalent in SQL, if the classification is wanted without running the script
(identities only — the `password` column is never selected):

```sql
SELECT id,
       email,
       CASE
         WHEN identity_provider_subject_id IS NOT NULL THEN 'already-linked'
         WHEN password ~ '^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$' THEN 'import'
         ELSE 'password-set-invite'
       END AS action
  FROM users
 ORDER BY created_at, id;
```

## Result

Filled from a `--dry-run` against the target database before the import. Left
unrecorded rather than inferred.

| Action | Users |
| --- | ---: |
| `import` |  |
| `already-linked` |  |
| `password-set-invite` |  |

Append the `password-set-invite` addresses here — they are the invite list, and
they are the only accounts the import leaves without a Clerk User.

## Rehearsal

Against the scratch database above, seeded with one row of each kind (a bcrypt
User, the OIDC placeholder, and an already-linked User):

```
Users: 3
  to import:            1
  already linked:       1
  password-set invite:  1

Password-set invite (no usable hash, not imported):
  oidc@rehearsal.invalid
```

Run without `CLERK_SECRET_KEY`, the same command printed
`Clerk credentials are not configured` and exited 1 — the port fails closed
rather than marking every User failed. Nothing was written.

## Verifier

The real run re-reads the database after the loop and reports what is left:

```
verifier: 0 importable Users remain unlinked
```

A non-zero count is a failure and exits 1 (ADR-0017: every data-movement script
carries a verifier). Password-set invites are an expected leftover and do not
fail it. Re-running after a partial or crashed run is safe: a linked User
short-circuits before the port, and a User the provider already holds resolves to
the subject it already has.
