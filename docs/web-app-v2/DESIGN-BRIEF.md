# DocuFlow Web App v2 — High-Fidelity Screen Brief

Status: superseded by `CLAUDE-DESIGN-HANDOFF.md`

This document preserves the earlier exploration. Do not use it as the generation authority; the confirmed domain model, navigation, batches, terminology, and anchor-screen instructions are consolidated in `CLAUDE-DESIGN-HANDOFF.md`.

## 1. Job and audience

The web app is DocuFlow's full operating surface for service organizations and individual professionals. Owners and administrators manage the organization, subscription, people, policy, clients, projects, time, activity, and knowledge. Managers coordinate client work and review evidence. Contributors operate from a focused view of their current assignments, time, updates, and documents. Individual workspaces use the same product model without staff-management surfaces.

Visitor mode: **Operate**. The interface must optimize scanning, comparison, frequent actions, and trustworthy recorded state. Marketing expression becomes disciplined product detail; it must never obstruct a task.

## 2. Outcome and proof

The first release must make three truths obvious in normal use:

1. A client project connects people, budget, tasks, time, activity, updates, and knowledge.
2. DocuFlow replaces a disconnected operational stack without becoming four unrelated mini-products.
3. An organization can administer its complete SaaS workspace—including people, roles, monitoring policy, devices, billing, and subscription—from the same coherent system.

Success means an owner can answer “What needs attention, where is the work, and who or what do I manage next?” from the opening screen, while a contributor sees a quieter version centered on their own day.

## 3. Selected direction: The Workspace Dossier

The web app behaves like a live operational dossier rather than a generic dashboard. The permanent shell provides workspace-level orientation; opening a client project reveals a dense, tabbed record whose sections share one identity header and one set of relationships.

The interface rejects the category-default dashboard made from interchangeable statistic cards. Overview surfaces instead use ruled registers, compact record rows, timelines, stage strips, and explicit exception queues. Cards are reserved for bounded objects, not used as the universal layout primitive.

### Shell topology

- **Left workspace rail:** DocuFlow identity, workspace switcher, primary navigation, role-gated administration, help, and account.
- **Top command bar:** breadcrumbs/current context, global search or command trigger, timer state, notifications, and one contextual primary action.
- **Main work surface:** a wide operational canvas using a consistent page header and ruled content regions.
- **Context panel:** optional right panel for details, activity, filters, or editing without losing the underlying list. It appears only when the task benefits from side-by-side context.
- **Project dossier:** project identity, client, stage, budget, people, and health remain visible across project tabs; the user never has to reconstruct which client record they are operating on.

### Navigation

The redesign preserves every existing product destination. Category labels organize the rail but are not destinations themselves, so Company Documents and Project Documentation remain directly reachable in one click.

- **Today** — new role-adaptive operating home.
- **Work**
  - **Clients & projects** — replaces the current “Project Management” label and contains the CRM, client records, project portfolio, and project dossiers.
- **Knowledge**
  - **Company Documents** — the current organization-wide document library at `/company-documents`.
  - **Project Documentation** — the current “Documentation” workspace at `/documentation`, including project trees and document editing.
- **Time & activity**
  - **Time Tracking** — timers, timesheets, attendance, approvals, exports, and time-project task management.
  - **Activity** — screenshots, activity levels, idle periods, screencasts, device evidence, and review dashboards.

Organization-only:

- **People** — staff directory, invitations, person records, roles, and access.
- **Administration** — workspace, policy, devices, billing, subscription, integrations, and audit controls.

Persistent utilities are not mixed into the product navigation:

- Help Center remains pinned near the bottom of the rail.
- Collapse/expand remains in the rail footer.
- Notifications, Ask DocuFlow, and the live timer move to the top command bar because they apply across every destination.
- Theme, profile, security, sessions, and sign out live in the account menu at the bottom of the rail.

Administration sections:

- Workspace
- Roles & permissions
- Tracking policy
- Devices
- Billing & subscription
- Integrations

Personal account items live in the account menu and personal settings, not in organization administration.

Individual workspaces omit People, roles, tracking policy, and organization billing language. Their Administration entry becomes Workspace settings and Subscription.

## 4. Visual authority

The sole authority is `../docuflow-marketing/DESIGN.md`. The desktop agent v2 system does not influence this web app.

### Product adaptation of the marketing system

- **Case Ink `#0F1524`:** titles, important controls, dense navigation anchors, and the rare dark operational band.
- **Cold Stock `#F3F5F7`:** application canvas and inset surfaces.
- **Card White `#FFFFFF`:** records, tables, editor sheets, and bounded panels.
- **Divider Grey `#D8DEE6`:** the default separator throughout the product.
- **Amber Tab `#E9A23B`:** one current state or primary next action per viewport. A running timer or current project stage may consume the amber allowance.
- **Signed-Off Green `#1F9D6B`:** completed, synced, verified, healthy, or confirmed outcomes.
- **Archive Slate `#59657A`:** secondary text and labels.
- **Cabinet Grotesk:** product identity and page/record titles only; the application uses a compact scale rather than marketing display sizes.
- **Switzer:** navigation, controls, body text, forms, and authored content.
- **JetBrains Mono:** durations, dates, prices, percentages, stages, IDs, badges, counts, and system-recorded metadata.
- **Radii:** 3px annotations, 6px controls/insets, 8px records and panels. Pills only for circular avatars, status dots, or continuous meter tracks.
- **Depth:** operational UI is flat. Use 1px rules and tonal layers. Shadows are limited to genuine overlays such as dialogs, menus, and draggable/floating utilities.
- **No gradients. No warm Layered Paper application chrome. No decorative amber.**

### Application-specific rules

- Active navigation uses weight, ink, and a structural marker; it does not automatically consume amber.
- A page with a running amber timer uses an ink-filled primary button instead of a second amber action.
- Dense data surfaces may use 12–14px UI text, but prose and editor content remain comfortably readable.
- Tables retain visible column meaning at narrow widths by transforming into labeled rows rather than horizontal clipping.
- Dark mode is not part of the first screen-generation pass; it is deferred until the light system is approved.

## 5. High-fidelity screen package

Generate these as a coherent desktop set at 1440×1024. Screens share one shell and realistic approved sample data. Where noted, include a 390×844 responsive companion.

### Screen 01 — Sign in and workspace entry

- Branded but restrained split composition on Cold Stock.
- Sign-in form, forgot-password path, SSO placeholder only if supported, validation, loading, and invalid-credentials treatment.
- After authentication, users with multiple workspaces receive a compact workspace chooser; single-workspace users continue directly.
- No marketing feature list or testimonial panel.
- Responsive companion required.

### Screen 02 — Today: owner/administrator

- Opening operational register, not an analytics-card dashboard.
- “Needs attention” queue: overdue update, budget threshold, unassigned project, offline device, pending invitation, billing exception.
- Current client projects organized by real CRM stage.
- Today's time summary, team availability, and recent knowledge changes as compact ruled sections.
- One clear action: create a client project or resolve the highest-priority exception, depending on state.

### Screen 03 — Today: contributor/individual variant

- Same shell grammar with role-adaptive content.
- Current timer and assigned task, today's schedule/work, due reminders, daily update status, and recently opened documents.
- Organization-only metrics and staff controls are absent rather than disabled.
- Responsive companion required.

### Screen 04 — Clients & projects portfolio

- Search, saved views, stage/status filter, owner filter, tags, and a list/board switch.
- Default list is a dense project register with client, project, stage, owner, budget consumed, tracked hours, last activity, and exception marker.
- Board mode follows the real stages: Lead, Won, In progress, In review, Completed.
- A right-side detail preview opens without leaving the portfolio.

### Screen 05 — Client record

- Client identity, contacts, active projects, total budget exposure, recent communication/notes, documents, and reminders.
- Projects remain the dominant child records; contacts and notes support them.
- Includes create-project and add-contact actions without turning the page into a form dashboard.

### Screen 06 — Project dossier: overview

- Signature screen of the product.
- Persistent project identity header: client, project, real stage strip, owner, team, budget, and health.
- Tabs: Overview, Tasks, Time, Activity, Updates, Knowledge, Files, Settings.
- Overview combines next actions, milestones/tasks, budget consumption, recent time, latest update, recent screenshots, and linked documents.
- Every module visibly belongs to this project through the shared record header and consistent metadata.

### Screen 07 — Project dossier: tasks and updates

- Tasks grouped by status or milestone with assignee, due date, tracked time, and compact inline editing.
- Daily updates appear in a chronological ruled feed with author, project link, progress state, blockers, and source context.
- Create/edit opens in the context panel when possible.

### Screen 08 — Time and attendance

- Personal timer remains globally available in the shell.
- Main surface supports personal/team scope, date range, project/person filters, timesheet rows, attendance exceptions, approvals, and export.
- Totals, durations, dates, and rates use JetBrains Mono.
- Managers can review and approve; contributors see only their permitted records.

### Screen 09 — Activity and screenshots

- Transparency-first framing: clearly state what is captured and why.
- Day/person/project filters, activity intervals, screenshot timeline, idle periods, device/source metadata, and review status.
- Screenshot detail opens as an overlay or context panel with timestamp, project/task provenance, activity level, and policy context.
- Avoid surveillance-wall aesthetics and competitive ranking of staff.

### Screen 10A — Company Documents

- Redesigns the current `/company-documents` screen as the organization-wide library for policies, job profiles, benefits, templates, and other internal records.
- Supports folder/list views, search, filters, create folder, upload/create document, ownership, last update, and access state.
- The default view remains immediately recognizable to current users but replaces the sparse card field with a more useful ruled library that scales beyond four folders.
- Folder and document detail may open in the context panel; editing receives a full work surface.

### Screen 10B — Project Documentation and document editor

- Redesigns the current `/documentation` workspace while retaining project/document trees as a distinct destination from Company Documents.
- Left project/document tree, central editor sheet, optional right outline/source panel.
- Project documentation links visibly back to its client project dossier; company knowledge remains available through search and cross-links without merging the two libraries.
- Editor chrome is quieter than the shell; written content uses Switzer, recorded metadata uses JetBrains Mono.
- Include a source-cited AI answer state tied to real documents; AI is an assistive layer, not the page identity.

### Screen 11 — People directory

- Staff register with role, team/workspace access, status, tracked-time policy, device status, last activity, and invitation state.
- Invite member is the primary action.
- Bulk selection supports role changes, archive, resend invite, and removal with appropriate confirmation.
- Empty state for the first organization member is included.

### Screen 12 — Person detail

- Identity and employment/workspace profile, role and permissions, assigned projects, time summary, devices, activity policy, invitation/login state, and audit history.
- Destructive actions are separated and require explicit confirmation.
- The page distinguishes organization-managed settings from preferences owned by the person.

### Screen 13 — Roles and permissions

- Role list with member counts and concise capability summary.
- Permission matrix grouped by Work & clients, Time, Activity, Knowledge, People, Billing, and Administration.
- Clear inherited/default/custom distinctions without relying on color alone.
- Include a custom-role creation/editing state and unsaved-change protection.

### Screen 14 — Billing and subscription

- Current plan/status, renewal or trial state, seat usage, billing contact, invoice history, payment method, and change/cancel actions.
- Pricing values remain explicit placeholders until approved; the high-fidelity screen must label them as design data.
- Billing failures and past-due state are designed, not left to a generic toast.
- Individual variant uses one seat and simpler copy but retains invoice/payment controls.

### Screen 15 — Workspace and policy settings

- Workspace identity, localization/time zone, work-week defaults, time-entry rules, screenshot/activity policy, retention, integrations, and data/export controls.
- Policy values distinguish organization-enforced settings from personal preferences.
- Settings use grouped ruled rows rather than a grid of unrelated cards.

### Screen 16 — Personal settings and notifications

- Profile, password/security, notification channels, appearance, personal timer defaults, connected devices, and sessions.
- Organization-managed values are labeled and linked to the responsible admin surface.
- Include save success, validation error, and session revocation states.

## 6. Required states and ranges

Every component system must cover:

- loading skeletons that preserve final geometry;
- first-use and genuinely empty states with a direct next action;
- permission-denied states that explain who can grant access;
- offline/stale/syncing/confirmed states for timer and desktop-agent data;
- invitation pending, expired, revoked, archived, and removed states;
- active, trial, past-due, canceled, and read-only subscription states;
- long client/project/person names, 0–500 projects, 1–500 staff, and dense multi-year histories;
- destructive confirmations, optimistic success, partial failure, and retry;
- keyboard focus, reduced motion, 200% zoom, and narrow desktop layouts.

## 7. Interaction and responsive behavior

- Lists preserve selection while the context panel opens; the browser back button restores the prior view and filters.
- Global search spans clients, projects, people, tasks, and documents, labeling each result type and workspace.
- Command access is optional acceleration, never the only way to perform a task.
- The shell collapses progressively: full rail → compact icon/label rail → mobile drawer. Current context and timer remain reachable.
- Project tabs become a horizontally scrollable, labeled strip on narrow screens; critical project identity remains above it.
- Tables become labeled record rows below their viable width rather than shrinking text below the scale.
- Motion is limited to state transitions, panel entry, and one purposeful relationship transition per flow. Reduced motion removes displacement.

## 8. Boundaries and anti-goals

- Do not reproduce the current Notion-inspired web theme.
- Do not copy the desktop v2 warm-paper, blue-action, Inter/Source Serif system.
- Do not turn every feature into a top-level navigation item.
- Do not lead with monitoring or make activity the product spine.
- Do not use generic statistic-card dashboards, gradients, glass effects, floating rounded containers, oversized marketing headings, or decorative charts.
- Do not invent pricing, customers, testimonials, benchmarks, integrations, or capabilities.
- Do not redesign backend contracts during screen generation.

## 9. Implementation consequence

The approved screens will be implemented in this repository as a parallel web presentation layer that reuses the current authentication, API client, query behavior, shared schemas, and backend. The marketing repository remains separate. The first implementation slice should establish shared tokens, fonts, shell, navigation, record/list primitives, status semantics, overlays, and responsive behavior before migrating feature screens.

The screen package is the implementation reference. It should use realistic component states and dimensions so engineering does not have to reinterpret a conceptual mockup.
