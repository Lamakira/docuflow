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
