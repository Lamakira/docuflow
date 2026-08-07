/**
 * backfill-crm-links.ts — give every documentation project that predates the CRM
 * a `crm_projects` row, so it is reachable through the CRM like everything else.
 *
 *   npm run db:backfill:crm-links               apply
 *   npm run db:backfill:crm-links -- --dry-run  count, change nothing
 *
 * This ran on every server boot (`storage.linkOrphanProjectsToCrm()` from
 * `server/index.ts`) — a full table scan and a write path on the startup path of
 * every deploy, for a one-time correction. ADR-0017 keeps data movement out of
 * schema migrations and out of boot; a backfill is a script with a checkpoint,
 * so this is one.
 *
 * The outcome is frozen exactly as boot produced it: status `documented`,
 * documentation enabled, no client, no assignee, no dates, and the same
 * `comments` marker, which is what tells a migrated row from one a person made.
 *
 * The checkpoint is the data itself. A project stops being an orphan the moment
 * its row lands, so an interrupted run resumes simply by being run again, and a
 * completed run is a no-op. Nothing else has to be recorded, and there is no
 * checkpoint file to go stale against the database.
 */

import { eq, isNull, sql } from "drizzle-orm";
import { crmProjects, projects } from "../shared/schema";
import { openDb, type ScriptDb } from "./lib/db";

/** Rows per pass. Bounds memory and transaction size on a first run. */
const BATCH_SIZE = 200;

/** What boot wrote into `comments` for every row it created. */
const MIGRATION_MARKER = "Auto-migrated from standalone documentation project";

interface BackfillResult {
  linkedCount: number;
  /** Projects that could not be linked; each was logged with its error. */
  failedCount: number;
  /** Orphans left behind — the verifier. Anything but 0 after a run is a fault. */
  remainingOrphans: number;
}

async function orphanBatch(db: ScriptDb, limit: number) {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .leftJoin(crmProjects, eq(projects.id, crmProjects.projectId))
    .where(isNull(crmProjects.id))
    .limit(limit);
}

async function countOrphans(db: ScriptDb): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .leftJoin(crmProjects, eq(projects.id, crmProjects.projectId))
    .where(isNull(crmProjects.id));
  return row?.count ?? 0;
}

export async function backfillCrmLinks(
  db: ScriptDb,
  options: { dryRun?: boolean } = {},
  report: (message: string) => void = () => {}
): Promise<BackfillResult> {
  if (options.dryRun) {
    const remainingOrphans = await countOrphans(db);
    report(`${remainingOrphans} orphan projects would be linked`);
    return { linkedCount: 0, failedCount: 0, remainingOrphans };
  }

  let linkedCount = 0;
  // A project whose insert failed stays an orphan and would come back in the
  // next batch forever. Remembering what this run already tried is what ends
  // the loop; the failures are reported and left for a human.
  const attempted = new Set<string>();

  for (;;) {
    const batch = (await orphanBatch(db, BATCH_SIZE)).filter((p) => !attempted.has(p.id));
    if (batch.length === 0) break;

    for (const project of batch) {
      attempted.add(project.id);
      try {
        await db.insert(crmProjects).values({
          projectId: project.id,
          clientId: null,
          status: "documented",
          assigneeId: null,
          startDate: null,
          dueDate: null,
          actualFinishDate: null,
          comments: MIGRATION_MARKER,
          documentationEnabled: 1,
        });
        linkedCount++;
        report(`linked ${project.name} (${project.id})`);
      } catch (error) {
        report(`FAILED ${project.name} (${project.id}): ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  const remainingOrphans = await countOrphans(db);
  return { linkedCount, failedCount: attempted.size - linkedCount, remainingOrphans };
}

const isEntryPoint = process.argv[1]?.endsWith("backfill-crm-links.ts");

if (isEntryPoint) {
  const dryRun = process.argv.includes("--dry-run");
  const { db, close } = openDb();

  backfillCrmLinks(db, { dryRun }, (message) => console.log(message))
    .then(({ linkedCount, failedCount, remainingOrphans }) => {
      if (dryRun) return;
      console.log(`linked ${linkedCount}, failed ${failedCount}`);
      // The verifier ADR-0017 asks every backfill to carry: the run is only done
      // when nothing is left behind.
      if (remainingOrphans > 0) {
        console.error(`VERIFIER FAILED: ${remainingOrphans} projects still have no CRM row`);
        process.exitCode = 1;
        return;
      }
      console.log("verifier: 0 orphan projects remain");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => close());
}
