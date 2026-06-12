---
name: CRM project assignment model
description: How a CRM project's "who works on it" is determined — members vs the deprecated single assignee field
---

## The Rule
CRM project assignment is driven by the many-to-many `project_members` relationship, NOT the legacy single `crm_projects.assigneeId` column.

**Why:** the single-assignee field was buggy and the product moved to multi-user membership. The `assigneeId` column is intentionally kept (no destructive migration) but is deprecated and not surfaced in the UI.

**How to apply:**
- Any "who is on this project" feature (display, filters, "my projects") must read from project members, not `assigneeId`.
- The CRM list keeps a read-time fallback: when a project has no members it falls back to its legacy `assignee` for display/filtering. This is transitional — it exists so un-migrated projects (notably in production, where `project_members` starts empty after the schema is first published) still render correctly. Do NOT remove this fallback until all environments' legacy assignees are migrated into `project_members`.
- Dev legacy `assigneeId` values were backfilled into `project_members`. Production was NOT backfilled (agent has read-only prod access); the fallback covers it instead.
- Do not reintroduce assignee as the primary assignment mechanism.
