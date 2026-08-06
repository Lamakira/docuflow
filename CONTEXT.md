# DocuFlow

DocuFlow is a workspace-based operations platform connecting client work, people, time, activity evidence, and knowledge.

## Language

**Workspace**:
The ownership boundary for DocuFlow data, policies, members, and subscription. Every operational record belongs to exactly one workspace; the same workspace concept serves one person or a larger organization, and a one-member workspace can add members without migrating to another product type.
_Avoid_: Organization, account, tenant when referring to the product boundary

**User**:
A human identity that can access DocuFlow through one or more workspace memberships.
_Avoid_: Account, staff record

**Membership**:
The relationship connecting a user to a workspace, including that user's role and access within the workspace.
_Avoid_: User role, staff account

**Member**:
A user with an accepted, active membership in a workspace. The term does not imply employment and may include contractors, partners, or other collaborators.
_Avoid_: Staff, employee, workspace user

**Archived Membership**:
A former membership with access and billable-seat consumption revoked while its historical authorship and operational records remain intact. It may be restored without recreating the user.
_Avoid_: Deleted user, inactive account

**Owner**:
The sole protected membership with ultimate authority over a workspace, including its subscription, deletion, and ownership transfer. Ownership must be transferred before this membership can lose access.
_Avoid_: Main admin, super admin

**Workspace Role**:
A permission set assigned to one membership. Owner, Administrator, and Member are built in; a workspace may add custom roles without turning project responsibility into workspace authority.
_Avoid_: User role, project role, permission override

**Capability**:
A named permission granted through a workspace role that determines which destinations and actions a member may access.
_Avoid_: Role check, access flag

**Active Workspace**:
The workspace currently selected by a user and therefore the scope for navigation, search, permissions, and newly created records. Notifications remain global to the user, and an active timer retains its own explicit workspace scope.
_Avoid_: Current organization, global workspace

**Notification**:
A user-directed event originating from exactly one workspace and shown in the user's cross-workspace inbox with that origin visible.
_Avoid_: Workspace inbox item, global record

**Notification Category**:
One of a small, stable set of notification groupings — such as work assignments, reminders, approvals, membership, billing, and security — through which delivery preferences are expressed.
_Avoid_: Event type, notification setting

**Delivery Preference**:
A user's per-workspace, per-category choice of which derived channels carry their notifications. The in-app inbox cannot be disabled, and mandatory security, billing, and membership notices are delivered regardless of preference.
_Avoid_: Mute, unsubscribe, notification opt-out

**Invitation**:
A pending offer for a user to join a workspace. It shows projected seat impact but does not become a membership or consume a billable seat until accepted.
_Avoid_: Pending member, inactive user

**Service Account**:
A non-human identity through which an external integration acts within exactly one workspace using explicitly granted capabilities. It is not a member and does not consume a billable seat.
_Avoid_: API user, bot user, machine user

**Device**:
A registered desktop-agent installation associated with one user. A device has no workspace authority without a device enrollment.
_Avoid_: Desktop user, workspace device

**Device Enrollment**:
The authorization connecting one device to one workspace through the user's active membership. Revoking it ends that device's access to the workspace without affecting the user's other device enrollments.
_Avoid_: Device membership, agent account

## Work and clients

**Client**:
An external person or organization for whom a workspace performs work.
_Avoid_: Workspace, customer account

**Opportunity**:
A potential client engagement moving through a sales pipeline until it is won or lost. A won opportunity may create a Client Project but is not itself delivery work.
_Avoid_: Lead project, CRM project

**Opportunity Stage**:
A workspace-configurable step in an open sales pipeline. Won and Lost are fixed terminal outcomes rather than customizable open stages.
_Avoid_: Project status, custom outcome

**Project**:
The operational hub connecting tasks, time, activity, updates, files, and project documentation. A project is either a Client Project or an Internal Project.
_Avoid_: CRM project, documentation project

**Project Status**:
The standardized delivery state of a project: Planned, Active, On hold, In review, Completed, or Archived.
_Avoid_: Opportunity stage, custom project stage

**Project Dossier**:
The unified operational view of one Project and its linked tasks, time, activity, updates, Documents, Files, and settings.
_Avoid_: Project dashboard, CRM project page

**Client Project**:
A project linked to one client.
_Avoid_: Client record, CRM project

**Internal Project**:
A project owned directly by the workspace without a client relationship.
_Avoid_: Internal client, personal project

**Project Assignment**:
The relationship granting a member responsibility for and default visibility into a project. It does not grant workspace-level authority.
_Avoid_: Project role, workspace permission

**Task**:
An assignable unit of work belonging to exactly one project.
_Avoid_: Reminder, project, unscoped task

**Task Status**:
The standardized work state of a task: To do, In progress, Blocked, In review, Done, or Archived.
_Avoid_: Project status, custom task stage

**Task Assignee**:
The single member accountable for completing a task.
_Avoid_: Task owner, co-assignee

**Task Collaborator**:
A member participating in or following a task without holding primary accountability.
_Avoid_: Additional assignee, task owner

**Daily Update**:
A member's single submission for one workspace workday, containing progress grouped by project, blockers, next plans, and an optional general note.
_Avoid_: Project update, status task

## Time and activity

**Activity Evidence**:
Screenshots, activity levels, and idle periods recorded for a member while tracking work, with their project and task provenance. The subject member can always inspect their own activity evidence; DocuFlow does not convert it into productivity scores or member rankings.
_Avoid_: Monitoring feed, productivity score

**Tracking Policy**:
The workspace rules governing activity capture, frequency, retention, idle behavior, and who may review captured evidence. A member can always inspect the policy currently applied to them.
_Avoid_: Hidden monitoring settings, agent settings

**Timer**:
A user's single globally active work tracker, always scoped to one workspace and one project. Its active scope remains visible while the user browses another workspace.
_Avoid_: Workspace timer, parallel timer

**Timer Command**:
A single start, pause, resume, or stop instruction issued against a user's Timer from one identified web session or enrolled device, applied at its claimed effective time even when it arrives late.
_Avoid_: Timer event, sync message

**Timer Session**:
The span from one Timer start to its final stop, grouping every Time Entry produced within it by pauses, resumes, and late-arriving Timer Commands.
_Avoid_: Shift, timer run

**Time Entry**:
A recorded interval of work belonging to one workspace and one project, optionally linked to a task when policy allows. It may originate from the timer or an authorized manual entry.
_Avoid_: Unassigned time, activity session

**Work Schedule**:
The workspace's default time zone, working days, and expected reporting boundaries, optionally overridden for an individual member.
_Avoid_: Local device schedule, timer schedule

**Workday**:
A business day determined by a member's effective Work Schedule and used to group attendance, time entries, and the expected Daily Update.
_Avoid_: Local calendar day, UTC day

**Timesheet**:
A member's Time Entries grouped into one configured reporting period and moved through Open, Submitted, Approved, or Rejected states. Approval locks its entries until an authorized, audited reopening.
_Avoid_: Time report, payroll record

**Timesheet Approver**:
The member designated to approve another member's Timesheets, independently of project responsibility. Authorized backups and workspace administrators provide coverage.
_Avoid_: Project lead, payroll owner

## Knowledge

**Document**:
A knowledge record authored and edited inside DocuFlow.
_Avoid_: Uploaded file, attachment

**File**:
An uploaded binary asset that may be previewed, transcribed, indexed, or cited without becoming an editable Document.
_Avoid_: Document, native page

**Workspace Document**:
A Document owned by the workspace and not attached to a specific project.
_Avoid_: Company document, global document

**Project Document**:
A Document attached to one project and visible exactly to members who can access that project.
_Avoid_: Documentation project, workspace document

**Document Access**:
The visibility inherited by a Workspace Document from its folder: everyone in the workspace, selected workspace roles, or selected members. Browsing, search, and AI citations must enforce the same access.
_Avoid_: Search visibility, AI-only access

**File Version**:
One immutable uploaded revision of a File, stored as its own object and listed on the File with a current pointer. Replacing a File adds a version; it never overwrites an object.
_Avoid_: Overwritten file, object version

**Derived Artifact**:
A generated companion of one File Version — thumbnail, preview, poster, or extracted text — that inherits the source File's access and is never independently shareable.
_Avoid_: Public thumbnail, cached copy

**Transcript**:
The immutable, timestamped text record of one File Version's audio or video — or of an externally imported recording — carrying language and provider provenance. It is searchable and citable but never edited in place; its text may be copied into a Document.
_Avoid_: Editable transcript document, caption file

**Trash**:
The workspace holding area for soft-deleted Documents and Files during their restore window, after which a purge permanently removes rows, objects, derived artifacts, and index entries.
_Avoid_: Archive, permanent delete

## Search and AI

**Index Artifact**:
A rebuildable retrieval derivative — a chunk, embedding, or search row — carrying the workspace, source identity, source revision, and generation provenance needed to rebuild or purge it. It is never a source of truth and never widens access.
_Avoid_: Search document, AI training data

**Workspace AI Policy**:
The workspace rules governing which AI Purposes may run and which providers, regions, and retention modes may process workspace content, enforced before any external AI call. Owners and Administrators may disable AI globally or per purpose.
_Avoid_: AI settings, feature flag

**AI Purpose**:
The declared reason for one external AI call — such as search embedding, transcription, or answer — evaluated against the Workspace AI Policy and recorded in the call's audit event.
_Avoid_: AI feature, prompt type

**AI Answer**:
A stored, source-cited response to a member's question over the knowledge corpus, kept in that member's per-workspace history under workspace-configurable retention. Its citations re-check Document Access whenever displayed.
_Avoid_: Chat log, generated document

## Subscription and billing

**Subscription**:
The commercial agreement owned and billed independently by one workspace.
_Avoid_: User subscription, global subscription

**Plan**:
A subscription level that changes capacity and operational depth while retaining Time, Activity, Work & clients, and Knowledge as one complete product.
_Avoid_: Module bundle, single-feature tier

**Trial**:
A time-limited period with access to the complete product. When it expires without a paid subscription, the workspace becomes read-only while retaining access to its data, exports, and billing controls.
_Avoid_: Free plan, limited-feature trial

**Read-only Workspace**:
A workspace state that preserves viewing, authorized export, and subscription recovery while preventing operational changes. It follows trial expiry, cancellation at period end, or unresolved payment failure and is distinct from deletion.
_Avoid_: Deleted workspace, locked account

**Billable Seat**:
An accepted, active membership that consumes subscription capacity. Pending invitations and archived or removed memberships do not consume seats.
_Avoid_: User license, invited seat

**Entitlement**:
A workspace-level answer to whether the subscription grants a capability or capacity limit, derived deterministically from billing state and the versioned plan registry rather than read from the billing provider.
_Avoid_: Feature flag, plan permission

**Plan Registry**:
The versioned, DocuFlow-owned catalog mapping each plan to its entitlement values and seat limits. Workspaces pin to a registry version until deliberately migrated, so plan changes never silently apply.
_Avoid_: Stripe product catalog, pricing table

## Integrations

**Webhook Endpoint**:
A workspace-owned target that receives signed notifications for selected public event types, with its own secret, event filter, and enable/disable lifecycle. It confers no read authority; consumers fetch current state with their own credentials.
_Avoid_: Callback URL, webhook subscription

## Security and compliance

**Audit Event**:
An append-only, PII-minimized record of one security-relevant action, carrying workspace or platform scope, the acting principal by ID, and references rather than content. It is evidence, not a domain event, and is never updated or deleted in place.
_Avoid_: Log line, outbox event, activity feed item

**Data Class**:
One of six fixed platform classifications — Public, Workspace-Operational, Sensitive-Evidence, Identity, Financial, Secret — assigned to a record type and driving its encryption, logging, export, and delivery controls. Workspaces cannot redefine classes.
_Avoid_: Sensitivity label, workspace tag

**Erasure Journal**:
The durable, ID-only record of completed purge and erasure operations, replayed after any backup restore so erased data does not resurface. It never contains erased content.
_Avoid_: Deletion log, trash history

**Legal Hold**:
A purge-blocking flag on named records or a whole workspace that suspends retention and deletion jobs while an incident or legal matter is open. It preserves; it never widens access.
_Avoid_: Archive, backup, freeze

**Platform Staff**:
An internal DocuFlow operator principal from a dedicated identity pool, distinct from Users, acting only through the separate audited operator surface with no standing access to workspace content.
_Avoid_: Super admin, support user, impersonation account

**Support Access Grant**:
A time-boxed, workspace-visible authorization allowing named Platform Staff to access a workspace's content for support. Absent a grant, only audited break-glass access exists.
_Avoid_: Impersonation, admin override

**Subprocessor Registry**:
The published list of vendors processing customer data on DocuFlow's behalf, recording each vendor's purpose, region, and no-training terms. Vendor changes update the registry and notify customers before material changes take effect.
_Avoid_: Internal vendor list, integrations page
