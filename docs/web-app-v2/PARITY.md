# v1 → v2 parity — what the rewrite has not carried over

**Read this before deciding that v2 is ready to replace v1.** [`UI-FINDINGS.md`](UI-FINDINGS.md) says it feeds "the v1 → v2 parity spec". This is that spec, and it did not exist until now — which is itself the first finding: the parallel layer ADR-0003 describes has been built for eight months with no record of what it still owes.

Audited on 2026-09-20 against `main` at `e150ca8`.

---

## Method, and what it can and cannot tell you

Two passes.

**Routes.** Every `<Route path>` in `client/src/App.tsx` (v1) matched against `client/src/v2/V2AuthenticatedApp.tsx` (v2).

**Capabilities.** Every `/api/…` string reachable from `client/src/pages` and `client/src/components` (v1) set against every one reachable from `client/src/v2` (v2), template literals included.

An endpoint is a **proxy** for a capability, not the capability itself. A missing endpoint is strong evidence that something cannot be done in v2 — the screen has no way to ask for it. A shared endpoint proves far less: both layers call `/api/tasks`, and that says nothing about whether they offer the same things to do with a task. **So this document under-reports.** Every gap listed here is real; the list is not complete.

Not audited: UI depth behind a shared endpoint, keyboard and accessibility behaviour, empty and error states, anything the desktop agent reaches.

---

## Routes: no gap

Every v1 route has a v2 home. Nothing is orphaned, and v2 does not fall back to a v1 page anywhere — un-migrated paths resolve to `{ kind: "placeholder", title: "Not in this batch" }` (`presentation.ts:484`), which nothing in the current route table reaches.

| v1 | v2 | |
| --- | --- | --- |
| `/` | `/` — Today | rewritten |
| `/crm` | `/projects?view=board` | redirect — board, addressed by [#259](https://github.com/Lamakira/docuflow/issues/259) |
| `/crm/project/new`, `/crm/project/:id` | `/projects?new=1`, dossier | redirect |
| `/crm/client/new`, `/crm/client/:id` | `/clients?new=1`, client record | redirect |
| `/documentation` | `/project-documentation` | redirect |
| `/company-documents` | `/documents` | redirect |
| `/company-documents/:id/edit`, `/view` | `V2DocumentPage` | rewritten |
| `/project/:id` | `V2LegacyProjectPage` | rewritten |
| `/document/:id` | `V2DocumentPage` | rewritten |
| `/daily-update` | `/daily-update` | rewritten |
| `/admin`, `/admin/create`, `/admin/user/:id` | `/administration` | redirect — **see A** |
| `/admin/analytics` | `/administration#alerts` | redirect — warnings, addressed by [#259](https://github.com/Lamakira/docuflow/issues/259) |
| `/admin/daily-updates` | `/daily-updates` | redirect |
| `/time-tracking` | `/time` | redirect |
| `/time-tracking/dashboard` | `/time/stats` | redirect |
| `/time-tracking/projects` | `/time/projects` | redirect |
| `/time-tracking/devices`, `/download` | `/devices` | redirect |
| `/time-tracking/screencasts` | `/activity` | redirect |
| `/devices` | `/devices` | rewritten |
| `/help-center`, `/help-center/:slug` | `/help` | redirect |
| `/invitations/:token` | same component in both | shared |

A redirect is not a migration. One of them still lands somewhere that cannot do what the origin did: A, below. B and D are addressed by [#259](https://github.com/Lamakira/docuflow/issues/259).

---

## Capabilities: 25 endpoints v1 can reach and v2 cannot

v1 reaches 87 distinct endpoints, v2 reaches 94. v2 is the larger surface — it owns Workspaces, Billing, Invitations, Service Accounts, Webhook Endpoints, notification preferences, cross-Workspace search and account deletion, none of which exist in v1. The rewrite is not behind overall. It is behind in specific, nameable places.

### A. The platform user directory — nothing in v2

```
/api/admin/users
/api/admin/users/:id
/api/admin/users/:id/role
/api/admin/users/:id/reset-password
```

v1's `/admin` creates a User, opens their detail, changes their global role, and resets their password. `/admin/create` and `/admin/user/:id` both redirect to `/administration`, which offers none of it.

v2's People does Invitations and a Membership's profile — hours per day, the daily-updates flag. It never creates a User and never touches `users.role`.

This is the widest gap, and [ADR-0025](../adr/0025-let-the-workspace-role-govern-administration-and-keep-the-platform-directory-separate.md) makes it more pointed: the directory is a **platform** surface, not a Workspace one — `users` has no `workspace_id`, so no row-level security and no query scope — and it stays behind the global `users.role` column for exactly that reason. So it is not only un-migrated, it is the one surface that cannot simply be dropped into the Workspace chrome. Whatever v2 does here needs a decision first.

### ~~B. Four analytics dashboards~~

Addressed by [#259](https://github.com/Lamakira/docuflow/issues/259). Administration draws the four beside the analytics it already had. `/admin/analytics` opens the warnings, which name a Device that has stopped reporting.

- ~~`/api/admin/analytics/alerts`~~
- ~~`/api/admin/analytics/evidence-quality`~~
- ~~`/api/admin/analytics/productivity`~~
- ~~`/api/admin/analytics/screenshots`~~

### ~~C. Project record depth~~

Addressed by [#260](https://github.com/Lamakira/docuflow/issues/260). The dossier reaches every one of these, in the order the audit ranked them by what a reader loses without them:

- **Stage history** — a card on Overview lists each change newest first, who made it, and how long the Project held that stage: until the next change, or "so far" for the current one. It is the only record of duration, so the span is the point of the card, not the date.
- **Tags** — Settings holds the Workspace's whole vocabulary: create (which attaches the new Tag to this Project), rename, delete, attach, detach. Deleting a Tag takes it off every Project that carries it, so it asks first, in the same modal Billing uses. The attached Tags sit beside the status in the dossier header, and the Projects register shows them on each row and filters by one.
- **Member removal** — Settings lists the rows in `project_members`, each with Remove, or Leave on the reader's own. The route decides who may remove whom — the Project owner or an Administrator removes anyone, a member only themselves — and its refusal reaches the page as written.
- **Clone** — Settings clones the Project and opens the copy's Settings, where the name ends in "(Copy)" and wants changing.
- **Documentation** — the DOCUMENTATION field was read-only; Settings now switches it through `/api/crm/projects/:id/documentation`.

- ~~`/api/crm/projects/:id/clone`~~
- ~~`/api/crm/projects/:id/stage-history`~~
- ~~`/api/crm/projects/:id/tags/:id`~~ — and `/api/crm/projects/:id/tags`, which the audit did not list, reads the attached ones
- ~~`/api/crm/projects/:id/members/:id`~~
- ~~`/api/crm/projects/:id/documentation`~~
- ~~`/api/crm/tags`~~
- ~~`/api/crm/tags/:id`~~
- ~~`/api/projects/:id`~~ — **deliberately dropped.** v1 used it for two things, and v2 already does both through the CRM route: it reads the `projects` row inside `/api/crm/projects/:id`, and it renames through `PATCH /api/crm/projects/:id` with `projectName`. The route itself says Project updates "should go through CRM for metadata consistency"; a second rename path would be two ways to write one field.

### ~~D. The Kanban board~~

Addressed by [#259](https://github.com/Lamakira/docuflow/issues/259). The board is a view on `/projects`, not a second destination: the register answers what exists, the board answers where each Project sits. `/crm` opens the board.

It is **not** v1's board. v1 drew the whole combined lifecycle in twelve columns, the first five of which were the sales pipeline — which v2 already draws on Opportunities. The v2 board lists exactly the register's Projects in five Project Status columns — planned, active, in review, completed, archived — and follows ADR-0001 for writes: an Opportunity still open, or lost, sits where the register puts it but cannot be dragged, because dropping a lead on ACTIVE would win the sale from the delivery board. A drop writes the one combined status that reads back as that column.

`/api/crm/projects/all` did not exist on the server before #259: v1's `ClientDetailPage` queried it and landed on `/api/crm/projects/:id` with `id = "all"`. #259 added the route, which fixes that v1 page as a side effect.

- ~~`/api/crm/projects/all`~~
- ~~`/api/crm/projects/all-kanban`~~

### ~~E. Documents~~

Addressed by [#260](https://github.com/Lamakira/docuflow/issues/260).

- **Folders** — the folder preview in Workspace Documents renames the folder and deletes it. The route deletes every Workspace Document in the folder with it, so the confirmation says how many, in the shared modal. The server still lets only a platform `admin` delete one; everyone else gets its refusal.
- **Duplicate and reorder** — each Project Document on the dossier's Documents tab carries Duplicate, Move up and Move down in its row menu. A move stays among the Document's siblings — the ones sharing its parent — because that is what the reorder route's index counts.
- **Attachments** — the attach control in the document editor now attaches: the File is uploaded and its object path set public through `/api/document-attachments`, the way v1's Document page did, on Project and Workspace Documents alike. The control was drawn on every v2 Document and did nothing ([#249](https://github.com/Lamakira/docuflow/issues/249)); the editor now draws it only for a page that passes a handler, so a read-only Document shows none.

- ~~`/api/company-document-folders/:id`~~
- ~~`/api/documents/:id/duplicate`~~
- ~~`/api/projects/:id/documents/reorder`~~
- ~~`/api/document-attachments`~~

### ~~F. Remainder~~

Closed by [#260](https://github.com/Lamakira/docuflow/issues/260) — and the 2026-09-22 confirmation was wrong about two of the three. It searched for endpoint strings under `client/src/v2`, which misses anything v2 renders from a shared component.

- ~~`/api/help-center/screenshot-map`~~ — **was never a gap.** v2's Help Center renders the same article components v1 does (`HELP_ARTICLE_COMPONENTS`, under a `surface="v2"` provider), and five of those articles place `HelpScreenshot`, which reads the map. The figure classes already have v2 tokens (`df-doc-figure*`). A characterization test now holds that path open.
- ~~`/api/objects/upload-public`~~ — **reachable already**, for the same reason: `HelpScreenshot` uploads a platform `admin`'s screenshot through it. What was missing was the capability v1's `CrmProjectPage` used it for — a File attached to a Project note. The dossier's Notes tab now attaches Files to a note, and they land on its Files tab.
- ~~`/api/screencasts/timezones`~~ — covered, as found: v2 edits `allowedTimezones` through `/api/workspace/settings`. The input stays free text with its validation, and now offers every IANA zone the Workspace does not allow yet as a list to choose from. The endpoint itself returns the allowed zones, not a catalogue, so it was never the list to pick from.

---

## What to do with this

The gaps are not one decision. They are four:

1. **A needs a decision before it needs code.** The platform directory is not a Workspace surface, and dropping it into the Workspace chrome would repeat the mistake [#238](https://github.com/Lamakira/docuflow/issues/238) fixed.
2. **B and D were migrations**, and [#259](https://github.com/Lamakira/docuflow/issues/259) addresses them: the four analytics panes sit in Administration, and the Kanban is a board view on Projects.
3. **C and E were depth** — each one small, together the difference between a rewrite that looks finished and one that is. [#260](https://github.com/Lamakira/docuflow/issues/260) addresses both.
4. **F was a check.** It found two gaps, and [#260](https://github.com/Lamakira/docuflow/issues/260) found that one of them was a gap in the search, not in v2.

Nothing here is scheduled. This document records the debt; it does not decide when it is paid.

**Since the audit**, [#259](https://github.com/Lamakira/docuflow/issues/259) addresses B and D, and [#260](https://github.com/Lamakira/docuflow/issues/260) addresses C, E and F. A remains: [#261](https://github.com/Lamakira/docuflow/issues/261) asks for its decision without attaching code to it.
