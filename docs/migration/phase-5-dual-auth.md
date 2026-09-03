# Phase 5 dual-auth drain and password-set invites

- **Recorded:** 2026-09-03
- **Ticket:** [#109](https://github.com/Lamakira/docuflow/issues/109) (ADR-0007, ADR-0017)
- **Flag:** `DOCUFLOW_IDENTITY_DUAL_AUTH` — owner @Lamakira, removal gate [#111](https://github.com/Lamakira/docuflow/issues/111)
- **Verdict:** rehearsal only. **No production drain has been run yet** — the windows and counts below are blank on purpose and are filled by the operator from the real run.

The drain is the window in which authentication has two answers and
authorization has one. A User reaches the same Membership through the legacy
session they already hold and through a session the IdentityProvider issued
against the subject id the import ([#108](https://github.com/Lamakira/docuflow/issues/108))
linked them to. `WorkspaceContext` is built from the Membership either way, so
nothing about what a User may do changes while the window is open.

## What the flag does

| Flag | Legacy session (email/password, Replit OIDC) | `Authorization: Bearer <provider session>` |
| --- | --- | --- |
| off (default) | Enters the Workspace | Not read. `Unauthorized` |
| on | Enters the Workspace, unchanged | Enters the Workspace as the linked User |

Rollback is turning the flag off. Nothing is written when it flips in either
direction, so there is no down migration to run and no session to invalidate.

Three Bearer surfaces are never read as provider sessions — `/api/agent/*`, where
the header is a Device access token, `/api/v1/*`, where it is a Service Account
secret, and `/api/internal/*`, where it is `DESKTOP_RELEASE_CI_TOKEN`. Enrolled
Devices do not re-pair for this phase.

Fails closed: an unverifiable token, absent Clerk credentials, and a subject no
User is linked to all answer `Unauthorized` rather than falling back to another
identity.

## Window

Filled from the real drain. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Flag on (UTC) | |
| Flag off (UTC) | |
| Users linked at open | |
| Provider sessions observed | |
| Rollbacks during the window | |

## Password-set invites

Only Users the import classifies `password-set-invite` — no usable bcrypt hash,
which is what a Replit OIDC account's `REPLIT_OIDC_USER` placeholder is — are
invited. A User with a hash is never invited and is not made to reset.

```bash
npm run identity:invite:password-set -- --dry-run   # list only; reaches no provider
npm run identity:invite:password-set                # send the invites
```

Run it again once invites have had time to be answered. An invitee who has set a
password is a User at the provider but is still unlinked here, so the second run
writes their subject id back rather than inviting them again — that link is what
lets the account reach a Workspace through the drain, and what keeps the verifier
from staying red as invites are accepted.

| | Users |
| --- | ---: |
| invited | |
| already invited | |
| accepted and linked | |
| failed | |

Append the invited addresses here. They are the same list
[`phase-5-user-import.md`](phase-5-user-import.md) records as the import's only
expected leftover; if the two disagree, the import ran against a different
database.

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/smoke/identity-dual-auth.test.ts`):

- A registered User imported by hash, then presenting a provider session, was
  answered by `/api/auth/user` with the same body their cookie session returns,
  and passed a Workspace-scoped read. Email/password login kept working
  throughout.
- With the flag off, the same provider session was `401 Unauthorized` and the
  legacy session was unaffected.
- A provider session for a subject no User is linked to was `401` with the flag
  on.
- The desktop agent's own Bearer token was answered by the agent's middleware
  (`Invalid access token`), not by the drain.
- The invite run sent one invite to the OIDC-only account and none to the
  password account, whose stored bcrypt hash was asserted untouched; a second run
  sent nothing and reported it already invited.
- With the invite answered at the provider, the next run linked that User by
  subject id instead of inviting again, and the run after it had nothing left to
  do — the verifier reached zero rather than staying red.
- Run without `CLERK_SECRET_KEY`, the command stopped with
  `Clerk credentials are not configured` rather than marking every address
  failed.

## Verifier

The real run re-reads the database and the provider's outstanding invitations
after the loop and reports what is left:

```
verifier: 0 OIDC-only Users remain uninvited
```

A non-zero count is a failure and exits 1 (ADR-0017: every data-movement script
carries a verifier). Re-running after a partial or crashed run is safe: an
address with an invite already outstanding is returned rather than mailed again.

## Exit

The window closes when [#110](https://github.com/Lamakira/docuflow/issues/110)
cuts web auth over to Clerk. The flag and `dualAuthSession` are removed with
Replit OIDC and `MCP_API_KEY` in
[#111](https://github.com/Lamakira/docuflow/issues/111); that ticket is this
flag's removal gate.
