# DocuFlow — Project Context

> Self-contained technical documentation of the DocuFlow application, verified against the codebase. Intended to be passed as context to an LLM or read by a new developer. No secrets or credentials are included.

---

## 1. Purpose & Product Overview

DocuFlow is an **internal operations platform** for an agency / tech team. It started as a Notion-like documentation tool and grew into a combined system with four pillars:

1. **Project documentation** — a block-based rich text editor (TipTap) with nested pages, templates, video embeds and full-text search.
2. **CRM / project management** — clients, contacts, CRM projects with stages, tags, budgets, tasks, notes, reminders, customizable modules & fields, and daily status updates.
3. **Time tracking with employee monitoring** — a web timer plus a cross-platform Electron desktop agent that captures screenshots, keyboard/mouse activity levels, and idle time; admins review data in analytics dashboards and a screencasts page.
4. **AI-powered knowledge search** — all documentation, company documents, and video transcripts are chunked and embedded (OpenAI + pgvector); an in-app chatbot answers questions with semantic retrieval.

A companion **MCP server** exposes the app's API to Claude Desktop.

---

## 2. Tech Stack

**Frontend**
- React 18 + TypeScript, built with Vite
- `wouter` for routing, TanStack Query v5 for server state (default fetcher, staleTime Infinity)
- shadcn/ui (Radix primitives) + Tailwind CSS, dark mode via ThemeProvider (class strategy, `docuflow-theme` localStorage key)
- TipTap editor (StarterKit, CodeBlockLowlight, TaskList/TaskItem, Image, Highlight, Color, TextAlign, Underline, custom slash commands)
- `@hello-pangea/dnd` for drag-and-drop page reordering

**Backend**
- Express.js + TypeScript (Node), run with `tsx` in dev, esbuild bundle in prod
- Drizzle ORM (schema-first, types + Zod schemas generated via `drizzle-zod` in `shared/schema.ts`)
- Neon serverless PostgreSQL (`@neondatabase/serverless`, WebSocket pooling) with the **pgvector** extension
- Sessions stored in Postgres via `connect-pg-simple` (7-day TTL, httpOnly secure cookies)

**Auth**
- Email/password (passport-local style with bcrypt) — the primary mechanism
- Replit Auth (OIDC via openid-client / Passport) — also supported
- MCP API key auth: `X-API-Key` header (`MCP_API_KEY` env var) authenticates as the main admin
- Desktop agent: device token (SHA-256 hash stored) + short-lived (1h) HMAC-SHA256 JWT

**Storage & external services**
- Google Cloud Storage with a Google service account (`GCS_SERVICE_ACCOUNT_KEY`, or Application Default Credentials), V4 signed URLs for direct client transfer, and a custom ACL layer (`server/objectAcl.ts`)
- OpenAI: GPT-4.1-nano for chat, `text-embedding-3-small` (1536-dim) for embeddings
- Resend for email; Fathom API and Playwright-based scraping for video transcripts

**Desktop agent**: Electron + React, electron-forge/electron-builder packaging, better-sqlite3 offline queue, uiohook-napi for input activity.

---

## 3. Feature Areas

### 3.1 Documentation
- Projects (`projects` table) are folders containing documents (`documents` table) with a self-referential `parentId` → nested page trees, `position` for manual ordering, drag-and-drop reorder endpoint (`POST /api/projects/:projectId/documents/reorder`).
- TipTap JSON content stored in a JSONB `content` column. Auto-save with debounced updates.
- Block editor supports slash commands, resizable images, file attachments (`PUT /api/document-attachments`, `PUT /api/document-images`), audio recordings (`POST /api/audio/upload`, `GET /api/audio/:id`), and video embeds (YouTube, Loom, Fathom).
- **Automatic transcript extraction**: when a Loom/Fathom video is embedded, a `video_transcripts` row is created and processed in the background (Fathom via API with browser fallback; Loom via Playwright scraping). Completed transcripts are chunked and embedded into `document_embeddings` so the AI assistant can answer questions about video content. Removing a video deletes its transcript and embeddings. Retry endpoint: `POST /api/transcripts/:id/retry`. A `TranscriptStatusBanner` shows progress.
- Page templates (Client Project, Technical Solution), document duplication (`POST /api/documents/:id/duplicate`), full-text search (`GET /api/search`), recent documents (`GET /api/documents/recent`).
- Note: direct creation/deletion of documentation projects is deprecated in favor of the CRM (`documentationEnabled` flag on CRM projects; `GET /api/projects/documentable`).

### 3.2 CRM
- **Clients & contacts**: `crm_clients` (companies/leads with status & source), `crm_contacts` (people under a client).
- **CRM projects** (`crm_projects`): linked 1:1 to a documentation `projects` row, with stage/status, project type, budgeted & actual hours/minutes, dates, review fields, and a `documentationEnabled` toggle. Stage changes recorded in `crm_project_stage_history`. Kanban view (`GET /api/crm/projects/all-kanban`), clone endpoint.
- **Tags**: `crm_tags` + `crm_project_tags` junction (colored labels, Zoho-style).
- **Assignment**: many-to-many via `project_members` (unique on project+user). The old `assigneeId` column on `crm_projects` is **legacy/deprecated** — kept for backward compatibility, not surfaced in the UI. Members can add/remove themselves (`/members/me`).
- **Custom modules & fields**: `crm_modules` (system modules cannot be deleted), `crm_module_fields` with **12 field types** (text, number, date, datetime, select, multiselect, checkbox, textarea, email, phone, url, currency; options array for selects), values per project in `crm_custom_field_values` (unique project+field). Admin CRUD under `/api/admin/modules`.
- **Tasks** (`tasks`): work units within CRM projects, statuses open / in_progress / done / archived. Used by the time tracker (see below).
- **Notes** (`crm_project_notes`): rich notes with @mentions (`mentionedUserIds`), audio notes with transcription status, and JSON file attachments. Mentions generate `notifications`.
- **Reminders** (`reminders`): self-only follow-ups tied to a project (optionally a task), with due date, in-app and email notification flags. DB-backed dedup flags (`notified`, `notifiedInApp`, `emailSent`) prevent re-firing after server restarts.
- **Daily updates** (`project_daily_updates`): each user submits one update per project per day (unique index project+user+date) with status (on_track, in_progress, in_review, blocked_client, blocked_internal, completed), what happened / was done / next steps, blockage type, and client-related flags. Admin dashboard with KPIs (`/api/admin/daily-updates`, `/kpis`, `/today-status`).

### 3.3 Time Tracking (web)
- `TimeTrackerContext` (client/src/contexts/TimeTrackerContext.tsx) is the single global source of truth: active entry polling (10s), display duration ticking, start/pause/resume/stop mutations.
- **Multi-tab coordination**: a `MultiTabCoordinator` elects one tab as leader; only the leader runs the 60s heartbeat (`POST /api/time-tracking/:id/activity`) and screenshot scheduling; followers receive duration via broadcast.
- **Task requirement**: `GET /api/time-tracking/capabilities` returns `requiresTask` (true when the tasks migration is applied — see `server/migrationFlags.ts`); the UI then requires a task selection before starting a timer.
- Web screen capture is optional (`ScreenCaptureWebService`, getDisplayMedia-based, random intervals, presigned upload).
- Idle handling in web: if the tab is hidden ≥ 3 minutes while running, the timer auto-pauses on return.
- Pages: entries list, Projects & Tasks management, Devices (agent device list + revocation), Download page (installers), admin Dashboard, and **Screencasts** — an admin review page for screenshots with timezone selector (admin-curated `allowedTimezones` in org settings), activity percentages, and soft-delete of screenshots.
- Screenshots are **soft-deleted** (tombstone: `deletedAt`, `deletedBy`, `deleteReason`); GCS objects are not removed by the API.
- Admin analytics (`/api/admin/analytics/*`): overview, activity, productivity, coverage, data-quality, devices, alerts, screenshots, CSV export, and an **evidence quality score** (0–100 per user: coverage 40 + quality 30 + events 20 + device 10; grades strong/moderate/weak/insufficient). The score never modifies tracked time.

### 3.4 Desktop Agent (`desktop-agent/`)
- Electron app (current version **0.1.10** in package.json; latest published release per docs is v0.1.8 — see `docs/DESKTOP_RELEASE.md`). Main process (`src/main/index.ts`), React renderer (`src/renderer/app`), floating widget window (`widget.tsx`).
- **Workers** (`src/workers/`): `HeartbeatWorker` (periodic heartbeat, receives timerSync + screenshotPolicy from server), `ActivityWorker` (keyboard/mouse activity via uiohook-napi; Linux idle detection and screen-lock watching helpers in `src/lib/`), `ScreenCaptureWorker` (random 3–5 min intervals per org policy), `SyncWorker` (drains the offline queue).
- **Offline-first**: events and timer commands queue in SQLite (`SqliteQueue`); timer commands carry a `clientCommandId` idempotency key (unique column on `time_entries`); event batches are deduplicated server-side via `agent_processed_batches`.
- **Auth flow**: `POST /api/agent/auth/login` (email/password) creates a `devices` row, returns a raw device token (only its SHA-256 hash is stored) plus a 1-hour HMAC-SHA256 JWT; `POST /api/agent/auth/refresh` renews the JWT. The older pairing-code flow (`/api/agent/pairing/*`) returns **410 Gone** (deprecated). Heartbeat checks revocation; devices can be revoked from the web Devices page.
- **Screenshot flow**: `POST /api/agent/screenshots/presign` → direct GCS upload → `POST /api/agent/screenshots/confirm` (records activity percentages and counts in `time_entry_screenshots`).
- **Screenshot policy** is org-wide (`org_settings.screenshotPolicy`): enable flag, capture interval min/max (3–15 min), optional active-hours window, idle prompt settings (timeout 1–60 min, countdown 15–120 s).
- **Packaging**: electron-forge/electron-builder → Windows NSIS `.exe`, macOS `.dmg` (notarized), Linux `.deb`. Installers are uploaded to Google Cloud Storage (bucket named by `INSTALLER_GCS_BUCKET`) and registered in `desktop_releases` (one `isLatest` row per platform). `GET /api/downloads/desktop/latest` / `versions` serve stable URLs. CI registration endpoint: `POST /api/internal/desktop-releases`. Full release procedure: `docs/DESKTOP_RELEASE.md` (uploads need the storage service account, from any environment that holds it).
- Linux quirks: Wayland requires a screen-share permission each session (XDG portal); X11 does not. Documented in replit.md.

### 3.5 AI Assistant & Embedding Pipeline
- ChatBot component calls `POST /api/chat` with a scope (project documentation, company documents, or both).
- **Ingestion** (`server/embeddings.ts`, `server/contentExtraction.ts`):
  - TipTap JSON is flattened to text; uploaded files are extracted (PDF via pdf-parse, Word via mammoth, plain text directly).
  - Text is chunked into ~800-character segments with 100 overlap.
  - Each chunk gets a content hash; unchanged chunks are skipped on re-index.
  - Embeddings via OpenAI `text-embedding-3-small` (1536 dims), stored in `document_embeddings` (project docs + video transcripts) and `company_document_embeddings` (company docs).
- **Retrieval**: pgvector cosine similarity over the relevant embedding table(s); retrieved chunks (with metadata: title, project name, breadcrumbs, video provider) are injected into the GPT-4.1-nano prompt.
- Admin can rebuild all embeddings: `POST /api/embeddings/rebuild`.

### 3.6 Company Documents
- Folder organization (`company_document_folders`), grid/list views, search (`GET /api/company-documents/search`).
- Two kinds of documents: uploaded files (stored in GCS via `POST /api/company-documents/upload-url`; streaming/download/word-to-HTML endpoints) and in-app text documents (TipTap JSONB `content`, edited in `CompanyDocumentEditorPage`).
- All company documents are automatically extracted and embedded into `company_document_embeddings` for AI search.

### 3.7 MCP Server (`mcp-server/index.ts`)
- Single-file MCP server, STDIO transport, for Claude Desktop. Calls the DocuFlow REST API with `X-API-Key` (authenticates as the main admin).
- **22 tools**: list_projects, get_project, list_documents, get_document, create_document, update_document, delete_document, list_recent_documents, search, list_clients, get_client, create_client, list_crm_projects, get_crm_project, list_time_entries, get_time_tracking_stats, start_time_tracking, stop_time_tracking, get_active_time_entry, ask_ai, list_users, get_notifications.
- Build: `npx tsc --project mcp-server/tsconfig.json` → `mcp-server/build/index.js`. Config env vars: `DOCUFLOW_API_URL`, `DOCUFLOW_API_KEY`.

### 3.8 Help Center
- In-app help hub (`/help-center`) and article viewer (`/help-center/:slug`), articles registered in `client/src/pages/help-center/articleRegistry.tsx`. Article screenshots are admin-uploaded to public object storage and mapped by slot id in `org_settings.helpCenterScreenshots` (`GET /api/help-center/screenshot-map`).

---

## 4. Database Schema (all tables)

All tables use UUID string PKs (`gen_random_uuid()`), Drizzle ORM definitions in `shared/schema.ts` (~1,500 lines). Boolean-ish flags are often `integer` 0/1 (historical convention).

| Table | Purpose / key fields |
|---|---|
| `sessions` | connect-pg-simple session store (sid, sess JSONB, expire indexed). |
| `users` | email (unique) + bcrypt `password`, firstName/lastName, profileImageUrl, `role` (admin/user), `isMainAdmin` (0/1), `canViewDailyUpdates` (0/1), `hoursPerDay` (default 8), `lastGeneratedPassword`, `lastLoginAt`, `isArchived` (boolean). |
| `projects` | Documentation folders: name, description, icon, ownerId → users (cascade). |
| `documents` | Nested pages: title, TipTap JSONB `content`, icon, coverImage, projectId, self-referential `parentId`, `position`, createdById. |
| `document_embeddings` | pgvector chunks for project docs & video transcripts: documentId/projectId/ownerId, chunkIndex, chunkText, contentHash, 1536-dim embedding, metadata (title, projectName, breadcrumbs, transcript info). |
| `video_transcripts` | Video embeds: videoUrl/videoId, provider (loom/fathom), documentId/projectId/ownerId, status (pending/processing/completed/error), transcript text, errorMessage. |
| `audio_recordings` | Audio files recorded in the editor / project notes. |
| `crm_clients` | Companies/leads: contact info, status, source. |
| `crm_contacts` | People under a client. |
| `crm_projects` | CRM layer over a documentation project: stage/status, projectType, budgeted/actual hours+minutes, dates, `documentationEnabled`, review fields, legacy `assigneeId`. |
| `crm_project_stage_history` | Audit log of stage changes. |
| `crm_tags` / `crm_project_tags` | Colored tags + project↔tag junction. |
| `crm_project_notes` | Notes with mentions (`mentionedUserIds` array), audio (url/transcript/status), JSON attachments. |
| `crm_modules` | Customizable modules: slug (unique), icon, isSystem, isEnabled, displayOrder. |
| `crm_module_fields` | Custom fields per module: slug, fieldType (12 types), options JSONB, isRequired/isSystem/isEnabled, displayOrder. |
| `crm_custom_field_values` | Value per (crmProjectId, fieldId). |
| `tasks` | Work units in CRM projects: status open/in_progress/done/archived. |
| `project_members` | Many-to-many project assignment (unique project+user) — the authoritative assignment mechanism. |
| `reminders` | Self-only reminders: dueAt, status, dedup flags notified/notifiedInApp/emailSent. |
| `notifications` | Mentions & system notifications: type, noteId, crmProjectId, fromUserId, isRead. |
| `teams` / `team_members` / `team_invites` | Team grouping with roles (owner/admin/member) and invite codes (expiry, maxUses, useCount). |
| `company_document_folders` | Folders for company docs. |
| `company_documents` | Company files/text docs: JSONB content or GCS file (fileName, fileSize, mimeType, storagePath), folderId, uploadedById. |
| `company_document_embeddings` | pgvector chunks for company docs (mirrors document_embeddings). |
| `time_entries` | Timer sessions: userId, crmProjectId, nullable taskId, startTime/endTime, `duration` (seconds, idle excluded), `idleTime`, status running/paused/stopped, lastActivityAt, unique `clientCommandId` (agent idempotency). |
| `time_entry_screenshots` | Screenshot metadata: storageKey (GCS), contentHash, keyboard/mouse activity percent & raw counts (60s window), capturedAt, soft-delete tombstone (deletedAt/deletedBy/deleteReason). |
| `devices` | Desktop agent devices: name, os, clientVersion, `deviceTokenHash` (SHA-256, raw never stored), lastSeenAt, revokedAt. |
| `agent_pairing_codes` | Legacy pairing codes (flow deprecated; endpoints return 410). |
| `agent_processed_batches` | Idempotency ledger for agent event batches. |
| `agent_activity_events` | Raw agent events: deviceId/userId/timeEntryId, batchId, eventType, timestamp, JSONB data. |
| `org_settings` | Single row (id="default"): `screenshotPolicy` JSONB, `allowedTimezones`, `helpCenterScreenshots`. |
| `desktop_releases` | Installer registry: version, platform (windows/macos/linux), filename, storageUrl, fileSize, sha256, `isLatest` (one per platform). |
| `project_daily_updates` | Daily status per (project, user, date) unique: status, whatHappened/whatWasDone/nextSteps, blockageType, client flags. |

---

## 5. API Route Groups (Express, `server/`)

All app routes require session auth (`isAuthenticated`) unless noted. Files: `server/routes.ts` (~5,000 lines, main API), `server/agentRoutes.ts` (desktop agent), `server/downloadRoutes.ts` (installers), `server/auth.ts` (auth setup).

- **Auth**: `POST /api/auth/register`, `/login`, `/logout`, `GET /api/auth/user`. Replit OIDC also mounted. MCP requests use `X-API-Key`.
- **Documentation**: `GET/POST/PATCH/DELETE /api/projects...`, `/api/projects/:projectId/documents` (+ `/reorder`), `/api/documents/:id` (+ `/ancestors`, `/duplicate`, `/sync-transcripts`, `/transcripts`), `GET /api/documents/recent`, `GET /api/search`, `GET /api/projects/documentable`. (Direct project create/delete deprecated → managed via CRM.)
- **CRM**: `/api/crm/clients` (+ `/:clientId/contacts`), `/api/crm/contacts/:id`, `/api/crm/projects` (+ `:id`, `/all-kanban`, `/by-project/:projectId`, `/clone`, `/members`, `/members/me`, `/notes`, `/reminders`, `/stage-history`, `/tags`, `/documentation`), `/api/crm/tags`, `/api/tasks`, `/api/reminders/:id`.
- **Daily updates**: `GET/POST /api/daily-updates`, `PATCH/DELETE /api/daily-updates/:id`; admin: `GET /api/admin/daily-updates` (+ `/kpis`, `/today-status`).
- **Time tracking**: `POST /api/time-tracking/start`, `/:id/pause|resume|stop|activity`, `GET /active`, `/entries`, `/stats`, `/capabilities`, `/project/:crmProjectId`, `PATCH|DELETE /:id`; screenshots: `GET /screenshots`, `/screenshots/:id/image`, `POST /screenshots`, `/screenshots/upload-url`, soft `DELETE /screenshots/:id`.
- **Admin**: `/api/admin/users` (CRUD, `/reset-password`, `/role`, `/archive`), `/api/admin/modules` & `/fields`, `/api/admin/org-settings`, `/api/admin/analytics/*` (overview, activity, productivity, coverage, data-quality, devices, alerts, screenshots, evidence-quality, export).
- **Agent** (`/api/agent/*`, device-token/JWT auth): `auth/login`, `auth/refresh`, `heartbeat`, `events/batch`, `screenshots/presign|confirm`, `timer/start|:id/pause|resume|stop`, `timer/active`, `projects`, `tasks`, `devices`, `device/revoke`, `devices/revoke-machine`, `capabilities`, `ping`, `worked-today`, `today-breakdown`; `pairing/start|complete` → 410 Gone.
- **AI & embeddings**: `POST /api/chat`, `POST /api/embeddings/rebuild`, `POST /api/transcripts/:id/retry`.
- **Company documents**: `/api/company-documents` CRUD + `search`, `upload-url`, `:id/download|stream|word-html`; `/api/company-document-folders` CRUD.
- **Teams**: `/api/teams` CRUD, `/:id/members`, `/:id/invites`, `GET /api/invite/:code`, `POST /api/invite/:code/join`.
- **Notifications**: `GET /api/notifications` (+ `/unread-count`), `PATCH /:id/read`, `/mark-all-read`.
- **Object storage relay**: `POST /api/objects/upload`, `/upload-public`, `PUT /api/document-images`, `/api/document-attachments`, `GET /objects/:objectPath(*)` (ACL-checked), `GET /public-objects/:filePath(*)`, `POST /api/audio/upload`, `GET /api/audio/:id`.
- **Downloads**: `GET /api/downloads/desktop/latest`, `/versions`, `GET /downloads/availability`, `POST /api/internal/desktop-releases` (CI).
- **Misc**: `GET /api/ping`, `GET /api/users`, `GET /api/screencasts/timezones`, `GET /api/help-center/screenshot-map`, `GET /api/modules/:slug/fields`.

---

## 6. Frontend Structure

**Routing / auth flow** (`client/src/App.tsx`): unauthenticated users see `Landing` (`/`) and `AuthPage` (`/auth`). Authenticated users get `AuthenticatedLayout`: `TimeTrackerProvider` → `SidebarProvider` (shadcn sidebar, 13rem) → `AppSidebar` + mobile header with `TimeTracker` widget.

**Pages** (`client/src/pages/`):
- `Landing` — public marketing/login entry. `AuthPage` — login/register.
- `Home` — dashboard after login.
- `CrmPage` — CRM list/kanban of projects & clients. `CrmProjectPage` — single CRM project (details, members, notes, tasks, reminders, custom fields). `ProjectCreatePage` — new CRM project. `ClientDetailPage` — client + contacts. `ContactCreatePage` — new client/contact.
- `DocumentationPage` — documentation hub. `ProjectPage` — a documentation project's page tree. `DocumentPage` — TipTap editor for a page.
- `CompanyDocumentsPage` — folders/grid/list + upload. `CompanyDocumentEditorPage` — text document editor. `FileViewerPage` — file preview.
- `DailyUpdatePage` — daily update submission form. `DailyUpdatesAdminPage` — admin review dashboard.
- `AdminPage` — user management (create/edit/reset password/archive; routes `/admin`, `/admin/create`, `/admin/user/:id`). `AdminAnalyticsPage` — monitoring analytics.
- `TimeTrackingPage` — entries list. `TimeTrackingProjectsPage` — projects & tasks. `DevicesPage` — agent devices (also at `/devices`). `TimeTrackingDownloadPage` — installer downloads. `TimeTrackingDashboardPage` — admin dashboard. `ScreencastsPage` — screenshot review.
- `help-center/HelpCenterHubPage` & `HelpCenterArticlePage` — help articles.
- `not-found` — 404.

**Key components**: BlockEditor (TipTap wrapper), ChatBot (AI assistant), TimeTracker (timer widget), AppSidebar, TranscriptStatusBanner. Key libs: `MultiTabCoordinator`, `ScreenCaptureWebService` (`client/src/lib/`).

---

## 7. Roles & Permissions

- `role`: `user` or `admin`. Admins access `/api/admin/*`, user management, org settings, analytics, screencasts, module/field configuration.
- `isMainAdmin` (0/1): the main admin cannot be edited, deleted, password-reset, or role-changed by other admins. The MCP API key authenticates as this user.
- `canViewDailyUpdates` (0/1): grants non-admins access to the daily updates admin view.
- `isArchived`: soft-deactivated users (archive endpoint instead of hard delete).
- Device security: raw device tokens are never stored (SHA-256 hash only); JWTs are HMAC-SHA256, 1-hour expiry with refresh; heartbeat enforces revocation; screenshots use presigned GCS uploads and admin-only soft delete with audit fields.

---

## 8. Conventions & Gotchas

- **Schema-first**: all types flow from `shared/schema.ts` via Drizzle + drizzle-zod (`createInsertSchema().omit(...)`, `$inferSelect`). Client-facing user type is `SafeUser` (password omitted).
- **Integer booleans**: many flags are `integer` 0/1 (isMainAdmin, isRead, isSystem, …); newer columns use real booleans (isArchived, waitingOnClient). `team_invites.isActive` is a varchar "true"/"false".
- **TanStack Query**: default fetcher keyed by URL, `staleTime: Infinity`, hierarchical array query keys, `apiRequest` for mutations + explicit invalidation.
- **Migration flags** (`server/migrationFlags.ts`): the server probes at startup whether the `tasks` table / `time_entries.task_id` exist and toggles task-requirement behavior (`/api/time-tracking/capabilities`) accordingly — dev/staging/prod schemas can lag each other.
- **Deprecations to be aware of**: `crm_projects.assigneeId` (use `project_members`), agent pairing-code flow (410 Gone; use email/password login), direct documentation-project create/delete (managed through CRM).
- **New routes need a server restart** in dev — Vite's catch-all otherwise returns HTML with status 200, masking a missing API route as "success".
- **Idempotency**: agent timer commands via `clientCommandId`; event batches via `agent_processed_batches`; scheduled jobs (reminders, daily-update emails) use DB-backed per-recipient dedup, never in-memory guards.
- **Embeddings**: content-hash chunk skipping; any content change re-embeds only changed chunks; `POST /api/embeddings/rebuild` for full rebuilds.
- **Dev credentials**: test accounts are listed in `replit.md` (do not copy into other docs; dev-only).
- **Desktop releases**: procedure in `docs/DESKTOP_RELEASE.md`; uploads need the storage service account (`INSTALLER_GCS_BUCKET` + `GCS_SERVICE_ACCOUNT_KEY`); registry in `desktop_releases`, latest published v0.1.8, codebase at 0.1.10.
- **Platform-managed files**: `server/vite.ts` and `vite.config.ts` still come from the Replit template — leave them until the container work (#25) removes the premise. `package.json` and `drizzle.config.ts` no longer do: the test runner (#27) and the `--env-file-if-exists=.env` flags on `dev`/`start` are edits this repository makes on purpose.
- **Env vars**: all read in `server/config.ts` and nowhere else; every one documented in `.env.example` — the register of record — and `docs/CONFIGURATION.md`. Required to boot: database (`DATABASE_URL` or `PG*`), `SESSION_SECRET`, `JWT_SECRET` (written as `<key-id>:<secret>`, #23 — no generated fallback), `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, and a storage credential (`GCS_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`).
