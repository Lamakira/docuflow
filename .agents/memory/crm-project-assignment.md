---
name: CRM project assignment model
description: How a CRM project's "who works on it" is determined — members vs the deprecated single assignee field
---

## The Rule
CRM project assignment is driven by the many-to-many `project_members` table, NOT the legacy single `crm_projects.assigneeId` column.

- The list/detail APIs hydrate a `members` array on `CrmProjectWithDetails`.
- UI (project list kanban + table) shows the first member's name plus `(+n)` for the rest.
- User/"my projects" filters match against `members`, not `assigneeId`.
- The project detail page no longer exposes an editable "Assigned To" field — membership is managed via the Members section (add/leave).

**Why:** the single-assignee field was buggy (creation defaulted current user but project showed unassigned; non-admins could edit it) and the product moved to multi-user membership. The `assigneeId` column is intentionally KEPT (no destructive migration) but is deprecated and not surfaced in the UI.

**How to apply:**
- When adding any "who is on this project" feature, read from `project_members` / the hydrated `members` array.
- Existing legacy `assigneeId` values were backfilled into `project_members` (insert-only, idempotent via NOT EXISTS). If you ever reintroduce assignee writes, re-run that backfill or add a members fallback.
- Do not reintroduce assignee as the primary assignment mechanism.
