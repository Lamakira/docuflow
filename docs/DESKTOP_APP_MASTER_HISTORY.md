# DocuFlow Desktop Agent — Master History

> A chronological record of every major phase, decision, and change in the Desktop Agent.
> Intended for: anyone joining the project who needs to understand what was built, why, and what changed.

---

## Architecture Overview

The Desktop Agent is an Electron app that:
- Runs in the system tray (no taskbar window)
- Authenticates with the DocuFlow server using email + password
- Tracks time via the web server's timer API
- Captures periodic screenshots while the timer is running
- Sends activity events (keystrokes, mouse) to the server in batches
- Syncs timer state from the server every 30 seconds (server is source of truth)

**Monorepo location:** `desktop-agent/`

**Tech stack:** Electron 33, electron-forge (packaging), electron-builder (NSIS installer), webpack (bundler), TypeScript

---

## Phase 2 — Architecture Foundations

**What was built:**
- Basic Electron app shell with main/renderer/preload separation
- Tray icon with show/hide behavior
- IPC bridge via `contextBridge` (preload.ts)
- `AgentStore` class: persists session data to `agent-config.json` in `app.getPath("userData")`
- `ApiClient` class: HTTP client targeting the DocuFlow server
- SQLite queue (`SqliteQueue`) for offline event batching

**Key decisions:**
- `contextIsolation: true` + `nodeIntegration: false` for security
- Store uses plain JSON file (not OS keychain) — acceptable for MVP, flagged for future improvement
- Window hides on close instead of quitting (lives in tray)

---

## Phase 3 — MVP Timer

**What was built:**
- `HeartbeatWorker`: sends heartbeat to server every 30s, receives timer sync response
- `ActivityWorker`: captures keyboard/mouse activity, queues events
- `SyncWorker`: flushes event queue to server in batches
- Timer controls exposed via IPC: start, pause, resume, stop
- Project + task selection in the renderer UI
- Timer state persisted locally, synced from server on startup

**Key decisions:**
- Backend is source of truth for timer state — desktop reconciles with server on every heartbeat
- `syncTimerFromServer()` called at startup to recover state after restart
- Workers stop automatically on device revoke or sign-out

---

## Phase 4 — Screenshots + JWT Auth

**What was built:**
- `ScreenCaptureWorker`: periodic screenshot via `desktopCapturer`, queued to SQLite
- Screenshot presign/upload/confirm flow: `POST /presign` → `PUT /upload` → `POST /confirm`
- JWT authentication: short-lived access token (1h), refreshed from device token
- Device token: 48-byte random hex, stored as SHA-256 hash in DB, raw sent once to client
- `ensureAccessToken()` in ApiClient: refreshes JWT automatically before expiry

**Key decisions:**
- Two-step upload (presign + confirm) to support future GCS migration
- Screenshots are optional (toggled by `SCREENSHOTS_ENABLED` env var)
- JWT TTL = 1h with automatic refresh; device token = long-lived credential

---

## Phase 4.5 — Packaging & Distribution

**What was built:**
- `electron-forge` for packaging (creates `out/` directory)
- `electron-builder` NSIS for single-file installer (`DocuFlowAgentSetup.exe`)
- `scripts/dist-win.js`: orchestrates forge package → builder NSIS
- `docs/DOWNLOAD_GUIDE.md`: installation, distribution, GitHub Release guide
- Uninstall script: `scripts/uninstall-agent.ps1`

**Artifact strategy:**
- **Official:** `release/DocuFlowAgentSetup.exe` — NSIS per-user installer, no admin required
- **Deprecated:** any `.msi` or Squirrel-based approach — abandoned
- **ZIP portable:** available via `npm run package` but not the primary distribution path

**Known limitation:** No code signing → SmartScreen warning on first launch.

---

## Sprint S1 — Initial Pairing Flow (now deprecated)

**What was built:**
- Pairing code flow: web generates 6-digit code → desktop enters it → device registered
- `POST /api/agent/pairing/start` + `POST /api/agent/pairing/complete`
- Desktop UI: server URL input + pairing code input

**Why it was removed (S4):**
- Added unnecessary complexity (code copy-paste step)
- Server URL was a source of errors (users entering wrong URL)
- Email/password login is simpler and already available

---

## Sprint S2 — Tasks Feature

**What was built:**
- `tasks` table in DB (migration `002_s2_tasks.sql`)
- `task_id` column on `time_entries`
- `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`
- `GET /api/agent/tasks` for desktop
- Task creation in CRM Project Page (Tasks card)
- Task selection in Time Tracker (web) and Desktop Agent
- `isTasksEnabled()` feature flag (probes DB at boot)

**Tasks are linked to `crm_projects.id`, not `projects.id`.**

---

## Sprint S3 — Screenshots & Onboarding Stabilization

**What was built:**
- Structured logs for desktop agent activity
- Screenshots info display in desktop UI
- Session log improvements

---

## Sprint S4 — Desktop Auth Stabilization (2026-03-11)

**What changed:**
- **Pairing code flow fully removed** (both desktop and web)
- **New auth flow:** email + password → `POST /api/agent/auth/login` → deviceToken + JWT
- **Server URL removed** from desktop UI — hardcoded in `config.ts` with `DOCUFLOW_API_URL` env override
- **Device name** auto-derived from `os.hostname()` — no manual input
- `AgentStore.setSession(deviceId, deviceToken, deviceName, userEmail)` replaces `setPairing()`
- On revoke (401/403): `handleDeviceRevoked()` → `clearSession()` → login screen

**Deprecated endpoints** (return 410 Gone):
- `POST /api/agent/pairing/start`
- `POST /api/agent/pairing/complete`

**Security fix (2026-03-12):**
- `requireActiveDevice()` now uses only `req.agentDeviceId` (JWT-verified), ignoring `req.body.deviceId`

---

## Stabilization Phase (2026-03-12)

**Bugs found and fixed:**
1. `detectMigrationFlags()` was clobbering `setTasksEnabled(true)` because it ran on the same boot cycle, using Drizzle's `db` which could target a different DB in environments where `DATABASE_URL` and `PG*` vars differ. **Fix:** skip `detectMigrationFlags()` when `ensureTasksMigration()` succeeds. *(Superseded by #24: boot no longer applies migrations, so `ensureTasksMigration()` and `setTasksEnabled()` are gone and `detectMigrationFlags()` — a read-only probe — always runs.)*
2. `apiRequest` in the web client already parses JSON — `TasksSection` was calling `.then(r => r.json())` on the result, causing a runtime error. **Fix:** removed the double-parse.
3. `requireActiveDevice()` accepted `deviceId` from request body as fallback, allowing potential device identity spoofing. **Fix:** use only JWT-derived device ID.

**UX improvements:**
- Window made resizable (min 420px wide, no max — allows true fullscreen maximize)
- Default window size bumped to 580×700
- Task creation added directly to Time Tracker popover (BLOC A)

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `desktop-agent/src/main/index.ts` | Main process, IPC handlers, worker lifecycle |
| `desktop-agent/src/lib/ApiClient.ts` | HTTP client, JWT refresh, all API calls |
| `desktop-agent/src/lib/AgentStore.ts` | Local persistence (`agent-config.json`) |
| `desktop-agent/src/lib/config.ts` | `API_BASE` — server URL config |
| `desktop-agent/src/renderer/index.html` | Renderer UI (vanilla JS) |
| `desktop-agent/src/renderer/preload.ts` | IPC bridge (`contextBridge`) |
| `desktop-agent/src/workers/HeartbeatWorker.ts` | 30s heartbeat + timer sync |
| `desktop-agent/src/workers/ActivityWorker.ts` | Keyboard/mouse activity capture |
| `desktop-agent/src/workers/SyncWorker.ts` | Event batch upload |
| `desktop-agent/src/workers/ScreenCaptureWorker.ts` | Periodic screenshot capture |
| `server/agentRoutes.ts` | All `/api/agent/*` backend routes |
| `shared/schema.ts` | DB schema — devices, tasks, time_entries, etc. |
| `migrations/002_s2_tasks.sql` | Tasks table migration |
| `migrations/003_agent_tables.sql` | Agent tables reference SQL |

---

## Points of Vigilance

1. **`JWT_SECRET` must be set as a persistent env var** in production, as `<key-id>:<secret>`. The server used to generate a random key per boot when it was unset, invalidating every token on restart; since [#23](https://github.com/Lamakira/docuflow/issues/23) it refuses to boot instead, and rotation goes through `JWT_PREVIOUS_SECRET` ([CONFIGURATION.md](CONFIGURATION.md#desktop-access-token-signing-keys)).
2. **`DEFAULT_API_URL` in `config.ts`** must be updated to the production URL before distributing the installer.
3. **Tasks table migration** must be applied on every DB environment (dev + prod) before the tasks feature works.
4. **Avast/Windows Defender** will block the NSIS installer write during build — disable File Shield temporarily when building.
5. **Single instance lock** is enforced — a second launch of the agent will focus the existing window instead of opening a new one.
