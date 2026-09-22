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
| `/crm` | `/projects` | redirect |
| `/crm/project/new`, `/crm/project/:id` | `/projects?new=1`, dossier | redirect |
| `/crm/client/new`, `/crm/client/:id` | `/clients?new=1`, client record | redirect |
| `/documentation` | `/project-documentation` | redirect |
| `/company-documents` | `/documents` | redirect |
| `/company-documents/:id/edit`, `/view` | `V2DocumentPage` | rewritten |
| `/project/:id` | `V2LegacyProjectPage` | rewritten |
| `/document/:id` | `V2DocumentPage` | rewritten |
| `/daily-update` | `/daily-update` | rewritten |
| `/admin`, `/admin/create`, `/admin/user/:id` | `/administration` | redirect — **see A** |
| `/admin/analytics` | `/administration` | redirect — **see B** |
| `/admin/daily-updates` | `/daily-updates` | redirect |
| `/time-tracking` | `/time` | redirect |
| `/time-tracking/dashboard` | `/time/stats` | redirect |
| `/time-tracking/projects` | `/time/projects` | redirect |
| `/time-tracking/devices`, `/download` | `/devices` | redirect |
| `/time-tracking/screencasts` | `/activity` | redirect |
| `/devices` | `/devices` | rewritten |
| `/help-center`, `/help-center/:slug` | `/help` | redirect |
| `/invitations/:token` | same component in both | shared |

A redirect is not a migration. Three of them land somewhere that cannot do what the origin did; those are A, B and D below.

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

### B. Four analytics dashboards

```
/api/admin/analytics/alerts
/api/admin/analytics/evidence-quality
/api/admin/analytics/productivity
/api/admin/analytics/screenshots
```

v2's Administration builds five analytics paths (`administration.ts:511-527`): overview, activity, coverage, devices, export. The four above are reachable only from v1's `/admin/analytics`, which now redirects to a screen that does not draw them.

`alerts` is the one to weigh: `tests/characterization/admin-analytics.test.ts` shows it answering `highIdleUsers`, `stalledDevices` and `runningWithoutScreenshots` — the operational warnings, and the only place in the product that names a device that has stopped reporting.

### C. Project record depth

```
/api/crm/projects/:id/clone
/api/crm/projects/:id/stage-history
/api/crm/projects/:id/tags/:id
/api/crm/projects/:id/members/:id
/api/crm/projects/:id/documentation
/api/crm/tags
/api/crm/tags/:id
/api/projects/:id
```

Cloning a Project, reading its stage history, and the Tag vocabulary in full — create, edit, delete, attach, detach — exist only in v1. The v2 dossier has no `kanban`, no `tags` and no `tagIds` anywhere in `client/src/v2`.

Removing a named member from a Project is v1-only too; v2 reads `/api/crm/projects` and the dossier, and offers no member removal.

### D. The Kanban board

```
/api/crm/projects/all
/api/crm/projects/all-kanban
```

v1's `/crm` offers a Kanban view over the portfolio. `/crm` redirects to `/projects`, which is a register. The word `kanban` does not appear anywhere under `client/src/v2`.

This is the redirect most likely to be read as a loss by someone who used it daily.

### E. Documents

```
/api/company-document-folders/:id
/api/documents/:id/duplicate
/api/projects/:id/documents/reorder
/api/document-attachments
```

Editing or deleting a folder, duplicating a Document, reordering a Project's Documents, and Document attachments. v2 Documents creates folders and uploads; it does not amend a folder or duplicate a Document.

### F. Remainder

```
/api/objects/upload-public
/api/help-center/screenshot-map
/api/screencasts/timezones
```

Public object upload, the Help Center screenshot map, and the Screencasts timezone list. Listed so the next reader could confirm rather than assume — **confirmed 2026-09-22, and two of the three are real gaps**:

- **`/api/objects/upload-public`** — reached from `client/src/pages/CrmProjectPage.tsx` only. No v2 caller. A gap.
- **`/api/help-center/screenshot-map`** — reached from `client/src/components/help-center/HelpScreenshot.tsx` only. v2's Help Center has no equivalent, so a help article that relies on a screenshot renders without one. A gap.
- **`/api/screencasts/timezones`** — covered, but not the way this section guessed. v2 edits `allowedTimezones` through `/api/workspace/settings`, not `/api/admin/org-settings`, and with a **free-text input** (`V2Administration.tsx:546`, `addAllowedTimezone`) rather than a choice from the list endpoint. Typing a timezone where v1 offered a list is a small step down, not a missing capability.

The two gaps are carried by [#260](https://github.com/Lamakira/docuflow/issues/260).

---

## What to do with this

The gaps are not one decision. They are four:

1. **A needs a decision before it needs code.** The platform directory is not a Workspace surface, and dropping it into the Workspace chrome would repeat the mistake [#238](https://github.com/Lamakira/docuflow/issues/238) fixed.
2. **B and D are migrations** — the screens exist in v1 and have a clear home in v2.
3. **C and E are depth** — each one small, together the difference between a rewrite that looks finished and one that is.
4. **F was a check**, now done — and it produced work, not a clean bill. Two of its three endpoints are gaps, carried by [#260](https://github.com/Lamakira/docuflow/issues/260).

Nothing here is scheduled. This document records the debt; it does not decide when it is paid.

**Since the audit**, the four have been written up: [#259](https://github.com/Lamakira/docuflow/issues/259) carries B and D, [#260](https://github.com/Lamakira/docuflow/issues/260) carries C, E and F's two gaps, and [#261](https://github.com/Lamakira/docuflow/issues/261) asks for A's decision without attaching code to it.
