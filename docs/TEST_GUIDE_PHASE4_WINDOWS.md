# Phase 4 Windows Test Guide

Desktop Agent — SQLite Queue + Screenshot Pipeline + JWT Auth

## Prerequisites

- Windows 10/11 (or macOS/Linux — same code path)
- Node.js 18+ installed
- DocuFlow server running (Replit or local)
- `JWT_SECRET` set in the server environment as `<key-id>:<secret>` — required; the server will not boot without it
- GCS Object Storage configured (`PRIVATE_OBJECT_DIR` env var) for screenshot upload

---

## 1. Build and Launch the Desktop Agent

```powershell
cd desktop-agent
npm install
$env:SCREENSHOTS_ENABLED="true"   # Enable screenshot capture
npm run start
```

The agent window opens. The SQLite queue database is created at:
`%APPDATA%\docuflow-agent\agent-queue.db` (Windows) or
`~/Library/Application Support/docuflow-agent/agent-queue.db` (macOS)

---

## 2. Pair the Device

1. Open the DocuFlow web app → Settings → Desktop Agents → **Generate Pairing Code**
2. In the agent window, enter:
   - **Server URL**: `https://your-docuflow.replit.app`
   - **Device Name**: `My Work PC`
   - **Pairing Code**: (6-char code from web)
3. Click **Connect**
4. Verify: status dot turns green, device appears in web Settings

Expected log output:
```
[AgentStore] Paired — deviceId: <uuid>
[HeartbeatWorker] Started (60s interval)
[SyncWorker] Started (30s interval, SQLite-backed)
[ScreenCaptureWorker] Started (interval ~3min)
```

---

## 3. Start Timer and Verify Queue

1. Select a project from the dropdown → click **Start Timer**
2. Timer turns green and starts counting

Expected logs:
```
[HeartbeatWorker] OK (server: <timestamp>)
[ActivityDetectionWorker] Enqueued activity event
[SyncWorker] Events: N synced (total: N)
```

**Verify queue persistence**: Kill the agent (`Ctrl+C` in terminal) and relaunch.
The timer should still show (server state) and any pending events should re-sync.

---

## 4. Screenshot Capture Test

With `SCREENSHOTS_ENABLED=true` and timer running, wait ~3 minutes (or lower
`CAPTURE_INTERVAL_BASE_MS` temporarily to 10 seconds for testing).

Expected flow:
```
[ScreenCaptureWorker] Captured screenshot-1234567890.png (420 KB, total: 1)
[SyncWorker] Screenshot abc12345 uploaded (total: 1)
```

**Verify in web UI**: Settings → Desktop Agents → device → Screenshots tab
(or time entry detail page) should show the captured screenshot.

**Verify GCS**: In Replit Object Storage, check `PRIVATE_OBJECT_DIR/agent-screenshots/<id>.png` exists.

### Screenshot rejection cases to test:

| Scenario | Expected |
|---|---|
| Screenshot > 5 MB | Logged as "too large, skipping" — not enqueued |
| Timer paused/stopped | Logged as "Skipping — timer not running" |
| No active entry | Silently skips, reschedules |
| Upload fails (server down) | Retried up to 5× with exponential backoff, then dropped |

---

## 5. JWT Token Test

Tokens are now stateless JWTs (HMAC-SHA256). To verify:

1. Pair the device — server returns a JWT access token (1 hour TTL)
2. Restart the server (this previously invalidated in-memory tokens)
3. The agent should **automatically refresh** the token via `/api/agent/auth/refresh`
   using the persisted `deviceToken` — no re-pairing needed

Expected log after server restart:
```
[HeartbeatWorker] OK (server: <timestamp>)   ← token refreshed successfully
```

Tokens survive the restart because `JWT_SECRET` holds the signing key: the server
reads it at boot rather than generating one, so the next process verifies what
the last one issued. See [CONFIGURATION.md](CONFIGURATION.md#desktop-access-token-signing-keys).

---

## 6. Rate Limit Test (optional)

Screenshot endpoints are limited to **10 requests/minute per IP**.

```bash
# From the agent machine, send 11 rapid presign requests:
for i in {1..11}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://your-docuflow.replit.app/api/agent/screenshots/presign \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"deviceId":"...","timeEntryId":"...","capturedAt":"2026-01-01T00:00:00Z","clientType":"electron","clientVersion":"0.1.0"}'
done
```

The 11th request should return `429 Too Many Requests`.

---

## 7. Disconnect and Re-pair

1. Click **Disconnect Device** in the agent
2. Confirm — agent returns to pairing screen
3. Device token is wiped from local store (not from server DB)
4. Re-pair with a new code to restore connectivity

---

## Checklist

- [ ] Agent pairs successfully
- [ ] Timer start/pause/resume/stop works
- [ ] Heartbeat logs every 60s
- [ ] Activity events sync to server (SyncWorker log)
- [ ] Screenshot captured after ~3 min with timer running
- [ ] Screenshot appears in GCS / web UI
- [ ] Queue persists across agent restart
- [ ] JWT refresh works after server restart (no re-pair needed)
- [ ] 429 returned after >10 screenshot requests/min
