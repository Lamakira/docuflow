# DocuFlow — User & QA Test Guide (English)

*Generated from application routes and UI labels in the codebase.*

---

## Part 1 — Short answer: "How to create new project and task?"

### Project (CRM)

1. Sidebar: **Project Management** → URL `/crm`.
2. **Projects** tab (default when the projects tab is active).
3. Click the **+** button (`data-testid="button-new-project"`) next to Kanban/Table → **New Project** page (`/crm/project/new`).
4. Fill at minimum: **Project Name \***, **Description \***, **Start Date \***, then **Create Project** (card **Project Information**).

### Task (linked to CRM project)

Two equivalent paths:

- **A.** **Time Tracking** → **Projects & Tasks** (`/time-tracking/projects`) → **Projects** column: select a project → **New task name…** + **Add**.
- **B.** After project creation, you are redirected to `/crm/project/:id`: **Tasks** card → **New task** → **Task name** → **Add**.

Tasks are always tied to a **CRM project** (`crmProjectId`).

---

## Part 2 — Full first-time user flow

### 1. Prerequisites

| Item | As implemented in code |
|------|------------------------|
| **URL** | No production URL is hardcoded: use your deployed base URL, or in dev the server from `npm run dev` (Express + Vite). |
| **Web vs desktop** | Web: browser SPA. Desktop: **DocuFlow Agent** (Electron), login screen "DocuFlow Agent". |
| **Roles** | **Administration** (`/admin`) only if `user.role === "admin"` (`AppSidebar.tsx`). "All Users" project filter on CRM is admin-only (`CrmPage.tsx`). Time Tracking **Entries** user filters depend on role (`TimeTrackingPage.tsx`). |

### 2. First login

- **Logged out**: routes `/`, `/auth`, fallback → `Landing` or `AuthPage` (`App.tsx`).
- **Landing** (`Landing.tsx`): hero, **Sign In** (header), **Get Started**, **Start for Free** → `/auth`.
- **Auth** (`AuthPage.tsx`): Clerk **Sign In** (no email/password form, no Replit button), **Back to home**.
- **Self-service signup**: **no signup form** in `AuthPage.tsx`. Server exposes `POST /api/auth/register` (`server/routes.ts`), not wired to this auth UI.
- **After login**: redirect to `/` → **Home** = **ChatBotInline** only (`Home.tsx`).
- **Main navigation** (`AppSidebar.tsx`): **Company Documents**, **Project Management**, **Documentation**, **Time Tracking**, and if admin **Administration**. Footer: sidebar toggle, notifications, chat, **Time Tracker** (clock), theme, user menu, **LogOut**.

### 3. Creating a first project (CRM)

- **Where**: **Project Management** → `/crm`.
- **Page**: title **Project Management**, subtitle "Manage your projects and contact relationships" (`CrmPage.tsx`).
- **Tabs**: **Projects** | **Contacts**.
- **Action**: **+** → `/crm/project/new`.
- **Form** (`ProjectCreatePage.tsx`): **New Project**, card **Project Information** — **Project Name \***, **Description \***, **Contact (Optional)**, **Status**, **Project Type**, **Start Date \***, **Budgeted Time** / **Actual Time** (optional).
- **Submit**: **Create Project** (Save icon). Toast **Project Created**.
- **Result**: navigate to `/crm/project/${crmProject.id}` (**CrmProjectPage**).

*Note: **Documentation** (`/documentation`) uses "folder" creation for docs (API with documentation flags) — separate from CRM **New Project**.*

### 4. Creating a first task

- **Relationship**: each task has `crmProjectId` (`TimeTrackingProjectsPage`, `CrmProjectPage`).
- **Option 1 — Time Tracking**: **Time Tracking** → **Projects & Tasks** (`TimeTrackingLayout.tsx`) → left **Projects** (list + **Search…**) → click project → right: **New task name…** + **Add**; empty state: "Select a project" / "No tasks yet. Add one above."
- **Option 2 — Project page**: on `/crm/project/:id`, **Tasks** card → **New task**, placeholder **Task name**, **Add** / cancel; helper: "No tasks yet — click \"New task\" to add one."

### 5. Starting time tracking

**Web — sidebar widget (`TimeTracker.tsx`)**

- No active entry: popover shows **Time Tracker** and **Start tracking from the desktop app** / **Open the DocuFlow Desktop Agent…** — no project/task picker or Start button in this state.
- Active entry: **Working on**, project name, **Pause** / **Resume**, **Stop**; monospace duration.
- Context exposes `handleStart` and `POST /api/time-tracking/start` (`TimeTrackerContext.tsx`), but starting from the web is not exposed in this popover when idle.

**Web — Entries page (`TimeTrackingPage.tsx`)**

- Empty list: "No time entries found" + "Start tracking time using the timer in the sidebar" — aligns with sidebar control when a session exists; see uncertainties below.

**Desktop (`ProjectTaskPicker.tsx`, `AgentLayout.tsx`)**

- Sidebar: **Timer**, **Activity**, **Screenshots**, **Settings** (`AgentSidebar.tsx`).
- **Timer**: columns **Projects** (**Search…**) and **Tasks**; click a task → `startTimer`.
- While running: **ActiveTimerHeader** — project / task lines + time (`elapsedToday`).
- **WorkedToday** bar: **Worked Today:**, **This session:**, floating pause/resume when active (`WorkedToday.tsx`).

**Picking project + task**: desktop — project list then task list; if no tasks, link **Create tasks in web app** → `${apiBase}/crm/project/${selectedProjectId}`.

### 6. Verifying activity / "worked today" / screenshots

| Area | What to test |
|------|----------------|
| **Time Tracking → Dashboard** | `/time-tracking/dashboard` — **Dashboard**, cards **Total tracked**, **Sessions**, **Avg. session**, **Screenshots**, **Activity by project** (`TimeTrackingDashboardPage.tsx`). |
| **Time Tracking → Entries** | `/time-tracking` — date filters (**Today**, …), **Time Entries**, stats **Total Time**, **Avg. Session**, **Idle Time**, **Productivity** (`TimeTrackingPage.tsx`). |
| **Time Tracking → Screencasts** | Tab only if `screencasts` feature flag is on (`TimeTrackingLayout.tsx` + `featureFlags`). |
| **Desktop → Activity** | Title **Today's Activity**, table **Project** / **Task** / **Stopped** / **Active** / **Total**, **Worked Today (widget)** line (`ActivityPage.tsx`). |

### 7. Extra sections to exercise (exact labels)

| Sidebar | Route(s) | Notable sub-areas |
|---------|----------|---------------------|
| **Company Documents** | `/company-documents`, `…/edit`, `…/view` | Title **Company Documents** (or folder name) (`CompanyDocumentsPage.tsx`). |
| **Project Management** | `/crm`, `/crm/project/new`, `/crm/project/:id`, `/crm/client/new`, `/crm/client/:id` | Tabs **Projects** / **Contacts**; **+** for new contact on Contacts. |
| **Documentation** | `/documentation`, `/project/:projectId`, `/document/:documentId` | Title **Documentation**; **Documentation folder** flow (toast "Documentation folder created") (`DocumentationPage.tsx`). |
| **Time Tracking** | `/time-tracking`, `/time-tracking/dashboard`, `/time-tracking/projects`, `/time-tracking/devices`, `/time-tracking/download`, `/time-tracking/screencasts` (flag) | Tabs **Dashboard**, **Entries**, **Projects & Tasks**, **Devices**, **Download**, **Screencasts** (conditional). |
| **Administration** (admin) | `/admin`, `/admin/create`, `/admin/user/:id`, `/admin/analytics` | Tabs **User Management**, **Modules & Fields**, **Analytics** (`AdminPage.tsx`). |

**Desktop**: **Timer**, **Activity**, **Screenshots**, **Settings**; connection badge / **Connected** dot (`AgentSidebar.tsx`).

### 8. Final user test checklist

1. Open app, **Sign In** (or account from admin / `register` API if used outside UI).
2. Confirm **Home** (inline chat) and sidebar entries.
3. **Project Management** → **Projects** → **+** → **New Project** → **Create Project**.
4. Create task: **Time Tracking** → **Projects & Tasks** **or** project page → **Tasks** → **New task** / **Add**.
5. **Desktop**: sign in to **DocuFlow Agent** → **Timer** → project → task → check **ActiveTimerHeader** + **Worked Today**.
6. **Web**: clock in sidebar → **Pause** / **Stop** if session active; otherwise desktop-only message.
7. **Time Tracking → Entries**: e.g. **Today** filter, **Time Entries** rows.
8. **Time Tracking** **Dashboard**: totals and **Activity by project**.
9. (Optional admin) **Administration**: all three tabs.
10. Smoke **Documentation** and **Company Documents**.

---

## Part 3 — Condensed checklist

- [ ] Login (`/auth` — **Sign In**).
- [ ] **Project Management** → **+** → **Create Project**.
- [ ] Task: **Projects & Tasks** or project page → **Tasks** → **New task**.
- [ ] Timer: **Desktop** → **Timer** → click task.
- [ ] Web: sidebar **Time Tracker** (pause/stop when active).
- [ ] Verify: **Time Tracking** → **Entries** (e.g. **Today**) + **Dashboard**.
- [ ] Desktop: **Activity** (**Today's Activity**) + **Worked Today** bar.
- [ ] Navigate **Documentation**, **Company Documents**, **Time Tracking** (all visible sub-tabs).

---

## Part 4 — Uncertainties / manual checks

1. **Signup**: no UI for `/api/auth/register`; document how accounts are provisioned in your environment (admin **User Management**, scripts, etc.).
2. **Starting timer from web**: `handleStart` exists in `TimeTrackerContext`, but the `TimeTracker` popover explicitly points to **desktop** when idle; confirm whether any other screen starts tracking (not found in reviewed code).
3. **Copy mismatch**: `TimeTrackingPage` empty state says "timer in the sidebar" while the idle popover says use desktop — validate with product.
4. **URL/port**: not hardcoded; record your test environment URL.
5. **`InlineTaskCreator` (desktop)**: file exists but is **not imported** elsewhere in `desktop-agent` — do not assume inline task creation without verification.
6. **Screencasts**: gated by `flags.screencasts` (`client/src/lib/featureFlags.ts` + build).

---

## Reference files (codebase)

- SPA routes: `client/src/App.tsx`
- Sidebar: `client/src/components/AppSidebar.tsx`
- CRM list + new project: `client/src/pages/CrmPage.tsx`
- Project form: `client/src/pages/ProjectCreatePage.tsx`
- Tasks on project page: `client/src/pages/CrmProjectPage.tsx` (`TasksSection`)
- Tasks/time tracking page: `client/src/pages/TimeTrackingProjectsPage.tsx`
- Time tracking sub-tabs: `client/src/components/TimeTrackingLayout.tsx`
- Web timer widget: `client/src/components/TimeTracker.tsx`, context: `client/src/contexts/TimeTrackerContext.tsx`
- Entries: `client/src/pages/TimeTrackingPage.tsx`
- Dashboard: `client/src/pages/TimeTrackingDashboardPage.tsx`
- Auth: `client/src/pages/AuthPage.tsx`; register API: `server/routes.ts`
- Desktop agent: `desktop-agent/src/renderer/app/components/timer/ProjectTaskPicker.tsx`, `ActiveTimerHeader.tsx`, `WorkedToday.tsx`, `AgentSidebar.tsx`, `ActivityPage.tsx`
- Admin: `client/src/pages/AdminPage.tsx`
