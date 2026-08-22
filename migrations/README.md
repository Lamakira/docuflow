# Migration journal

Every schema change DocuFlow has, in one ordered list, applied by one command.
Nothing else changes the schema: the server does no DDL at boot, and no
environment is built by pushing `shared/schema.ts` at a database. `drizzle-kit
push` survives in exactly one place — `tests/smoke/migrations.test.ts`, which
pushes into a throwaway database purely to diff the result against this journal.

## The journal

`meta/_journal.json` is the order. It is drizzle-kit's own index, and the runner
reads it rather than listing the directory — a `.sql` file that is not in the
journal is not part of it and is never applied.

| # | Migration | What it does |
| - | --------- | ------------ |
| 0000 | `0000_fair_amazoness.sql` | The whole schema as it stood when the journal was created: 36 tables with their indexes and foreign keys. |
| 0001 | `0001_dashing_rick_jones.sql` | `project_daily_updates`: next steps, blockage type, waiting-on-client. |
| 0002 | `0002_slimy_whirlwind.sql` | `users.can_view_daily_updates`. |
| 0003 | `0003_vector_embeddings.sql` | The `vector` extension and the two `embedding vector(1536)` columns the retrieval paths write. |
| 0004 | `0004_time_entries_task_id_index.sql` | `idx_time_entries_task_id` — created by boot on every start, by no migration until now. |
| 0005 | `0005_jobs.sql` | `jobs` and `dead_letters` — the Postgres jobs port (#82). Workspace id is nullable; no Workspace is seeded. `IF NOT EXISTS`, so a database already pushed from `shared/schema.ts` is a no-op. |
| 0006 | `0006_square_wild_child.sql` | `jobs.occurrence_key` (unique) and `scheduler_leases` — due-reminder Jobs on the Worker (#83). |
| 0007 | `0007_dark_sasquatch.sql` | Workspace, Membership, Workspace Role, and Capability tables, then one named Workspace and a Membership per user (#93). `org_settings` is copied onto Workspace Tracking Policy and left in place. |
| 0008 | `0008_giant_quasar.sql` | Nullable `workspace_id` on Workspace-owned tables, journaled SQL backfill onto the seeded Workspace, and Device Enrollment for existing Devices (#94). Does not apply `NOT NULL`. |
| 0009 | `0009_flaky_vermin.sql` | `workspace_id` `NOT NULL` on Workspace-owned tables, composite uniques that include it, and composite FKs so relationships cannot cross Workspaces (#96). Leaves `org_settings` and user authority columns in place. |
| 0010 | `0010_workspace_rls.sql` | Row-level security on Workspace-owned tables and the `docuflow_app` role that cannot bypass it (#97). Migrations keep a separate credential (`DATABASE_MIGRATE_URL`). |
| 0011 | `0011_drop_teams.sql` | Drops `teams`, `team_members`, and `team_invites` after snapshotting identities into `docs/migration/` (#98). Does not convert Teams into Project Assignments. |
| 0012 | `0012_colossal_nuke.sql` | Splits Opportunity from Project (#114). Adds `opportunities` and `crm_projects.project_status`, backfills sales rows, leaves Internal and documented-only Projects without an Opportunity, and keeps legacy Project ids. Combined `status` stays for HTTP. |
| 0013 | `0013_old_butterfly.sql` | Splits Document from File (#115). Adds `files` and `company_documents.access`, copies uploaded binaries onto File rows with the same ids and object keys, defaults Document Access to everyone in the Workspace, and drops embeddings for the Index Artifact rebuild. Combined `company_documents` stays for HTTP. |
| 0014 | `0014_cooing_goblin_queen.sql` | Knowledge object-storage port and Index Artifacts (#116). Adds two-phase upload slots, File scan status and hold, and derived `index_artifacts`. Existing Files stay available on their current object keys. |
| 0020 | `0020_useful_impossible_man.sql` | Plan Registry billing pin, Entitlement overrides, and Audit Events (#139). Pins the seeded Workspace to Plan `legacy` at registry version 1, Active, with no Stripe objects. |
| 0021 | `0021_tiny_scrambler.sql` | Billing state machine columns on `workspace_billing` (#140): trial end, period end, and cancel-at-period-end. |

`0000` is a squash, not the beginning of history. The schema it captures was
built up by the hand-numbered files now in `legacy/` and by DDL that ran on
every server boot; `drizzle-kit generate` produced `0000` from
`shared/schema.ts` after all of it had been applied.

`0003` and `0004` are the two pieces that squash missed, both for the same
reason: `drizzle-kit generate` writes down what `shared/schema.ts` declares, and
neither had ever been declared there. `0003` is the pgvector columns
`server/embeddings.ts` has always required, applied to production out of band.
`0004` is an index the boot-time DDL created that no migration did — found by
`tests/smoke/boot-ddl-parity.test.ts`, which is now what keeps the journal and
the deleted boot DDL comparable.

`legacy/` holds the superseded hand-numbered files, `002_s2_tasks.sql` through
`011_help_center_screenshots.sql`, along with the one down migration that was
ever written, `002_s2_tasks.down.sql`. They are kept as the audit trail of what
was applied to production before the journal existed. Every one of their effects
is already inside `0000` — running any of them is never correct, and the down
file is not a rollback path (see *Adding a migration* below).

## Commands

```bash
npm run db:migrate                   # apply everything pending
npm run db:migrate:status            # list applied and pending, change nothing
npm run db:migrate -- --dry-run      # print what would run, change nothing
npm run db:verify                    # does a real database match the journal?
npm run db:verify:workspace-backfill # remaining null workspace_id per table (#94)
npm run db:generate                  # write a new migration from shared/schema.ts
```

`scripts/migrate.ts` applies each migration in its own transaction and records
it in `schema_migrations` with a checksum, when it ran, and how long it took. A
migration whose file changes after it has been applied stops the next run: the
database can no longer be made to match the file, so the fix is a new migration,
never an edit to a shipped one.

`--status` and `--dry-run` change nothing at all, and that includes the ledger:
against a database with no `schema_migrations` they report everything as pending
rather than creating the table to discover it is empty. Either is safe to point
at a database you are only asking about.

The runner is a command, never a server import. ADR-0016 runs it as a gated
pre-deploy step; nothing about it belongs on the request path or on boot.

### The same journal, from the image

A host that deploys the container has no checkout to run `npm run db:migrate`
from, and no `tsx` to run it with. So `scripts/migrate.ts` is built into the
image as a second entry point (#35), reading the `migrations/` directory copied
in beside it: `node dist/migrate.mjs` is every command above, same file, same
journal, same flags — one runner built two ways, not two runners. Wherever this
document says `npm run db:migrate --`, that is the other half of the sentence.

`docs/CONTAINER.md` has the `docker run` recipe and is the one place it is
written out; `tests/smoke/migrate-bundle.test.ts` is what keeps the built form
honest.

## Auditing a real database

```bash
npm run db:verify                              # the database you are configured for
npm run db:verify -- --against "$PROD_URL"     # another one
```

The journal is only the whole truth if nothing else ever wrote DDL. Twice now
something did — the pgvector columns in `0003` and the index in `0004` both
reached a database without passing through a migration, and both went unnoticed
because everything anyone compared was built from this repository.
`tests/smoke/migrations.test.ts` cannot catch that: it diffs the journal against
`shared/schema.ts`, and a column that exists only in production is in neither.

`npm run db:verify` closes that gap. It builds a throwaway database from the
journal on the **reference** server — your local one unless `--reference` says
otherwise — introspects both, and reports every column, index, and constraint the
two disagree about. `EXTRA` is DDL applied out of band; `MISSING` is a migration
never applied. It exits 1 on either, so it can gate a deploy (ADR-0016).

The audited database is only ever read. Nothing is created, dropped, or written
there, which is what makes `--against "$PROD_URL"` a safe thing to run.

## A new database

```bash
npm run db:migrate                   # schema
npm run db:seed                      # default CRM modules and fields, org_settings row
npm run db:backfill:crm-links        # only where legacy projects predate the CRM
```

`db:seed` and `db:backfill:crm-links` are `scripts/seed-defaults.ts` and
`scripts/backfill-crm-links.ts` — the two things `server/index.ts` used to do on
every start. Both are idempotent and safe to re-run; the backfill reports what
it linked and verifies nothing is left behind.

## A database that predates the journal

Production was built with `drizzle-kit push` and has no migration record, so a
first `db:migrate` there would try to create tables that already exist. Record
the history it already has, once:

```bash
npm run db:migrate -- --baseline 0002_slimy_whirlwind
```

That writes `0000`–`0002` into `schema_migrations` without running them, then
applies `0003` onwards — later ones written with `IF NOT EXISTS` precisely
because what they add may already be there. Every deploy after that is an
ordinary `npm run db:migrate`.

Check the schema really does contain everything through the version being
baselined before running it: `npm run db:verify -- --against "$URL"` is that
check, and it reports anything the database has that the journal does not.
`npm run db:migrate:status` afterwards should show every migration applied.

## Adding a migration

1. Change `shared/schema.ts`.
2. `npm run db:generate` — writes the `.sql` file, its snapshot, and the journal
   entry.
3. Read the generated SQL. Drizzle does not know about extensions, and it
   generates a drop for anything it cannot see; both are why `0003` is
   hand-edited. Add `IF NOT EXISTS` where an environment may already have what
   the migration adds — `0003` and `0004` are the worked examples.
4. `npm run db:migrate` against a local database, then `npm test`.

Two rules, from ADR-0017:

- **Schema migrations stay pure DDL and fast.** A migration that moves data
  holds a lock for as long as the data takes. Data movement is a script in
  `scripts/` with a checkpoint and a verifier — `backfill-crm-links.ts` is the
  worked example. **Exception:** `0007` seeds the Workspace and Memberships, and
  `0008` backfills `workspace_id`, in the journal (Spec #92) because the Worker
  that would have claimed that Job is deferred (#86). `0012` splits Opportunity
  from Project in the journal (Spec #112 / #114) because the smoke seam is the
  journal, the same exception class as #92. `0013` splits Document from File
  the same way (Spec #112 / #115). `0014` lands the Knowledge object-storage
  port and Index Artifact tables the same way (Spec #112 / #116). `0020` pins the
  seeded Workspace to Plan `legacy` in the journal (#139) so Entitlements exist
  without a Stripe object.
- **Expand and contract.** Add the new shape, move the reads and writes, drop
  the old one in a later deploy. Rollback is redeploying the previous image,
  never a down migration, so no migration may make the previous image unable to
  run.

Three things check this journal, and they check different things:

- `tests/smoke/migrations.test.ts` builds a database from the journal and another
  from `shared/schema.ts` and diffs them, so a migration someone forgot to
  generate fails in CI rather than in production.
- `tests/smoke/boot-ddl-parity.test.ts` holds the DDL `server/index.ts` ran on
  every boot before #24 deleted it, and checks the journal still produces the
  same tables, columns, constraints, and indexes that DDL did. `0004` exists
  because it did not. `#94` added `workspace_id` after boot; that stamp is
  stripped from both sides so the comparison stays the boot-owned shape.
- `npm run db:verify` compares the journal to a database that really exists,
  which is the only one of the three that can see DDL applied out of band.
