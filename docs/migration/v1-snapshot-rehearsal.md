# v1 snapshot rehearsal

- **Recorded:** 2026-10-26
- **Ticket:** [#355](https://github.com/Lamakira/docuflow/issues/355) (ADR-0017, ADR-0018, ADR-0022)
- **Source:** a `pg_dump -Fc` of the v1 production database, exported by the operator on 2026-10-26 at 13:30:39 UTC and held on the operator's machine outside this repository. The export was restored into a scratch database, `docuflow_rehearsal`, on the operator's local PostgreSQL 16. The v2 production database, the Replit development database and the test database were not touched.
- **Verdict:** **the pipeline runs on real v1 data**. It needed two fixes, both made in this ticket: the v1 schema does not fit `--baseline 0002`, and three file columns had no scrub rule. No objects were copied, so the key check against the v1 bucket is still open (see *Still open*).

Counts only. No email, name, file name or storage key from production appears in this record.

## Versions

| | |
| --- | --- |
| v1 server | PostgreSQL 16.15 (Neon) |
| `pg_dump` | 17.11, from the `postgres:17` image |
| Restore target | PostgreSQL 16 (`pgvector/pgvector:pg16`) |
| Export | 30 MB custom format, 258 TOC entries, 36 tables with data |
| Migrated database | 549 MB |

`pg_restore` reported one error, which was ignored: `SET transaction_timeout = 0`. A 17 client writes that setting and a 16 server does not know it. It is harmless.

## The v1 schema is not at 0002

`migrations/README.md` said production should be baselined at `0002_slimy_whirlwind`. A comparison with a database built from `0000`–`0002` gave this. It covered columns, types, nullability, defaults, indexes and constraints.

| Difference | Meaning |
| --- | --- |
| `project_daily_updates` missing: the table, its 2 FKs and its 4 indexes | v1 production never received the daily-update table that `0000` declares |
| `users.can_view_daily_updates` missing | `0002` not applied |
| `project_daily_updates.next_steps`, `blockage_type`, `waiting_on_client` missing | `0001` not applied |
| `idx_time_entries_task_id` extra | `0004` already applied out of band. `0004` uses `IF NOT EXISTS`, so this was expected |

Nothing else differed. The `vector` extension is installed with no `embedding` columns; `0003` adds them `IF NOT EXISTS`. There is one non-public schema, `_system.replit_database_migrations_v1`, Replit's own record of publish-time schema pushes, holding 20 rows. No migration reads it.

So v1 is `0000` minus `project_daily_updates`, and neither baseline fits as is. The fix is `migrations/cutover/v1-project-daily-updates.sql`, the `0000` statements for that one table. It runs once, on the restored copy and never on v1 itself, before `--baseline 0000_fair_amazoness`. The procedure is in `migrations/README.md`.

It is not a journal migration. Every database built from the journal already has the table through `0000`, so the file corrects one database's history, as `--baseline` does, rather than the schema.

No v1 data is lost: the table holds nothing because it never existed. v1's repository has had the daily-update feature since 2026-07-02 (`b68e1ad`), so v1 production either runs code older than that or fails on those screens. This rehearsal does not tell which. v2 brings the feature with an empty table either way.

## Migration run

`npm run db:migrate -- --baseline 0000_fair_amazoness`, after the table was created:

- 1 migration baselined (`0000`) and 43 applied (`0001`–`0043`). `db:migrate:status` shows all 44.
- 57.0 s in total. `0008_giant_quasar`, the `workspace_id` backfill, took 54.1 s because of the 498,642 `agent_activity_events` rows. `0009_flaky_vermin` took 1.7 s. Every other migration took under 150 ms.
- Per migration, in ms, on the replay after the fixes (`schema_migrations.execution_ms`): 0001 7, 0002 3, 0003 7, 0004 4, 0005 31, 0006 16, 0007 132, **0008 45,892**, **0009 1,688**, 0010 104, 0011 21, 0012 102, 0013 56, 0014 63, 0015 114, 0016 63, 0017 32, 0018 4, 0019 36, 0020 71, 0021 9, 0022 44, 0023 3, 0024 7, 0025 8, 0026 2, 0027 3, 0028 3, 0029 5, 0030 4, 0031 55, 0032 8, 0033 24, 0034 16, 0035 80, 0036 25, 0037 5, 0038 5, 0039 86, 0040 115, 0041 39, 0042 4, 0043 116.
- `npm run db:verify -- --against <scratch>` printed **"Schema matches the journal exactly."**
- `npm run db:verify:workspace-backfill` reports **zero** null `workspace_id` in every table.
- The invariants step reports that `jobs` and `dead_letters` are already outside RLS.

`0008` holds its locks for its whole run. On cutover day that falls inside the freeze, so nobody is writing, but it is the step to expect to wait on.

## Row counts

Every table that existed before the migration has the same count after it. Tables created or dropped by the migrations:

| Table | Before | After | Why |
| --- | ---: | ---: | --- |
| `sessions` | 14 | — | Dropped by `0028`; Clerk owns web sessions |
| `teams`, `team_members`, `team_invites` | 0, 0, 0 | — | Dropped by `0011`. **v1 has no Team rows**, so no project access depended on a Team |
| `workspaces` | — | 1 | `0007`: one Workspace, "DocuFlow" |
| `memberships` | — | 13 | One per User: 1 Owner, 2 Administrators, 10 Members |
| `workspace_roles`, `workspace_role_capabilities`, `capabilities` | — | 3, 2, 6 | `0007` |
| `device_enrollments` | — | 86 | `0008`: one per existing Device |
| `opportunities` | — | 117 | `0012`: 117 of the 122 Projects are sales Projects; the other 5 are Internal or documented-only |
| `files` | — | 5 | `0013`: the 5 uploaded binaries among the 10 company documents, same ids and keys |
| `workspace_billing` | — | 1 | `0020`: Plan `legacy`, registry version 1, state Active, 500 seats, no Stripe objects, no trial end |
| `platform_staff` | — | 3 | `0039`: every v1 User with `role = 'admin'` (see *Decisions for the cutover*) |
| `project_daily_updates` | — | 0 | Created by the cutover file |
| `schema_migrations` | — | 44 | |

Every other new table is empty, as expected for a v1 database: jobs, billing, invitations, audit, support, service accounts and webhooks.

Source counts, for the cutover comparison:

| Table | Rows | Table | Rows |
| --- | ---: | --- | ---: |
| `agent_activity_events` | 498,642 | `notifications` | 85 |
| `agent_processed_batches` | 186,386 | `project_members` | 72 |
| `time_entry_screenshots` | 16,441 | `desktop_releases` | 24 |
| `time_entries` | 464 | `crm_module_fields` | 24 |
| `crm_project_stage_history` | 335 | `agent_pairing_codes` | 18 |
| `documents` | 238 | `users` | 13 |
| `video_transcripts` | 170 | `company_documents` | 10 |
| `crm_project_notes` | 128 | `crm_tags` | 7 |
| `crm_projects`, `projects` | 122, 122 | `company_document_folders` | 4 |
| `tasks` | 111 | `crm_project_tags` | 3 |
| `crm_clients` | 87 | `crm_modules` | 2 |
| `devices` | 86 | `audio_recordings` | 1 |

These tables are empty: `crm_contacts`, `crm_custom_field_values`, `reminders`, `org_settings`, `document_embeddings` and `company_document_embeddings`.

`org_settings` has **no row** in v1. `npm run db:seed` writes the default one; the time zone set by `0042` and the Tracking Policy both come from that row.

Run on the migrated database **with `NODE_ENV=production`**, `db:seed` skipped the 2 CRM modules already present and seeded the `default` row, with `America/Toronto`. Without `NODE_ENV=production` it would also create the demo Workspace "Harbour View". In development it would also give every Member a Membership there. On cutover day the variable is not optional.

## Storage

`npm run snapshot:check` before the scrub found 4 columns with absolute URLs into the v1 bucket. The v1 bucket is a Replit App Storage bucket, `replit-objstore-…`.

| Column | Rows | Shape | Rule |
| --- | ---: | --- | --- |
| `desktop_releases.storage_url` | 22 | installer URL | existing: `→ /downloads/{platform}` |
| `company_documents.storage_path` | 5 | `<bucket>/.private/uploads/<uuid>` | **new**: `→ /objects/{key}` |
| `files.storage_path` | 5 | same values as the documents | **new**: `→ /objects/{key}` |
| `crm_project_notes.attachments` | 3 | JSON text, `<bucket>/public/uploads/<uuid>` | **new**: `→ /public-objects/{key}` |

The new rules follow from ADR-0022's key-preserving copy: an object keeps its name, so the faithful rewrite is the path form v2 itself stores. Anything that does not fit the expected prefix refuses the run, and the scrub is now one transaction.

`npm run snapshot:scrub` on a fresh restore rewrote 5 + 5 + 3 + 22 rows. The re-check printed **"storage URLs: clean"**.

Keys the database names: **16,446**.
- 16,346 screenshots under `/objects/agent-screenshots/…`.
- 95 screenshot rows whose key is `pending-<timestamp>`. In v1 these uploads never finished, so no object exists for them. They will show as dangling in the key check. Keep them or delete them at cutover; either way it is a decision.
- 5 Files.

The 3 public note attachments are not in the key check, which reads only `storage_key` / `storage_path` columns.

## Identity

`npm run identity:import:users -- --dry-run`, as `docuflow_app`:

| | |
| --- | ---: |
| Users | 13 |
| already linked | 0 |
| password-set invite | **13** |

No password is imported, so every v1 User sets one through an invitation.

## Boot

The server started on the migrated database as `docuflow_app`, with RLS enforced, on port 5099. It used the local `.env`, so Clerk was the development instance. The boot ran twice: on the first run, and on the replay after the fixes, with the scrub and seed applied.

- `/health` returned 200;
- `/api/ping` returned 200;
- `/api/auth/config` returned 200;
- no span ended in error;
- the boot log has no "does not exist", "permission denied", row-level security or other `ERROR` line.

Sign-in was not exercised: Clerk production does not exist yet.

## Still open

- **The key check against the v1 bucket.** It needs the operator's listing of the v1 bucket's object keys. Then run `npm run snapshot:check -- --keys <listing>` and record the number of dangling keys here. Expect at least the 95 `pending-…` rows.
- **Screenshot fingerprints.** 16,346 live captures need `scripts/backfill-screenshot-fingerprints.ts`. It reads every image, so it runs where the objects are, after the copy. This is a cutover step.

## Decisions for the cutover

These are recorded as inputs, not settled here:

1. **Platform Staff.** `0039` copies the 3 v1 admins into `platform_staff`, under `migrated-user:<id>` subjects. Platform Staff is DocuFlow-operator authority across Workspaces, not Workspace administration. Decide whether those three should be staff, and remove the rows that should not be before opening the back office.
2. **The 95 pending screenshots.** Keep them or delete them.
3. **Data already in v2 production.** The pipeline converts a v1 database; it does not merge into an existing one.
4. **Identity and email.** The 13 invitations need Clerk production and a verified Resend domain.
5. **Residency** (ADR-0024).
6. **The time zone.** `0042` sets `America/Toronto` on existing `org_settings` rows. v1 has none, so the zone comes from `db:seed`, which also writes `America/Toronto`. Check it is the team's: it counts the Daily Update workday.

## The rehearsal, step by step

All against the scratch database, with `DATABASE_MIGRATE_URL` and `DATABASE_URL` set explicitly on every command:

1. `pg_restore --no-owner --no-acl` of the export.
2. Count every table.
3. `psql -f migrations/cutover/v1-project-daily-updates.sql`
4. `npm run db:migrate -- --baseline 0000_fair_amazoness`, then `npm run db:migrate:status`.
5. `npm run db:verify -- --against <scratch> --reference <local server>`
6. `npm run db:verify:workspace-backfill`
7. Count every table again.
8. `NODE_ENV=production npm run db:seed`
9. `npm run snapshot:check`, then `npm run snapshot:scrub`, then re-check.
10. `npm run identity:import:users -- --dry-run`, as the app role.
11. Boot the server as the app role and probe `/health`.

Once the fixes were in, every step was replayed on a fresh restore, following the procedure in `migrations/README.md`. Only the key check was left out, because it waits on the bucket listing. The replay gave:
- 43 migrations applied;
- the schema matching the journal exactly;
- zero null `workspace_id`;
- the same row counts as the first run, plus the seeded `org_settings` row;
- clean storage;
- 13 invitations;
- a clean boot.
