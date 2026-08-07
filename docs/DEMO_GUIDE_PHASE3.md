# Phase 3 MVP — Demo Guide

## Prerequisites

1. DocuFlow web app running (Replit)
2. `DATABASE_URL` configured in Replit Secrets
3. Run `npm run db:migrate` to create agent tables (devices, agent_pairing_codes, etc.)
4. Desktop Agent built (`cd desktop-agent && npm install && npm run dev`)

---

## Demo Flow (step by step)

### 1. Web: Generate Pairing Code

1. Open DocuFlow web app
2. Navigate to **Devices** page (sidebar → "Devices" icon)
3. Click **"Connect Device"**
4. A 6-character pairing code appears (e.g., `H3K9WN`)
5. Code expires in 10 minutes

### 2. Desktop Agent: Pair

1. Launch the Desktop Agent (`npm run dev` in `desktop-agent/`)
2. Enter:
   - **Server URL**: `https://your-docuflow.replit.app`
   - **Device Name**: `Demo Laptop`
   - **Pairing Code**: the 6-char code from step 1
3. Click **Connect**
4. Agent shows "Connected" with green status dot
5. Web: refresh /devices page → device appears with "Online" badge

### 3. Desktop Agent: Start Timer

1. In the agent, select a **Project** from the dropdown
2. Optionally add a description
3. Click **"Start Timer"**
4. Timer starts counting (green `00:00:XX`)
5. **Web verification**: Open Time Tracking page → timer should be running with matching project

### 4. Desktop Agent: Pause / Resume / Stop

1. Click **Pause** → timer shows yellow "PAUSED" + accumulated time
2. **Web**: timer shows paused status
3. Click **Resume** → timer resumes counting (green "RUNNING")
4. **Web**: timer shows running again
5. Click **Stop** → timer resets, project selector reappears
6. **Web**: Time Tracking page shows the completed entry with correct duration

### 5. Heartbeat + Events (background)

While timer is running:
- **Heartbeat**: sent every 60s → check server logs: `agent.heartbeat { deviceId, timeEntryId }`
- **Active window events**: enqueued every 10s, synced every 30s
- **Verify in DB/logs**: `agent.events.batch { deviceId, count, batchId }`

### 6. Web: Revoke Device

1. On /devices page, click the trash icon next to the device
2. Confirm revocation
3. Device shows "Revoked" badge
4. Agent: subsequent API calls will return 403

---

## What to verify

| Feature | How to verify |
|---------|--------------|
| Pairing | Device appears on /devices page |
| Timer Start | Entry visible in Time Tracking page |
| Timer Pause/Resume | Status updates in real-time on web |
| Timer Stop | Entry shows final duration |
| Heartbeat | Server logs: `agent.heartbeat` |
| Events batch | Server logs: `agent.events.batch` |
| Device revoke | Agent gets 403 on next request |
| Token refresh | Agent auto-refreshes after 1h (transparent) |

---

## Architecture Summary

```
Desktop Agent (Electron)
├── Renderer (HTML/JS)
│   ├── Pairing Screen (code entry)
│   └── Timer UI (Start/Pause/Resume/Stop + elapsed display)
├── Main Process (IPC handlers)
│   ├── agent:pair → ApiClient.completePairing()
│   ├── agent:timer-start → ApiClient.startTimer()
│   ├── agent:timer-pause/resume/stop
│   └── pushStateToRenderer()
├── Workers
│   ├── HeartbeatWorker (60s → POST /api/agent/heartbeat)
│   ├── ActivityWorker (10s idle check + active window capture)
│   └── SyncWorker (30s → POST /api/agent/events/batch)
└── Libs
    ├── ApiClient (auth + retry + timer + events)
    ├── AgentStore (config + runtime timer state)
    └── SqliteQueue (in-memory event queue)

Server (Express.js)
├── agentRoutes.ts
│   ├── POST /api/agent/pairing/start (web auth)
│   ├── POST /api/agent/pairing/complete (no auth)
│   ├── POST /api/agent/auth/refresh (device token)
│   ├── GET  /api/agent/timer/active (agent auth)
│   ├── POST /api/agent/timer/start (agent auth)
│   ├── POST /api/agent/timer/:id/pause (agent auth)
│   ├── POST /api/agent/timer/:id/resume (agent auth)
│   ├── POST /api/agent/timer/:id/stop (agent auth)
│   ├── GET  /api/agent/projects (agent auth)
│   ├── POST /api/agent/heartbeat (agent auth)
│   ├── POST /api/agent/events/batch (agent auth)
│   └── POST /api/agent/device/revoke (web auth)
└── storage.ts (13 agent methods)

Web UI
└── /devices page (pair + list + revoke)
```

---

## Known Limitations (MVP)

- **Active window**: Placeholder (emits process.platform info). Real implementation needs native module.
- **Screenshots**: Not implemented in this MVP (stretch goal).
- **Persistence**: Agent store is in-memory (resets on restart). Production needs electron-store.
- **Event queue**: In-memory array. Production needs SQLite for crash recovery.
- **Access tokens**: In-memory map on server. Production needs JWT or Redis.
