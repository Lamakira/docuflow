# DocuFlow Web App v2 — Claude Design Handoff

Status: confirmed for high-fidelity generation

## Mandate

Design the future-state DocuFlow web application as if its complete SaaS backend already exists. This is a high-fidelity product design exercise, not an implementation of the current database. Backend and API changes will be planned during implementation.

The result must look and behave like the authenticated operational counterpart of the DocuFlow marketing site. It must not borrow the desktop agent v2 visual system or preserve the current web app's green/blue Notion-inspired styling.

Generate the anchor batch only. Do not generate the entire product suite until this batch is reviewed and approved.

## Authority order

When sources disagree, use this order:

1. `CONTEXT.md` — confirmed product vocabulary and domain boundaries.
2. `docs/adr/` — confirmed hard-to-reverse decisions.
3. `FLOWS.md` — confirmed sequence, branching, and division of responsibility between Clerk, Stripe, and DocuFlow. Authoritative over this document on flow order and on who renders what; this document remains authoritative on everything visual.
4. `PRODUCT.md` — web-app purpose, audiences, capabilities, and constraints.
5. `../docuflow-marketing/DESIGN.md` — canonical ecosystem identity and visual language.
6. Current code under `client/` — functional evidence only, not visual authority.
7. `desktop-agent/src/renderer/app-v2/` — workflow evidence only; never visual authority.

## Product truth

DocuFlow connects four complete pillars inside one Workspace:

- **Work & clients:** Opportunities, Clients, Projects, Tasks, Daily Updates, budgets, and assignments.
- **Time:** one global Timer per User, Project-scoped Time Entries, Work Schedules, attendance, Timesheets, and approval.
- **Activity:** transparent Activity Evidence, screenshots, idle periods, Devices, and Tracking Policy—never productivity scores or rankings.
- **Knowledge:** Workspace Documents, Project Documents, Files, search, transcription, and source-cited Ask DocuFlow answers.

Project is the operational hub. It connects tasks, people, time, Activity Evidence, Daily Updates, Documents, Files, and permitted financial information. Opportunities are sales records and are not Projects. A Project may be a Client Project or an Internal Project.

Every operational record belongs to exactly one Workspace. A one-member Workspace can grow into a team without becoming a different product. A User may belong to multiple Workspaces, but search and operational data remain scoped to the Active Workspace. Notifications are global and always label their originating Workspace.

## Audience and design mode

Mode: **Operate**.

The anchor screens show an Owner/Administrator of a service-business Workspace. They are scanning for exceptions, reviewing connected work, and acting quickly. The design must support density, comparison, keyboard use, long names, permissions, and repeated daily use. Brand expression belongs in typography, rules, state semantics, and composition—not decorative chrome.

## Creative direction: The Workspace Dossier

The application behaves like a live operational dossier rather than a generic SaaS dashboard. Records are filed, connected, ruled, and attributable. The app should feel as if the marketing site's “Client Dossier” has become a real operating system.

Reject the category-default composition of floating KPI cards. Prefer:

- ruled registers;
- dense record rows;
- explicit exception queues;
- stage and status strips;
- compact timelines;
- stable identity headers;
- detail panels that preserve list context;
- white records on Cold Stock, separated by hairlines.

Cards are for bounded objects. Do not make every region a card.

## Canonical visual system

### Color

- Case Ink: `#0F1524`
- Ink Raised: `#161D30`
- Cold Stock: `#F3F5F7`
- Card White: `#FFFFFF`
- Amber Tab: `#E9A23B`
- Amber pressed: `#D8912F`
- Signed-Off Green: `#1F9D6B`
- Archive Slate: `#59657A`
- Divider Grey: `#D8DEE6`
- Ink Border: `#2A3348`

Amber means the current state or the next primary action—never both in the same viewport. A running Timer consumes the amber allowance. In that state, the page's primary action uses Case Ink. Green means confirmed, completed, synced, approved, or healthy. Never exchange these meanings.

Use flat held colors. No gradients at any opacity.

### Typography

- Cabinet Grotesk: DocuFlow identity, page title, and important record titles only.
- Switzer: navigation, authored copy, forms, controls, and ordinary UI.
- JetBrains Mono: durations, timestamps, dates, amounts, percentages, stages, statuses, IDs, counts, badges, and system-recorded metadata.

Use an application-scale ramp rather than marketing display sizes:

- Page title: 28–32px Cabinet Grotesk, weight 800.
- Record title: 18–22px Cabinet Grotesk, weight 700–800.
- UI/body: 13–15px Switzer.
- Long-form content: 16–18px Switzer.
- Labels/data: 10–13px JetBrains Mono.

### Shape and depth

- 3px: badges, tags, small annotations.
- 6px: controls and inset surfaces.
- 8px: records and panels.
- Full radius only for avatars, status dots, and meter tracks.
- Default separation is a 1px Divider Grey rule.
- No resting shadows on navigation, records, tables, or cards.
- Shadows are permitted only on true overlays such as menus, dialogs, lightboxes, and the context panel when it sits above content.
- Marketing-only Layered Paper colors and backing sheets must not appear in application chrome.

### Interaction

- Visible 2px amber focus ring with offset.
- Reduced-motion support.
- State transitions approximately 150–200ms; no bounce or decorative displacement.
- Rows and controls do not lift or scale on hover.
- Context panel handles lightweight review, preview, and metadata editing.
- Sustained work uses a full page.

## Canonical shell

### Desktop

- Canvas: `1440 × 1024`.
- Persistent left rail: approximately 240px expanded; collapsible to a compact icon rail.
- Top command bar: approximately 60–64px high, spanning the work area.
- Main canvas: responsive and wide enough for dense registers.
- Optional right context panel: 360–440px depending on content.

Left rail:

```text
DocuFlow
[Workspace switcher]

Today

WORK
  Opportunities
  Clients
  Projects

KNOWLEDGE
  Workspace Documents
  Project Documentation

TIME & ACTIVITY
  Time Tracking
  Activity

People
Administration

Help Center
[Account]
```

Group labels organize the rail but are not extra navigation clicks. Destinations appear according to Capabilities rather than hard-coded role names.

Top command bar:

- breadcrumb or current context;
- Active-Workspace global search;
- visible Timer with Workspace, Project, Task, and elapsed duration;
- Ask DocuFlow;
- global Notifications with Workspace provenance;
- one contextual primary action.

Do not place theme, sign out, or personal security as permanent icons. They belong in the account menu. Personal Devices live in Personal Settings; Workspace Devices live in Administration.

### Mobile

- Canvas: `390 × 844`.
- Rail becomes a drawer.
- Today remains the home.
- Timer remains visible and attributable.
- Search, Notifications, Ask DocuFlow, and account remain reachable without a dense icon strip.
- Tables transform into labeled record rows; do not shrink typography into unreadability or require page-level horizontal scrolling.

## Consistent synthetic dataset

All screens must use one clearly synthetic Workspace dataset. Do not copy production customer or staff information.

Workspace: **Keystone Studio**

Clients:

- Northwind
- Meridian
- Kaleido

Anchor Project:

- Client: Northwind
- Project: Ledger rebuild
- Status: Active
- Budget: `$48,000`
- Budget consumed: `62%`
- Tracked this month: `71.7 h`
- Tasks: `12` open, `2` blocked
- Documents: `8`
- Files: `14`

Members:

- Amina Rahman — Owner
- Jules Martin — Administrator
- Kofi Tano — Member / Project assignee
- Elena Silva — Member / Timesheet approver

Workspace Documents folders:

- Workspace Policies
- Job Profiles
- Benefits
- Document Templates

Every value is design data, not a product or customer claim.

## Required outputs — anchor batch

Generate five coordinated artifacts:

1. Application-system board
2. Owner/Administrator Today — desktop
3. Project Dossier Overview — desktop
4. Workspace Documents — desktop
5. Owner/Administrator Today — mobile

The screens must feel like one product created from one component system. Do not vary shell proportions, tokens, navigation, or synthetic data between screens.

## Artifact 1 — Application-system board

Show the actual app components at implementation fidelity, not a brand mood board:

- expanded and collapsed rail;
- Workspace switcher;
- top command bar;
- stopped and running Timer;
- buttons: amber primary, ink primary, secondary, ghost, destructive;
- inputs, search, select, date range, filter chips, and command result;
- tabs and segmented view switch;
- record row and selected row;
- table header, body, totals, pagination, and responsive row;
- stage/status badges using amber, green, ink, and neutral semantics correctly;
- avatar, Member status, invitation status, and archived state;
- budget and time meters with visible values;
- empty, loading, error, access denied, read-only, syncing, and confirmed states;
- context panel, dialog, menu, toast, and destructive confirmation;
- focus-visible and reduced-motion annotations;
- typography samples demonstrating recorded versus written content.

## Artifact 2 — Today, Owner/Administrator desktop

Purpose: answer “What needs my attention?” before showing totals.

State:

- Active Workspace: Keystone Studio.
- Timer is running on Northwind / Ledger rebuild / Reconcile import totals.
- Because Timer is amber, the page's action uses Case Ink.
- Notification badge includes at least one item from another Workspace, with provenance visible in the inbox preview.

Composition:

1. Compact page header: “Today”, effective Workday, short operational sentence, ink action.
2. **Needs attention** ruled queue as the focal region:
   - `3` Timesheets awaiting approval;
   - `2` missing Daily Updates;
   - Ledger rebuild budget at `62%` with an approaching-threshold note;
   - `2` blocked Tasks;
   - `1` Device offline;
   - `1` pending Invitation;
   - no payment failure in the happy-path anchor.
3. Active Projects register using standardized Project Status, not sales stages.
4. Team/workday summary with attendance and Daily Update state.
5. Recent knowledge changes across Workspace and permitted Project Documents.

Interaction evidence:

- One selected exception opens a visible right context panel.
- The panel shows enough underlying context to approve/review without leaving Today.
- The list remains visible behind it.
- Do not turn the page into a grid of six KPI cards.

## Artifact 3 — Project Dossier Overview desktop

Purpose: prove that Project connects the four product pillars.

Persistent identity header:

- Northwind / Ledger rebuild
- Client Project marker
- Status: Active
- one accountable project lead and visible team
- budget and margin fields visible because this Owner has financial Capability
- synthetic identifier and last-updated metadata in JetBrains Mono

Canonical tabs:

- Overview
- Tasks
- Time
- Activity
- Updates
- Documents
- Files
- Settings

Overview content:

- Next actions and blocked Tasks.
- Budget consumption and tracked time.
- Latest Daily Update excerpt and blocker.
- Recent Activity Evidence with transparent provenance—not a monitoring wall.
- Recent Project Documents and Files.
- Client summary with only relevant contacts.
- A small relationship trace showing that each record belongs to this Project; use structure and metadata, not marketing illustration chrome.

The screen must make it impossible to mistake Opportunity Stage for Project Status. Do not show Lead or Won in the Project lifecycle.

## Artifact 4 — Workspace Documents desktop

Purpose: evolve the current Company Documents screen into a scalable workspace library without losing recognizability.

Use **Workspace Documents**, never Company Documents.

Default view: structured list/register, with an optional grid-view toggle.

Show:

- search;
- type, owner, access, and updated-date filters;
- create Document;
- upload File;
- create folder;
- rows for folders, native Documents, and uploaded Files;
- folder path;
- owner;
- access scope: Everyone, selected Roles, or selected Members;
- last editor and timestamp;
- File size or Document status where relevant;
- one selected row opening a preview/context panel.

Use the four confirmed folders: Workspace Policies, Job Profiles, Benefits, and Document Templates. Include enough nested content to prove that the layout scales beyond four cards. Search and Ask DocuFlow must visibly inherit Document Access; never expose restricted names through mock results.

## Artifact 5 — Today, Owner/Administrator mobile

Purpose: prove the shell and exception-first hierarchy survive a narrow screen.

Required:

- drawer access with Active Workspace clear;
- compact global Timer with full provenance available on expansion;
- Today header and workday;
- Needs attention first;
- exceptions rendered as labeled rows, not mini cards;
- one context item opening as a full-height sheet;
- global Notifications reachable with Workspace labels;
- primary action reachable without a floating orb or crowded bottom bar;
- no horizontal page scroll.

## Required states and ranges

The board and anchor screens must establish patterns that survive:

- 1–500 Members;
- 0–500 Projects;
- long Workspace, Client, Project, Member, Task, Document, and File names;
- pending Invitation, active Member, Archived Membership;
- Trial, active Subscription, past due, and Read-only Workspace;
- loading, empty, partial error, offline, stale, syncing, confirmed, and permission-denied states;
- 200% zoom and keyboard-only operation;
- a running Timer whose digits never reflow;
- a user switching Workspaces while that Timer remains active elsewhere.

## Absolute prohibitions

- No desktop-agent v2 blue-action, warm-paper, Inter, or Source Serif system.
- No current-web green brand block or blue selected navigation.
- No gradients.
- No glassmorphism.
- No large-radius floating dashboard containers.
- No universal card grid.
- No ornamental shadows.
- No decorative amber or multiple competing amber elements.
- No Layered Paper in application chrome.
- No productivity score, member ranking, or surveillance-wall composition.
- No invented customers, testimonials, proof statistics, prices, plan limits, integrations, or public claims.
- No sales stages on Project records.
- No mixing Workspace Documents and Project Documentation into one ambiguous destination.
- No inaccessible record names leaking through search, AI sources, notifications, or previews.

## Approval criteria

The anchor batch is approved only if:

1. It unmistakably belongs to the same ecosystem as `docuflow-marketing` with all marketing copy removed.
2. A first-time operator can explain the navigation hierarchy after one glance.
3. Today is exception-first and action-oriented.
4. Project Dossier visibly connects Work, Time, Activity, and Knowledge.
5. Workspace Documents scales beyond the four-folder incumbent screen.
6. Amber and green meanings remain truthful.
7. Recorded and written information use the correct typographic voices.
8. The design works at both required viewport sizes.
9. Permissions and Workspace provenance are visible where they matter.
10. The system board is complete enough that implementation does not invent missing primitives.

## After anchor approval

Do not proceed before explicit approval. After approval:

1. Generate the confirmed second batch as ten state-complete screen families:
   - authentication, Trial onboarding, and Workspace selection — sequence and branching are specified in `FLOWS.md`, flows 1 through 8; follow it rather than inventing steps;
   - contributor/individual Today;
   - Opportunities;
   - Clients and Projects;
   - Project Dossier depth;
   - Time, attendance, Timesheets, and approvals;
   - Activity Evidence, screenshots, Tracking Policy, and Devices;
   - Project Documentation, editor, Files, search, and Ask DocuFlow;
   - People, Invitations, Membership lifecycle, Roles, and Capabilities;
   - Subscription, billing, Workspace administration, and personal settings.
2. Write `client/DESIGN.md` from the approved operational system.
3. Convert the approved design and domain decisions into an implementation specification.
4. Implement through the feature-flagged parallel v2 layer recorded in ADR-0003.

## Decided since this handoff was written

These were open when this document was drafted and are now settled by ADR. Treat them as product truth, not placeholders. They bind the second batch — authentication, Trial onboarding, Workspace selection, and billing — more than they bind the anchor batch, but the anchor batch must not contradict them.

**Authentication is Clerk** (ADR-0007). Clerk owns credentials, authentication flows, MFA, and session rotation. DocuFlow stays authoritative for Users, Workspaces, Memberships, Workspace Roles, Capabilities, Service Accounts, Devices, and every authorization decision. Design the seam honestly: the credential moment belongs to the provider, everything after it — Workspace selection, membership state, what this Member may see — belongs to DocuFlow. Do not draw a DocuFlow-branded password field as though DocuFlow stored the password.

**Billing is Stripe with DocuFlow as merchant** (ADR-0010), Stripe Tax enabled. The boundary is fixed: checkout and payment-method capture live on hosted Stripe surfaces; plan changes and seat changes live only in DocuFlow's own UI. Never design a DocuFlow-native card form.

**Trials carry no card and create no Stripe objects.** A Trial is a DocuFlow state, not a Stripe subscription. The start-Trial path therefore has no payment step to design.

**Trial expiry, cancellation, and failed dunning all end in a Read-only Workspace** — viewing, export, and recovery preserved. Data is never held hostage. Dunning retains full access until the terminal outcome, so "past due" is not a degraded interface. Read-only is a centrally enforced entitlement outcome, so its treatment must read as a Workspace-wide condition rather than a per-button disabled state.

**Seats are purchased capacity, and only accepted active Memberships consume one** (ADR-0010). Pending Invitations and Archived Memberships cost nothing. Seat increases apply immediately with proration; decreases apply at period end, floored at active consumption. People and Invitation screens should make the free states legible, or owners will assume they are being billed for invitations.

**Entitlements come from a DocuFlow-owned versioned Plan Registry**, not from Stripe. Plan and entitlement values are still open; the fact that DocuFlow owns them is not.

## Deliberately open, non-blocking decisions

Do not invent answers for:

- final Plan names, prices, limits, or Trial duration;
- production domain;
- dark-theme tokens;
- guest/client portals;
- cross-Workspace record transfer.

Use visibly labeled design placeholders only where an anchor artifact cannot avoid one.
