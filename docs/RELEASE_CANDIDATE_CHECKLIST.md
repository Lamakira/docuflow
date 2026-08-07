# DocuFlow Desktop Agent — Release Candidate Checklist

> Last updated: 2026-03-12
> Branch: `claude/clarify-project-scope-0DMnK`
> Current version: v0.1.3

---

## Verdict

**NOT READY FOR RELEASE CANDIDATE**

Blocking items listed below. All non-blockers can ship with documented known issues.

---

## BLOCKERS (must fix before RC)

### B1 — JWT_SECRET must be a persistent deployment secret
- **Impact:** Every server restart invalidates all desktop JWTs → agents forcibly log out, session cleared, user must re-authenticate.
- **Zone:** `server/desktopTokens.ts`, reading `config.desktopTokens` from `server/config.ts`.
- **Status:** DONE ([#23](https://github.com/Lamakira/docuflow/issues/23)) — the ephemeral fallback is gone; the server refuses to boot without `JWT_SECRET`, so the misconfiguration can no longer reach production silently.
- **Fix:** Set `JWT_SECRET` as `<key-id>:<secret>` in the deployment's secret store, e.g. `2026-08:$(openssl rand -hex 32)`. Rotate it through `JWT_PREVIOUS_SECRET` — procedure in [CONFIGURATION.md](CONFIGURATION.md#desktop-access-token-signing-keys).

### B2 — Server must be restarted on Replit with latest code
- **Impact:** Tasks feature still blocked by old `isTasksEnabled()` = false behavior until server picks up commit `1495f15`.
- **Zone:** `server/index.ts` — `setTasksEnabled(true)` fix + `detectMigrationFlags()` skip
- **Status:** Code fix pushed, Replit pull + restart required.
- **Fix:** Pull latest code on Replit → restart server → verify boot log shows "Tasks migration OK" (not "DISABLED").

### B3 — Desktop download URL points to dev server, not production
- **Impact:** `desktop-agent/src/lib/config.ts` `DEFAULT_API_URL` still points to the Replit dev preview URL. Distributed `.exe` connects to dev, not production.
- **Zone:** `desktop-agent/src/lib/config.ts`
- **Status:** TODO — production URL not yet stable/confirmed.
- **Fix:** Update `DEFAULT_API_URL` to production URL once the production deployment is stable. Then rebuild + publish installer.

---

## IMPORTANT BUT NOT BLOCKING

### I1 — Tasks table migration: verify on production DB
- **Impact:** Tasks feature will be disabled on production if `002_s2_tasks.sql` was never applied there.
- **Zone:** DB (production)
- **Status:** Applied on dev DB. Production status unknown.
- **Fix:** Run `psql "$DATABASE_URL" -f migrations/002_s2_tasks.sql` on production before or during RC deploy.

### I2 — Download URL in DevicesPage.tsx is outdated
- **Impact:** "Get the app" button on Devices page links to v0.1.1 release, not v0.1.3.
- **Zone:** `client/src/pages/DevicesPage.tsx` — `DOWNLOAD_URL_WINDOWS` constant
- **Status:** TODO
- **Fix:** After publishing v0.1.3 GitHub Release, update the constant to the new asset URL.

### I3 — Pairing codes table can be dropped
- **Impact:** Dead table in DB, slightly misleading schema. No functional impact.
- **Zone:** DB — `agent_pairing_codes` table
- **Status:** Deferred intentionally (noted in MEMORY.md)
- **Fix:** Add `DROP TABLE IF EXISTS agent_pairing_codes` to a future cleanup migration.

### I4 — DOWNLOAD_GUIDE.md references outdated paths and pairing flow
- **Impact:** Documentation confusion for anyone following the guide.
- **Zone:** `docs/DOWNLOAD_GUIDE.md`
- **Status:** Updated as part of this RC prep (see DESKTOP_RELEASE_LOG.md).

### I5 — No code signing on the installer
- **Impact:** Windows SmartScreen warns on first launch. Users must click "More info → Run anyway".
- **Zone:** `desktop-agent/package.json` build config
- **Status:** Known MVP limitation. Documented in DOWNLOAD_GUIDE.md.
- **Fix:** Obtain EV code signing certificate (post-RC).

---

## CAN WAIT AFTER RC

### L1 — agent-config.json stores device token in plaintext
- **Impact:** Long-lived credential readable by other processes on multi-user systems.
- **Zone:** `desktop-agent/src/lib/AgentStore.ts`
- **Fix (future):** Migrate to Electron `safeStorage` API (OS keychain).

### L2 — Screenshot upload race condition
- **Impact:** Screenshot can be uploaded after timer was stopped (presign issued while running, upload arrives later). Data quality issue, not security.
- **Zone:** `server/agentRoutes.ts` — upload handler has no re-check of timer status.
- **Fix (future):** Re-validate `time_entry.status === "running"` in upload handler.

### L3 — Revoked device has up to 1h JWT window
- **Impact:** Revoked device can still make read API calls until JWT expires.
- **Zone:** `server/agentRoutes.ts` — `isAgentAuthenticated` only validates JWT, does not cross-check DB on reads.
- **Fix (future):** Add DB revocation check to read routes, or reduce JWT TTL.

### L4 — No "Forgot password" flow on Desktop Agent
- **Impact:** Users who forget their password cannot recover from the desktop app.
- **Zone:** `desktop-agent/src/renderer/index.html`
- **Fix (future):** Add link to web app password reset.

### L5 — No auto-update
- **Impact:** Users must manually download new versions.
- **Zone:** Desktop packaging
- **Fix (future):** Implement electron-updater with GitHub Releases as update source.

---

## What is done ✅

- Email + password login for Desktop Agent (no pairing codes)
- Persistent session with auto-restore on restart
- Device revoke → immediate session clear + workers stop
- Tasks table auto-created at server boot (idempotent)
- `isTasksEnabled()` flag correctly set after migration (B2 pending restart)
- Task creation from Time Tracker (web) — BLOC A
- Task creation from CRM Project Page (web)
- Task selection in Desktop Agent timer
- Window resizable (420px min, no max → full screen maximize works)
- `requireActiveDevice()` uses JWT device ID only (security fix)
- NSIS single-file installer (`DocuFlowAgentSetup.exe`) as official artifact
- Uninstall script (`scripts/uninstall-agent.ps1`)
