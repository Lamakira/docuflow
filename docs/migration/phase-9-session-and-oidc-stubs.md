# Phase 9: unmount leftover cookie sessions and OIDC stubs

- **Recorded:** 2026-09-07
- **Ticket:** [#162](https://github.com/Lamakira/docuflow/issues/162) (Spec [#157](https://github.com/Lamakira/docuflow/issues/157), ADR-0007, ADR-0017, ADR-0018)
- **Verdict:** rehearsal only. **No production cutover has been run yet** — the counts below are blank on purpose and are filled by the operator from the real run.

Cookie `express-session` was leftover after Clerk became the only web session.
Timer Command `origin` stopped reading `req.sessionID`. Retired Replit OIDC
routes no longer answer `410`. The `sessions` table drops with the store that
wrote it. IdentityProvider Bearer sessions, Device tokens, and Service Account
keys are unchanged.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `GET /api/login`, `/api/callback`, `/api/logout` | Mounted `410` handlers | Unmounted. A leftover bookmark is `404` |
| `POST /api/auth/logout` | Destroyed an `express-session` cookie | Unmounted. The SPA signs out through Clerk |
| `express-session` / `connect-pg-simple` | Mounted on every request | Gone from the server boot path |
| Web Timer Command `origin` | `web:${req.sessionID ?? userId}` | `web:${userId}` |
| `sessions` table | Cookie-session store | Dropped (`0028_volatile_thunderbolt_ross`) |
| Drain-era names (`isDrainablePath`, `PATHS_NOT_DRAINED`, `DualAuthPersistence`) | Identity module identifiers | `isWebSessionPath`, `PATHS_WITHOUT_WEB_SESSION`, `WebSessionPersistence` |
| Route skipping for `/api/agent`, `/api/v1`, `/api/internal` | Same skip list, drain names | Same skip list, including web Device-management exceptions |

## Rollback

Redeploy the previous image. The table is not recreated (no down migration).
IdentityProvider Bearer sessions, Device refresh, and pairing are unchanged.

## Window

Filled from the real cutover. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Image deployed (UTC) | |
| Rollbacks | |

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/smoke/identity-session-unmounted.test.ts`,
`tests/smoke/identity-clerk-only.test.ts`,
`tests/characterization/auth-session.test.ts`,
`tests/smoke/identity-dual-auth.test.ts`,
`tests/characterization/agent-auth.test.ts`):

| Gate | Status | Evidence |
| --- | --- | --- |
| `GET /api/login`, `/api/callback`, `/api/logout` are not 410 | **Verified** | clerk-only smoke expects 404 |
| `POST /api/auth/logout` is unmounted; provider session still enters the Workspace | **Verified** | auth-session characterization |
| `express-session` / `connect-pg-simple` gone from boot; a web Timer Command still records an origin | **Verified** | origin `web:${userId}`; no `connect.sid` cookie |
| `sessions` table absent after migrate | **Verified** | `information_schema` / `pg_tables` in smoke; migration `0028_volatile_thunderbolt_ross` |
| IdentityProvider Bearer sessions still enter WorkspaceContext | **Verified** | session-unmounted + clerk-only + dual-auth HTTP |
| Drain-era names gone; `/api/agent`, `/api/v1`, `/api/internal` still skipped, with web Device-management exceptions | **Verified** | identity-dual-auth path skip cases |
| Agent characterization stays green | **Verified** | agent-auth characterization (run with the full suite) |
| Production session unmount | **Open** | counts below are blank on purpose (ADR-0018) |

## Exit

Leftover OIDC bookmarks and cookie-session logout cannot come back. Clerk owns
the web session. Rollback is the previous image.
