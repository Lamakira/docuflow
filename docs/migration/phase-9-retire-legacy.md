# Phase 9: retire leftover MCP impersonation and task probes

- **Recorded:** 2026-09-07
- **Ticket:** [#163](https://github.com/Lamakira/docuflow/issues/163) (Spec [#157](https://github.com/Lamakira/docuflow/issues/157), ADR-0011, ADR-0017, ADR-0018)
- **Verdict:** rehearsal only. **No production cutover has been run yet** — the counts below are blank on purpose and are filled by the operator from the real run.

The MCP companion still sent `X-API-Key` after #111 stopped that header
impersonating the Owner. It now authenticates as a Service Account against
`/api/v1`. `detectMigrationFlags` / `isTasksEnabled` were a boot probe for a
`tasks` table the journal already requires; they are removed, not replaced.
Owner impersonation stays gone.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| MCP companion (`mcp-server/`) | `X-API-Key` against `/api/*` | `Authorization: Bearer` against `/api/v1` with `DOCUFLOW_API_KEY` as a Service Account key |
| Guarded `/api/*` + `X-API-Key` | 401 since #111 | Unchanged 401 |
| `MCP_API_KEY` in `server/config.ts` | Unread since #111 | Still unread |
| `detectMigrationFlags` / `isTasksEnabled` | Boot probe; task writes 503 when the probe had not run | Gone. Task routes serve on a migrated database |
| `GET /api/time-tracking/capabilities` and `GET /api/agent/capabilities` | `{ requiresTask: isTasksEnabled() }` | `{ requiresTask: true }` |

## Rollback

Redeploy the previous image. The companion would send `X-API-Key` again and the
API would still ignore it. Task routes would probe at boot. No schema change.

## Window

Filled from the real cutover. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Image deployed (UTC) | |
| Rollbacks | |

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com
(`tests/smoke/mcp-companion.test.ts`, `tests/smoke/tasks-required.test.ts`,
`tests/smoke/config.test.ts`, `tests/smoke/identity-clerk-only.test.ts`):

| Gate | Status | Evidence |
| --- | --- | --- |
| MCP companion does not set `X-API-Key`; it uses Bearer against `/api/v1` | **Verified** | companion source scan |
| A Service Account key can call an allowlisted `/api/v1` read | **Verified** | `GET /api/v1/clients` 200 |
| A matching `X-API-Key` on guarded `/api/*` remains 401 | **Verified** | `/api/admin/users` |
| Config keeps refusing `MCP_API_KEY` impersonation | **Verified** | `tests/smoke/config.test.ts` |
| `detectMigrationFlags` / `isTasksEnabled` gone; Task routes do not 503 | **Verified** | `tests/smoke/tasks-required.test.ts`; `POST /api/tasks` 200 |
| Production MCP / probe retirement | **Open** | counts below are blank on purpose (ADR-0018) |

## Exit

The companion is a Service Account client of `/api/v1`. Task routes assume the
journal. Rollback is the previous image.
