# Current DocuFlow backend and migration constraints

Research for [“Inventory the current DocuFlow backend and migration constraints”](https://github.com/Lamakira/docuflow/issues/5), completed 2026-08-05 from repository source code, schema, migrations, and first-party project documentation.

## Executive summary

The current backend is a single Node.js/Express deployable that serves both a React SPA and a large REST API. It uses one PostgreSQL database through Drizzle, PostgreSQL-backed web sessions, Google Cloud Storage reached through Replit's sidecar credentials, OpenAI for embeddings/chat/audio transcription, Resend through a Replit connector, and several `setInterval` jobs inside the web process. The desktop agent is a separate Electron client but uses the same backend, with its own bearer-token routes and a durable local JSON queue. Sources: [package.json](../../package.json#L1), [server/index.ts](../../server/index.ts#L1), [server/db.ts](../../server/db.ts#L1), [server/objectStorage.ts](../../server/objectStorage.ts#L1), [server/routes.ts](../../server/routes.ts#L1), [desktop-agent/src/lib/SqliteQueue.ts](../../desktop-agent/src/lib/SqliteQueue.ts#L1).

The code is not multi-Workspace today. Operational records are variously owned by a `userId`, an `ownerId`, a Project, or nothing tenant-like at all; many core queries deliberately return all company records to every authenticated user. Teams exist, but they are collaboration groups rather than the ownership, policy, subscription, and isolation boundary defined for the future Workspace model. Sources: [shared/schema.ts](../../shared/schema.ts#L34), [shared/schema.ts](../../shared/schema.ts#L64), [shared/schema.ts](../../shared/schema.ts#L332), [shared/schema.ts](../../shared/schema.ts#L666), [server/storage.ts](../../server/storage.ts#L486), [server/routes.ts](../../server/routes.ts#L268), [ADR-0004](../adr/0004-use-one-workspace-model-for-individuals-and-organizations.md).

Therefore the safest evolution is not a new UI over unchanged persistence. The migration needs an explicit Workspace seam, staged backfills and invariant checks, Workspace-scoped authorization at the API and query layers, compatibility for existing web and desktop contracts, and durable replacements for process-local jobs before horizontally scaling. Existing IDs and API behavior should be retained through compatibility layers while records are assigned to an initial Workspace and domain concepts are separated incrementally.

## 1. Current runtime topology

### Application process

- `server/index.ts` constructs one Express app and HTTP server, installs Helmet and IP-based rate limits, registers all routes, serves Vite in development or the built SPA in production, and listens on one `PORT` (default `5000`). The API and web client therefore share one origin and one release unit. Sources: [server/index.ts](../../server/index.ts#L1), [server/index.ts](../../server/index.ts#L21), [server/index.ts](../../server/index.ts#L265).
- Production builds run Vite for the client and esbuild the server entry point into `dist/index.cjs`; `npm start` runs that bundle. Sources: [script/build.ts](../../script/build.ts#L1), [package.json](../../package.json#L6).
- `server/routes.ts` is the main application composition root and route module. It registers desktop-agent and installer routes, then directly defines the rest of the API. `server/storage.ts` is a single `IStorage`/`DatabaseStorage` data-access module. Sources: [server/routes.ts](../../server/routes.ts#L1), [server/routes.ts](../../server/routes.ts#L96), [server/storage.ts](../../server/storage.ts#L112), [server/storage.ts](../../server/storage.ts#L417).
- There is no automated test suite exposed by the root scripts; the root scripts provide build, TypeScript checking, database push, and release helpers. Source: [package.json](../../package.json#L6).

### Database

- The only server-side system of record is PostgreSQL. `DATABASE_URL` wins over assembled `PG*` variables, and the same resolved connection feeds Drizzle and the PostgreSQL session store. Sources: [server/dbConfig.ts](../../server/dbConfig.ts#L1), [server/db.ts](../../server/db.ts#L1), [server/auth.ts](../../server/auth.ts#L25), [docs/DB_ENV_SETUP.md](../DB_ENV_SETUP.md).
- The runtime uses `@neondatabase/serverless` with WebSockets and Drizzle. The repository describes Neon/Replit as the present production arrangement, but nothing in the data-access API inherently requires domain code to know the provider. Sources: [server/db.ts](../../server/db.ts#L1), [replit.md](../../replit.md#L65).
- Drizzle schema covers sessions, users, Projects/Documents, embeddings/transcripts/audio, CRM clients/contacts/projects/stages/tags/notes/custom fields, Workspace-precursor company documents and teams, tasks/project members/reminders, time/activity/screenshots/devices, one global org-settings row, desktop releases, notifications, and project daily updates. Source: [shared/schema.ts](../../shared/schema.ts).

### External services

- Private and public binary objects use Google Cloud Storage. Credentials are obtained through a Replit sidecar endpoint, while bucket/object roots come from `PUBLIC_OBJECT_SEARCH_PATHS` and `PRIVATE_OBJECT_DIR`. Signed upload URLs and object ACL metadata are handled in-process. Source: [server/objectStorage.ts](../../server/objectStorage.ts#L1).
- OpenAI is called directly from routes and embedding helpers. Current uses include `text-embedding-3-small`, chat, and audio transcription. API-key absence is handled at call time, not behind a provider-neutral gateway. Sources: [server/embeddings.ts](../../server/embeddings.ts#L1), [server/embeddings.ts](../../server/embeddings.ts#L100), [server/routes.ts](../../server/routes.ts#L47), [server/routes.ts](../../server/routes.ts#L780), [server/routes.ts](../../server/routes.ts#L1053).
- Loom transcripts are browser-extracted; Fathom uses its API when configured and otherwise browser extraction. This introduces Playwright/browser-runtime and third-party page-shape dependencies into the server. Source: [server/transcripts.ts](../../server/transcripts.ts#L1).
- Email is sent with Resend, with credentials obtained from Replit connector APIs. Source: [server/email.ts](../../server/email.ts#L1).
- Desktop installers are recorded in PostgreSQL and point at GCS URLs; an internal CI-token endpoint publishes releases. Sources: [shared/schema.ts](../../shared/schema.ts#L1358), [server/downloadRoutes.ts](../../server/downloadRoutes.ts#L555).

## 2. Authentication and authorization paths

### Web and internal API

- Web users can authenticate with local email/password routes or Replit OIDC. Both converge on an Express session whose data is stored in PostgreSQL for seven days. Sources: [server/routes.ts](../../server/routes.ts#L147), [server/routes.ts](../../server/routes.ts#L191), [server/auth.ts](../../server/auth.ts#L14), [server/auth.ts](../../server/auth.ts#L25).
- `isAuthenticated` accepts a local session `userId`, an OIDC Passport identity, or an `x-api-key` matching the single `MCP_API_KEY`; that API key impersonates the main administrator by mutating the request session. Source: [server/auth.ts](../../server/auth.ts#L188).
- Workspace capabilities do not exist. Global `users.role` is `admin | user`, with special integer flags such as `isMainAdmin` and `canViewDailyUpdates`; route-local middleware and ad hoc ownership checks enforce access. Sources: [shared/schema.ts](../../shared/schema.ts#L29), [shared/schema.ts](../../shared/schema.ts#L34), [server/routes.ts](../../server/routes.ts#L3031).
- Authorization semantics differ by resource. Teams check membership/owner roles, time entries are self-only for members and globally visible to admins, while Projects, Project Documents, Clients, and CRM Projects intentionally use “company-wide” authenticated visibility and mutation. Sources: [server/routes.ts](../../server/routes.ts#L244), [server/routes.ts](../../server/routes.ts#L268), [server/routes.ts](../../server/routes.ts#L296), [server/routes.ts](../../server/routes.ts#L333), [server/routes.ts](../../server/routes.ts#L1330), [server/routes.ts](../../server/routes.ts#L1366), [server/routes.ts](../../server/routes.ts#L2669), [server/routes.ts](../../server/routes.ts#L4164).

### Desktop agent

- The active desktop login is email/password. Each login creates a new device with a hashed long-lived device token and returns a one-hour, HMAC-SHA256 access token. Refresh exchanges the device ID and raw device token; bearer middleware also checks current device revocation. Pairing endpoints remain present but return `410 Gone`. Sources: [server/agentRoutes.ts](../../server/agentRoutes.ts#L28), [server/agentRoutes.ts](../../server/agentRoutes.ts#L59), [server/agentRoutes.ts](../../server/agentRoutes.ts#L119), [server/agentRoutes.ts](../../server/agentRoutes.ts#L253), [server/agentRoutes.ts](../../server/agentRoutes.ts#L274), [server/agentRoutes.ts](../../server/agentRoutes.ts#L328).
- If `JWT_SECRET` is absent, the server generates an ephemeral secret at process start. Existing access tokens then become invalid after every restart or across multiple replicas. Source: [server/agentRoutes.ts](../../server/agentRoutes.ts#L59).
- The checked-in V1 protocol still documents pairing as active and a 90-day token, while the implementation has removed pairing and does not persist an explicit device-token expiry. This documentation/contract drift is itself a compatibility risk. Sources: [docs/agent-protocol.md](../agent-protocol.md#L35), [server/agentRoutes.ts](../../server/agentRoutes.ts#L253), [shared/schema.ts](../../shared/schema.ts#L1235).

## 3. Current domain/data ownership

### Work and knowledge

- The legacy `projects` row is an owner-scoped documentation container. A `crm_projects` row points one-to-one in practice to that Project and combines sales and delivery fields/statuses. Existing Projects without CRM rows are automatically linked at process startup and marked `documented`. Sources: [shared/schema.ts](../../shared/schema.ts#L64), [shared/schema.ts](../../shared/schema.ts#L402), [server/storage.ts](../../server/storage.ts#L1367), [ADR-0001](../adr/0001-separate-opportunities-from-projects.md).
- Project Documents are native TipTap JSON pages nested by `parentId`. Embeddings and video transcripts carry Project and owner identifiers. Sources: [shared/schema.ts](../../shared/schema.ts#L93), [shared/schema.ts](../../shared/schema.ts#L159), [shared/schema.ts](../../shared/schema.ts#L200).
- “Company Documents” are a separate pair of folder/document tables. A record stores either native JSON content or uploaded-file metadata/storage path, and a second embedding table indexes extracted content. They are globally queried rather than scoped by a team or owner. Sources: [shared/schema.ts](../../shared/schema.ts#L552), [shared/schema.ts](../../shared/schema.ts#L586), [shared/schema.ts](../../shared/schema.ts#L631), [server/storage.ts](../../server/storage.ts#L1495), [server/storage.ts](../../server/storage.ts#L1541).
- The future distinction between a native Document and uploaded File is not represented consistently: `company_documents` can be either, whereas Project Documents are native pages with attachment objects embedded in content. This must be disentangled without breaking stored paths or document IDs. Sources: [shared/schema.ts](../../shared/schema.ts#L93), [shared/schema.ts](../../shared/schema.ts#L586), [CONTEXT.md](../../CONTEXT.md#L139).

### People and Workspace precursor

- `users` combines global identity, password credential, global admin role, employment-like settings, archival state, and operational permission flags. There is no Membership table. Source: [shared/schema.ts](../../shared/schema.ts#L34).
- `teams`, `team_members`, and invite links provide group membership with `owner | admin | member`, but operational records do not reference a team. A user can join multiple teams without those teams isolating Projects, Clients, Documents, billing, or policy. Sources: [shared/schema.ts](../../shared/schema.ts#L666), [shared/schema.ts](../../shared/schema.ts#L699), [shared/schema.ts](../../shared/schema.ts#L735), [server/storage.ts](../../server/storage.ts#L1644).
- `org_settings` is explicitly a single global row with ID `default`; screenshot policy, time-zone allow-list, and help-center images are therefore installation-wide. Source: [shared/schema.ts](../../shared/schema.ts#L1299), [shared/schema.ts](../../shared/schema.ts#L1344).
- There is no persisted Subscription, Plan, Trial, Billable Seat, entitlement, payment, invoice, billing event, or billing-provider integration in the application schema or routes. The future billing surface is net-new backend work, not a refactor of existing billing code. Sources: [shared/schema.ts](../../shared/schema.ts), [server/routes.ts](../../server/routes.ts), [CONTEXT.md](../../CONTEXT.md#L174).

### Time, activity, and daily reporting

- A Time Entry belongs to a User and CRM Project; task is nullable for backward compatibility. `getActiveTimeEntry(userId)` treats both running and paused records as active, and web/desktop start logic auto-stops an existing one. The schema has a unique `clientCommandId` for desktop start idempotency, but no database constraint that enforces at most one active entry per User. Sources: [shared/schema.ts](../../shared/schema.ts#L1113), [server/storage.ts](../../server/storage.ts#L2450), [server/routes.ts](../../server/routes.ts#L4262), [server/agentRoutes.ts](../../server/agentRoutes.ts#L996).
- Activity evidence consists of screenshot rows, device activity-event rows, and timer heartbeats. Screenshots preserve keyboard/mouse percentages and counts; soft deletion tombstones the row but deliberately leaves the GCS object for a future purge job. Sources: [shared/schema.ts](../../shared/schema.ts#L1172), [shared/schema.ts](../../shared/schema.ts#L1287), [migrations/010_screenshot_soft_delete.sql](../../migrations/010_screenshot_soft_delete.sql).
- Project Daily Updates enforce a unique tuple of Project, User, and exact timestamp-valued `updateDate`, rather than the future “one per Membership per Workday” invariant. Source: [shared/schema.ts](../../shared/schema.ts#L1388).
- There are no Timesheet, Work Schedule, Workday, Timesheet Approver, or approval-lock records yet. Sources: [shared/schema.ts](../../shared/schema.ts), [CONTEXT.md](../../CONTEXT.md#L105).

## 4. Background processing and consistency

- Stale-timer detection, reminder dispatch, and daily-update reminders run in `setInterval` loops inside each web process. Guards against overlapping work are process-local booleans; one daily guard is partly durable through notifications, but there is no distributed scheduler, lease, or job queue. Sources: [server/routes.ts](../../server/routes.ts#L4484), [server/routes.ts](../../server/routes.ts#L4520), [server/routes.ts](../../server/routes.ts#L4601).
- Embedding generation and transcript synchronization are launched as unawaited promises from request handlers. They have endpoint-specific retry/status handling but no durable generalized job record, dead-letter handling, or backpressure. Sources: [server/routes.ts](../../server/routes.ts#L350), [server/routes.ts](../../server/routes.ts#L483), [server/transcripts.ts](../../server/transcripts.ts).
- The desktop queue survives restarts in `agent-queue.json` using temp-file/rename writes. It keeps FIFO timer commands, event batches, and screenshot retries. The class name and some documentation still say SQLite even though the implementation explicitly replaced SQLite with JSON. Sources: [desktop-agent/src/lib/SqliteQueue.ts](../../desktop-agent/src/lib/SqliteQueue.ts#L1), [desktop-agent/src/workers/SyncWorker.ts](../../desktop-agent/src/workers/SyncWorker.ts#L1).
- Activity batches are idempotent by `batchId`; timer start is idempotent by `clientCommandId`. Pause/resume/stop do not carry their own server-side command IDs, and the desktop currently treats several semantic conflicts as success. Sources: [shared/schema.ts](../../shared/schema.ts#L1127), [shared/schema.ts](../../shared/schema.ts#L1275), [server/agentRoutes.ts](../../server/agentRoutes.ts#L500), [desktop-agent/src/workers/SyncWorker.ts](../../desktop-agent/src/workers/SyncWorker.ts#L57).

## 5. Schema and deployment migration hazards

1. **No Workspace foreign key exists.** Adding a Workspace only at the edge would leave direct-ID routes and global queries able to cross boundaries. Workspace identity must reach persisted rows, uniqueness constraints, joins, object keys, search indexes, cache/job payloads, and authorization checks.
2. **Ownership is heterogeneous.** Some rows have `ownerId`, some `userId`, many inherit through Project/Client/Folder, teams are disconnected, and global settings/releases have no tenant owner. A deterministic lineage/backfill matrix is required before enforcing `workspace_id NOT NULL`.
3. **Current “company-wide” behavior must become the initial Workspace, not disappear.** Existing users and all installation-wide operational records need one seeded Workspace and Memberships that preserve current visibility during migration. Teams can be migrated as grouping metadata, but cannot simply be renamed Workspace because records do not point to them and a user may have several.
4. **Opportunity and Project are fused.** Existing `crm_projects` rows and stage history must be classified/backfilled into future Opportunities and Projects while retaining the legacy Project IDs used throughout URLs, documents, time entries, tasks, screenshots, desktop state, and queued commands.
5. **Document/File models overlap.** Native and uploaded company content share one table, while Project Documents use a different model. Migration must preserve object paths, embedding/transcript provenance, links, and access results while introducing Workspace Document/Project Document/File concepts.
6. **Migration execution is fragmented.** The Drizzle journal records only generated migrations `0000`–`0002`, while later numbered SQL files are manual and startup code also runs idempotent DDL for tasks and agent tables. The app additionally performs data linking and CRM seeding at boot. Sources: [migrations/meta/_journal.json](../../migrations/meta/_journal.json), [server/index.ts](../../server/index.ts#L106), [server/index.ts](../../server/index.ts#L132), [server/index.ts](../../server/index.ts#L217), [server/index.ts](../../server/index.ts#L244).
7. **Production replicas are not safe yet.** Ephemeral desktop JWT secrets, process-local schedulers, boot-time DDL/data migrations, and in-memory job guards create restart and multi-replica hazards.
8. **Database invariants are incomplete.** The active-timer singleton is application-enforced; team membership lacks a unique `(team_id,user_id)` constraint; installer “one latest per platform” is maintained by application transaction rather than a partial unique index; Daily Update uniqueness is timestamp-based. Sources: [shared/schema.ts](../../shared/schema.ts#L699), [shared/schema.ts](../../shared/schema.ts#L1113), [shared/schema.ts](../../shared/schema.ts#L1358), [shared/schema.ts](../../shared/schema.ts#L1388).
9. **Object lifecycle is incomplete.** Screenshot soft deletion intentionally retains objects, and the repository records no implemented retention/purge workflow. Workspace deletion, retention, legal/audit retention, and subject access/deletion will need coordinated DB/object/index cleanup. Sources: [migrations/010_screenshot_soft_delete.sql](../../migrations/010_screenshot_soft_delete.sql), [docs/SCREENSHOTS_ARCHITECTURE.md](../SCREENSHOTS_ARCHITECTURE.md#L65).
10. **Observability and recovery are placeholders.** Logging is console/JSON-oriented and names Sentry/Logtail/Datadog only as future sinks; no repository configuration establishes tracing, metrics, SLOs, backup verification, or disaster-recovery automation. Source: [server/logger.ts](../../server/logger.ts#L1).
11. **Contract documentation has drifted.** The agent protocol and test guides describe earlier pairing/SQLite behavior; migration decisions must be grounded in executable contracts and versioned compatibility tests, not documentation alone.

## 6. Capabilities that incremental migration must preserve

- Existing email/password web and desktop sign-in, sessions, device revocation, and OIDC long enough to migrate identities deliberately.
- Existing identifiers and links for Projects, CRM records, Documents, Files/object paths, Time Entries, screenshots, devices, and desktop releases.
- One active Timer per User across web and desktop, including offline start-command idempotency, server-authoritative heartbeat reconciliation, and queued evidence upload.
- Current Project/Client/document access for all existing users after they are placed in the initial Workspace; tightening access should happen only through explicit Workspace Role, Capability, Project Assignment, and Document Access migration decisions.
- Project Documentation, Workspace-precursor Company Documents, extracted text, embeddings, transcripts, and source relationships.
- Device screenshot policy delivery, activity evidence provenance, self visibility, tombstones, and audit-relevant metadata.
- Notifications, reminders, Daily Updates, admin reporting, desktop download/update endpoints, and installer history.

## 7. Recommended seams for later decision tickets

These are constraints and promising seams, not final architecture decisions:

- Keep a single deployable initially, but split the current route/storage monolith internally around Identity & Access, Workspace, Work & Clients, Knowledge, Time, Activity, Notifications, Billing, and Desktop Integration boundaries. The existing separate `agentRoutes.ts` is a useful starting seam.
- Seed one Workspace for all existing installation data. Create Memberships from users and translate global admin/special flags into built-in roles/capabilities before enforcing Workspace scoping.
- Introduce a request-level Active Workspace context and a single authorization service; prohibit new direct storage methods that accept only a resource ID when Workspace scope can be supplied.
- Add Workspace lineage from aggregate roots outward, with nullable/backfilled/verified/not-null phases. Use database constraints or row-level protection as defense in depth after query behavior is migrated.
- Preserve legacy API shapes through adapters while publishing versioned Workspace-aware web/public/desktop contracts. Add contract tests before changing the desktop protocol.
- Move boot-time schema/data changes into one auditable migration mechanism. Make backfills resumable, measured, and reversible; remove boot-time mutation after cutover.
- Move reminders, daily nudges, transcripts, embeddings, retention, exports, webhooks, and cleanup into durable jobs with idempotency keys and distributed leases/retries before adding replicas.
- Put object storage, email, AI/transcription, billing, and observability providers behind explicit application interfaces where replacement cost or policy enforcement is material.

## 8. Inputs still requiring explicit architecture decisions

- Whether PostgreSQL remains the sole transactional store and whether Workspace isolation uses shared-schema keys, separate schemas/databases, row-level security, or a layered combination.
- Identity provider and account-linking migration; session strategy; service accounts/API keys; device credential rotation and token revocation.
- Capability catalogue and enforcement location; ownership/transfer rules; privileged support access.
- Target domain module boundaries and the exact Opportunity/Project and Document/File migration models.
- API style/version windows, public API resources, signed webhook/outbox model, and the desktop synchronization/conflict protocol.
- Billing provider, Subscription/Plan/entitlement model, seat reconciliation, webhook ordering/idempotency, and read-only enforcement.
- Durable job/event technology, delivery semantics, scheduling, and operational replay.
- Search/index/vector/AI gateway providers, access-filter enforcement, deletion propagation, residency, retention, and no-training controls.
- EU-region hosting providers/topology, deployment strategy, observability, capacity assumptions, SLOs, RPO/RTO, backup verification, and disaster recovery.

## Conclusion

The existing backend is valuable as a working vertical slice and should be evolved rather than discarded, but it encodes a single-company installation assumption across schema, queries, policies, jobs, and integrations. The critical first architectural move is to establish Workspace as a verifiable data and authorization boundary while preserving current behavior inside one seeded Workspace. Provider selection and deeper module decomposition can then proceed against that migration seam instead of forcing a risky rewrite.
