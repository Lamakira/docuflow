# Phase 4 Teams snapshot

- **Recorded:** 2026-08-19
- **Ticket:** [#98](https://github.com/Lamakira/docuflow/issues/98)
- **Source:** local parallel-environment database (`localhost`, database `docuflow_test`). Production connections are refused (ADR-0018); this is the database `0011_drop_teams` is rehearsed against.
- **Verdict:** **zero Team rows** in that environment. Identities only — invite `code` values were never selected.

Teams were a parallel grouping, not the product boundary. They are dropped by `0011_drop_teams` and are not converted into Project Assignments. Existing `project_members` rows stay.

## Query (identities, never secrets)

```sql
SELECT id, name, owner_id, workspace_id
  FROM teams
 ORDER BY id;

SELECT id, team_id, user_id, role
  FROM team_members
 ORDER BY team_id, user_id;

-- Invite rows without the secret `code` column.
SELECT id, team_id, created_by_id, expires_at, max_uses, use_count, is_active
  FROM team_invites
 ORDER BY id;
```

## Result

| Table | Rows |
| --- | ---: |
| `teams` | 0 |
| `team_members` | 0 |
| `team_invites` | 0 |

No Team, membership, or invite identities existed in this environment at drop time. An operator applying `0011` against a database that still has Team rows should run the same query first and append the identities here before the drop.
