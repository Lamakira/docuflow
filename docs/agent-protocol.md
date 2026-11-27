# DocuFlow Desktop Agent Protocol — V1

> Phase 2 specification. This document defines the pairing flow, API contract,
> event model, and offline-first sync strategy for the Desktop Agent.

---

## 1. Overview

The Desktop Agent (Electron) runs on the user's workstation and sends
time-tracking data (screenshots, activity metrics, heartbeats) to the
DocuFlow backend. It complements the existing Web time tracker.

### V1 Scope
- System screenshots at random intervals
- Keyboard/mouse activity rate (counts only, no keylogging)
- Active window / application tracking (title + process)
- Heartbeat + offline queue with sync

### Non-goals (V1)
- Video recording
- Exact keystroke capture
- Automatic productive/unproductive classification

---

## 2. Standard Fields

Every request from the agent **MUST** include these headers or body fields:

| Field           | Type   | Example                              |
|-----------------|--------|--------------------------------------|
| `clientType`    | string | `"desktop"`                          |
| `clientVersion` | string | `"1.0.0"`                            |
| `deviceId`      | UUID   | `"a1b2c3d4-..."`                     |
| `deviceName`    | string | `"MacBook Pro de Jean"`              |
| `os`            | string | `"macos-14.2"` / `"windows-11.0"`   |

The `Authorization` header carries the short-lived access token:
```
Authorization: Bearer <accessToken>
```

---

## 3. Pairing Flow

```
┌──────────┐                ┌──────────┐              ┌──────────┐
│  Web App │                │ Backend  │              │  Agent   │
└────┬─────┘                └────┬─────┘              └────┬─────┘
     │ POST /agent/pairing/start │                         │
     │ (authenticated)           │                         │
     │──────────────────────────>│                         │
     │  { pairingCode, expiresAt}│                         │
     │<──────────────────────────│                         │
     │                           │                         │
     │   User reads code aloud   │                         │
     │   or scans QR             │                         │
     │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ >│
     │                           │                         │
     │                           │ POST /agent/pairing/complete
     │                           │ { pairingCode, deviceMeta }
     │                           │<────────────────────────│
     │                           │ { deviceId, deviceToken,│
     │                           │   accessToken, expiresAt}│
     │                           │────────────────────────>│
     │                           │                         │
     │                           │        Agent stores     │
     │                           │        deviceToken in   │
     │                           │        OS Keychain      │
```

### Security details
- `pairingCode`: 6-digit alphanumeric, expires in 10 minutes
- `deviceToken`: long-lived (90 days), stored **hashed** (SHA-256) on server
- `accessToken`: short-lived (1 hour), JWT or opaque token
- Agent refreshes `accessToken` using `deviceToken` before expiry

---

## 4. API Endpoints

### 4.1 Pairing

#### `POST /api/agent/pairing/start`
**Auth**: Web session (cookie)

Request: _(empty body)_

Response `200`:
```json
{
  "pairingCode": "A7K3M9",
  "expiresAt": "2026-02-28T12:10:00Z"
}
```

#### `POST /api/agent/pairing/complete`
**Auth**: None (public, rate-limited)

Request:
```json
{
  "pairingCode": "A7K3M9",
  "deviceMeta": {
    "deviceName": "MacBook Pro de Jean",
    "os": "macos-14.2",
    "clientVersion": "1.0.0"
  }
}
```

Response `200`:
```json
{
  "deviceId": "uuid",
  "deviceToken": "raw-token-stored-in-keychain",
  "accessToken": "short-lived-jwt",
  "expiresAt": "2026-02-28T13:00:00Z"
}
```

Error `400`: Invalid or expired pairing code.

#### `POST /api/agent/auth/refresh`
**Auth**: None (uses deviceToken in body)

Request:
```json
{
  "deviceId": "uuid",
  "deviceToken": "raw-token"
}
```

Response `200`:
```json
{
  "accessToken": "new-short-lived-jwt",
  "expiresAt": "2026-02-28T14:00:00Z"
}
```

Error `401`: Revoked device or invalid token.

#### `POST /api/agent/device/revoke`
**Auth**: Web session (cookie), must be device owner or admin

Request:
```json
{ "deviceId": "uuid" }
```

Response `200`: `{ "ok": true }`

---

### 4.2 Ingestion

All ingestion endpoints require `Authorization: Bearer <accessToken>`.

#### `POST /api/agent/heartbeat`

Request:
```json
{
  "deviceId": "uuid",
  "timeEntryId": "uuid-or-null",
  "timestamp": "2026-02-28T12:05:00Z",
  "activeApp": "Visual Studio Code",
  "activeWindow": "agent-protocol.md — DocuFlow",
  "clientType": "desktop",
  "clientVersion": "1.0.0"
}
```

Response `200`:
```json
{
  "ok": true,
  "serverTime": "2026-02-28T12:05:01Z"
}
```

#### `POST /api/agent/events/batch`

Request:
```json
{
  "deviceId": "uuid",
  "batchId": "unique-uuid",
  "clientType": "desktop",
  "clientVersion": "1.0.0",
  "events": [
    {
      "type": "input_activity",
      "timestamp": "2026-02-28T12:04:00Z",
      "data": { "keyCount": 42, "mouseCount": 15, "scrollCount": 3 }
    },
    {
      "type": "active_window",
      "timestamp": "2026-02-28T12:04:00Z",
      "data": { "appName": "Code", "windowTitle": "index.ts", "processName": "code" }
    },
    {
      "type": "idle_start",
      "timestamp": "2026-02-28T12:04:30Z",
      "data": {}
    },
    {
      "type": "idle_end",
      "timestamp": "2026-02-28T12:07:00Z",
      "data": {}
    }
  ]
}
```

Response `200`:
```json
{ "ok": true, "accepted": 4 }
```

Response `200` (duplicate batchId):
```json
{ "ok": true, "accepted": 0, "duplicate": true }
```

**Idempotency**: Server stores processed `batchId`s for 7 days. Duplicate batches
return 200 with `duplicate: true` — never 4xx.

#### `POST /api/agent/screenshots/presign`

Request:
```json
{
  "deviceId": "uuid",
  "timeEntryId": "uuid",
  "capturedAt": "2026-02-28T12:04:15Z",
  "clientType": "desktop",
  "clientVersion": "1.0.0"
}
```

Response `200`:
```json
{
  "screenshotId": "uuid",
  "uploadURL": "https://storage.googleapis.com/...",
  "expiresAt": "2026-02-28T12:19:15Z"
}
```

#### `POST /api/agent/screenshots/confirm`

Request:
```json
{
  "screenshotId": "uuid",
  "deviceId": "uuid"
}
```

Response `200`: `{ "ok": true }`

#### `GET /api/agent/screenshots/deleted`

Captures of this Member that an admin deleted on the web, so the agent can drop
its local copies. Query: `since` (ISO date; default now − 30 days, never earlier
than now − 31 days). Up to 1000 entries, newest first.

Response `200`:
```json
{ "data": [{ "id": "uuid", "capturedAt": "2026-02-28T12:04:15.000Z" }] }
```

The agent matches `capturedAt` to its local captures by instant, not by string.

---

## 5. Event Model

| Event Type       | Frequency     | Data Fields                                |
|------------------|---------------|--------------------------------------------|
| `input_activity` | Every 60s     | `keyCount`, `mouseCount`, `scrollCount`    |
| `active_window`  | Every 30s     | `appName`, `windowTitle`, `processName`    |
| `idle_start`     | On idle       | _(empty)_                                  |
| `idle_end`       | On resume     | _(empty)_                                  |
| `heartbeat`      | Every 60s     | via dedicated endpoint, not event batch    |

### Idle semantics
- Agent detects idle locally (no input for > threshold, default 180s)
- Sends `idle_start` event when idle begins, `idle_end` when input resumes
- Backend keeps `flag_only` policy (Phase 1 Sprint B.3) — may evolve to auto-pause

---

## 6. Offline-First Strategy

### Local storage: SQLite

```
pending_batches
  - id TEXT PRIMARY KEY
  - batch_id TEXT UNIQUE
  - payload TEXT (JSON)
  - attempt_count INTEGER DEFAULT 0
  - next_retry_at INTEGER (unix ms)
  - created_at INTEGER

pending_screenshots
  - id TEXT PRIMARY KEY
  - screenshot_path TEXT
  - time_entry_id TEXT
  - captured_at TEXT
  - attempt_count INTEGER DEFAULT 0
  - next_retry_at INTEGER (unix ms)

sync_state
  - key TEXT PRIMARY KEY
  - value TEXT
```

### Sync worker loop

```
1. Refresh accessToken if expired (using deviceToken)
2. Pick oldest pending_batch WHERE next_retry_at <= now
3. POST /api/agent/events/batch
4. If 200 → delete from pending_batches
5. If 401 → refresh token, retry
6. If 429 / 5xx → increment attempt_count, set next_retry_at with
   exponential backoff: min(30s * 2^attempt, 15min)
7. Repeat for pending_screenshots (presign → upload → confirm)
```

### Compaction
- `input_activity` events are aggregated per minute before batching
- Batches capped at 100 events / 500KB

### Conflict rules
- **Source of truth for time entries = backend**
- Agent attaches events to `activeTimeEntryId` known from last heartbeat response
- If no active entry, events are stored with `timeEntryId: null` — backend
  may associate later via user + time window
- [PLACEHOLDER] Timer control from agent (start/stop) deferred to Phase 3

---

## 7. Security & Privacy (V1)

| Concern              | Approach                                         |
|----------------------|--------------------------------------------------|
| Token storage        | OS Keychain (macOS) / Credential Manager (Win)   |
| Token at rest (DB)   | `deviceToken` stored as SHA-256 hash             |
| Access token         | Short-lived (1h), rotated via refresh            |
| Consent              | First-run dialog: screenshots + activity metrics |
| Keylogging           | **Never** — only counts per minute               |
| Screenshot blur      | [PLACEHOLDER] V2 feature                         |
| Data retention       | [PLACEHOLDER] 30/90/180 days + purge jobs        |
| Encryption at rest   | Delegated to storage provider (GCS bucket enc.)  |

---

## 8. Agent Lifecycle

| Feature          | V1                                        |
|------------------|-------------------------------------------|
| Auto-start       | Optional, configurable at OS login        |
| Background mode  | System tray (macOS menu bar / Win taskbar)|
| Crash recovery   | Worker resumes from SQLite queue on restart|
| Auto-update      | [PLACEHOLDER] electron-updater, GitHub releases |
| Observability    | Local rolling logs, structured JSON       |
