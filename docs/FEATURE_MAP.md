# DocuFlow — Feature Map

> **Purpose:** Avoid wasting time searching for features in the wrong place.
> For each feature: primary location, secondary location, flow, dependencies.

---

## Task Management

| | |
|---|---|
| **Primary location** | Time Tracker (sidebar popover) — select project → task dropdown → "New task" |
| **Secondary location** | CRM Project Page → Tasks card → "New task" button |
| **Desktop** | Task selector in Desktop Agent timer UI (read-only — no creation) |
| **API** | `GET /api/tasks?crmProjectId=` · `POST /api/tasks` · `DELETE /api/tasks/:id` |
| **Gate** | `isTasksEnabled()` — requires `tasks` table + `task_id` column on `time_entries` |
| **Flow** | Select project → tasks load → select or create task → start timer |
| **Desktop flow** | Create on web first → appears in desktop dropdown |

**Where to verify:**
- Web: Time Tracker → select any project → task dropdown → "+ New task"
- Web: `/crm/project/:id` → Tasks card
- Desktop: Start Tracking → select project → task dropdown

---

## Time Tracking

| | |
|---|---|
| **Primary location** | Time Tracker button (top-right / sidebar) — expands as popover |
| **Secondary location** | Time Tracking page (`/time-tracking`) — history and stats |
| **Desktop** | Desktop Agent main screen — full timer UI |
| **API** | `POST /api/time-tracking/start` · `/pause` · `/resume` · `/stop` · `/activity` |
| **Flow** | Select project → select task → (optional) description → Start Tracking |
| **Source of truth** | Backend — desktop and web both sync from server state |

**Where to verify:**
- Web: click Clock icon in header/sidebar
- Desktop: main window, timer display

---

## Device Management

| | |
|---|---|
| **Primary location** | Devices page (`/devices`) |
| **Secondary location** | None |
| **Desktop** | Connection card at the bottom of the Desktop Agent window |
| **API** | `GET /api/devices` · `DELETE /api/devices/:id` (revoke) |
| **Flow** | Install Desktop Agent → sign in with DocuFlow account → device appears in list |

**Where to verify:**
- `/devices` → "Your Devices" list
- Desktop: CONNECTION section → shows email + server host

---

## Desktop Agent Auth (Login / Sign-out)

| | |
|---|---|
| **Primary location** | Desktop Agent login screen (shown when not signed in) |
| **Sign-out** | Desktop Agent → Connection card → "Sign out" |
| **Revoke from web** | Devices page → trash icon → confirm |
| **API** | `POST /api/agent/auth/login` · `POST /api/agent/auth/refresh` |
| **Session persistence** | `agent-config.json` in `app.getPath("userData")` |

---

## Screenshots / Screen Capture

| | |
|---|---|
| **Primary location** | Time Tracker popover → "Share Screen" toggle (web) |
| **Desktop** | Automatic while timer is running (background worker) |
| **Review** | Time Tracking page → entry detail → Screenshots tab |
| **API** | `POST /api/agent/screenshots/presign` · `PUT /api/agent/screenshots/upload/:id` · `POST /api/agent/screenshots/confirm` |
| **Gate** | Timer must be `running`, device must be valid and non-revoked |

---

## CRM / Project Management

| | |
|---|---|
| **Primary location** | Project Management (`/crm`) — list all CRM projects |
| **Detail** | `/crm/project/:id` — full project page |
| **Create** | `/crm/project/new` |
| **Fields** | Status, type, assignee, client, dates, budgeted hours, custom fields, notes, stage history, tasks, time tracking summary |

---

## Company Documents

| | |
|---|---|
| **Primary location** | Company Documents (`/`) |
| **Secondary** | Project documentation toggle within CRM project |

---

## User / Account

| | |
|---|---|
| **Auth** | Clerk (web, since #110) · Email + password (desktop, on the same `users.password` an admin reset writes) |
| **Profile** | Bottom-left sidebar avatar |
| **Admin** | `/admin` — user management, roles |

---

## Feature Duplication Summary

| Feature | Location A | Location B | Notes |
|---------|-----------|-----------|-------|
| Task creation | Time Tracker popover | CRM Project Page | Both work independently |
| Time tracking controls | Time Tracker popover | Desktop Agent | Desktop syncs from server |
| Screen capture toggle | Time Tracker popover | Desktop Agent (auto) | Desktop captures automatically |
| Device sign-out | Desktop Agent UI | Devices page (revoke) | Web revoke stops desktop too |
