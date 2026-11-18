/**
 * backfill-legacy-statuses.ts — re-derive the stored Project Status and
 * Opportunity stage of rows that still carry one of v1's own statuses (#372).
 *
 *   npm run db:backfill:legacy-statuses               apply
 *   npm run db:backfill:legacy-statuses -- --dry-run  count, change nothing
 *
 * v1 had statuses v2 never declared: `won_in_review_pm` and
 * `won_in_review_client` (v2 has one `won_in_review`) and the misspelt
 * `in_negociation`. Migration 0012 mapped only v2's statuses, so it stored
 * Project Status `planned` for the two review statuses and copied the raw value
 * into `opportunities.stage`. `shared/projectLifecycle.ts` now reads the three
 * as v2 does; this writes the same reading into the two derived columns, so the
 * Projects board, the register filter and anything reading `opportunities.stage`
 * agree with it.
 *
 * Scoped to the three statuses on purpose. A general "re-derive wherever the
 * stored value differs" would overwrite `on_hold`, which no combined status
 * produces. `crm_projects.status` itself is left as v1 wrote it: renaming the two
 * review statuses would erase the PM / Client distinction.
 *
 * ADR-0017 keeps data movement out of schema migrations, so this is a script.
 * The checkpoint is the data itself: a corrected row no longer matches, so a
 * second run is a no-op. The verifier is the count of rows still wrong.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { crmProjects, opportunities } from "../shared/schema";
import { opportunityStageFromCombined, projectStatusFromCombined } from "../shared/projectLifecycle";
import type { ProjectStatus } from "../shared/schema";
import { openDb, type Report, type ScriptDb } from "./lib/db";
import { isEntryPoint } from "./lib/entrypoint";

const LEGACY_STATUSES = ["won_in_review_pm", "won_in_review_client", "in_negociation"] as const;

interface Target {
  status: string;
  projectStatus: ProjectStatus;
  stage: string;
}

/**
 * What each legacy status reads as, taken from the lifecycle map so the two can
 * never disagree. Refuses to run against a map that does not know them yet,
 * which would otherwise write the raw value back.
 */
function targets(): Target[] {
  return LEGACY_STATUSES.map((status) => {
    const stage = opportunityStageFromCombined(status);
    if (stage === status) {
      throw new Error(`shared/projectLifecycle.ts does not map "${status}"; refusing to backfill`);
    }
    return { status, projectStatus: projectStatusFromCombined(status), stage };
  });
}

interface BackfillResult {
  /** Rows whose stored Project Status was rewritten (0 under --dry-run). */
  projectStatusChanged: number;
  /** Opportunities whose stored stage was rewritten (0 under --dry-run). */
  stageChanged: number;
  /**
   * Stored values still wrong: under --dry-run, what a run would rewrite; after
   * a run, the verifier, 0 when done. The same shape `backfill-crm-links` returns.
   */
  remaining: number;
}

function legacyProjectIds(db: ScriptDb, status: string) {
  return db.select({ id: crmProjects.id }).from(crmProjects).where(eq(crmProjects.status, status));
}

async function countWrongProjectStatus(db: ScriptDb, target: Target): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmProjects)
    .where(and(eq(crmProjects.status, target.status), ne(crmProjects.projectStatus, target.projectStatus)));
  return row?.count ?? 0;
}

async function countWrongStage(db: ScriptDb, target: Target): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(
      and(inArray(opportunities.crmProjectId, legacyProjectIds(db, target.status)), ne(opportunities.stage, target.stage))
    );
  return row?.count ?? 0;
}

async function countRemaining(db: ScriptDb, all: Target[], report: Report = () => {}): Promise<number> {
  let remaining = 0;
  for (const target of all) {
    const projects = await countWrongProjectStatus(db, target);
    const stages = await countWrongStage(db, target);
    report(`${target.status}: ${projects} Project Status → ${target.projectStatus}, ${stages} Opportunity stage → ${target.stage}`);
    remaining += projects + stages;
  }
  return remaining;
}

export async function backfillLegacyStatuses(
  db: ScriptDb,
  options: { dryRun?: boolean } = {},
  report: Report = () => {}
): Promise<BackfillResult> {
  const all = targets();

  if (options.dryRun) {
    return { projectStatusChanged: 0, stageChanged: 0, remaining: await countRemaining(db, all, report) };
  }

  let projectStatusChanged = 0;
  let stageChanged = 0;
  // A few dozen rows at most: one transaction, so a failure leaves nothing half done.
  await db.transaction(async (tx) => {
    for (const target of all) {
      const projects = await tx
        .update(crmProjects)
        .set({ projectStatus: target.projectStatus })
        .where(and(eq(crmProjects.status, target.status), ne(crmProjects.projectStatus, target.projectStatus)))
        .returning({ id: crmProjects.id });
      const stages = await tx
        .update(opportunities)
        .set({ stage: target.stage })
        .where(
          and(
            // A subquery builder only renders SQL; it runs inside this transaction's statement.
            inArray(opportunities.crmProjectId, legacyProjectIds(db, target.status)),
            ne(opportunities.stage, target.stage)
          )
        )
        .returning({ id: opportunities.id });
      projectStatusChanged += projects.length;
      stageChanged += stages.length;
      report(`${target.status}: ${projects.length} Project Status, ${stages.length} Opportunity stage rewritten`);
    }
  });

  return { projectStatusChanged, stageChanged, remaining: await countRemaining(db, all) };
}

if (isEntryPoint(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const { db, close } = openDb();

  backfillLegacyStatuses(db, { dryRun }, (message) => console.log(message))
    .then(({ projectStatusChanged, stageChanged, remaining }) => {
      if (dryRun) {
        console.log(`would rewrite ${remaining} stored values`);
        return;
      }
      console.log(`rewrote ${projectStatusChanged} Project Status and ${stageChanged} Opportunity stage`);
      if (remaining > 0) {
        console.error(`VERIFIER FAILED: ${remaining} legacy rows are still stored wrong`);
        process.exitCode = 1;
        return;
      }
      console.log("verifier: 0 legacy rows stored wrong");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => close());
}
