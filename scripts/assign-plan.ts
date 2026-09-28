/**
 * assign-plan.ts — move Workspaces between Plans outside Checkout (#299, ADR-0027).
 *
 *   npm run billing:assign-plan -- --migrate-v1 [--dry-run]
 *       every v1 Workspace whose Plan has a successor (`pro` → `business`)
 *   npm run billing:assign-plan -- --workspace <id> --plan enterprise [--seats <n>] [--dry-run]
 *       one Workspace onto a sales-led Plan agreed outside Checkout
 *
 * Each change is audited as the system actor and bumps the authorization
 * version, with the same Outbox event a Checkout Plan change emits, so sessions
 * and Devices pick up the new Entitlements. Stripe is not called: the migrated
 * Plan's Subscription keeps its price, and its Product's `docuflow_plan`
 * metadata is what the webhook reads, so set it to the new Plan in Stripe too.
 *
 * Re-running is a no-op: a Workspace already on the target is skipped.
 */

import { and, eq } from "drizzle-orm";
import { auditEvents, outboxEvents, workspaceBilling } from "../shared/schema";
import {
  PLAN_MIGRATIONS,
  PLAN_REGISTRY,
  PLAN_REGISTRY_VERSION,
  isPlanKey,
  type PlanKey,
} from "../server/modules/billing/planRegistry";
import { openDb, type Report, type ScriptDb } from "./lib/db";
import { isEntryPoint } from "./lib/entrypoint";

const ENTITLEMENTS_CHANGED = "billing.entitlements_changed";

export interface AssignResult {
  changed: string[];
  skipped: string[];
}

type Target = { planKey: PlanKey; registryVersion: number; seats?: number };

async function assignOne(
  db: ScriptDb,
  workspaceId: string,
  target: Target,
  reason: "registry_migration" | "sales_assignment",
  dryRun: boolean,
  report: Report
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workspaceBilling)
      .where(eq(workspaceBilling.workspaceId, workspaceId))
      .for("update")
      .limit(1);
    if (!row) throw new Error(`Workspace ${workspaceId} has no billing row.`);
    if (
      row.planKey === target.planKey &&
      row.registryVersion === target.registryVersion &&
      (target.seats === undefined || row.purchasedSeatCapacity === target.seats)
    ) {
      report(`skip ${workspaceId}: already ${target.planKey} v${target.registryVersion}`);
      return false;
    }
    const from = `${row.planKey} v${row.registryVersion}`;
    report(`${dryRun ? "would move" : "move"} ${workspaceId}: ${from} → ${target.planKey} v${target.registryVersion}`);
    if (dryRun) return true;

    const authorizationVersion = row.authorizationVersion + 1;
    await tx
      .update(workspaceBilling)
      .set({
        planKey: target.planKey,
        registryVersion: target.registryVersion,
        ...(target.seats === undefined ? {} : { purchasedSeatCapacity: target.seats }),
        authorizationVersion,
        updatedAt: new Date(),
      })
      .where(eq(workspaceBilling.workspaceId, workspaceId));
    await tx.insert(auditEvents).values({
      workspaceId,
      actorKind: "system",
      actorId: null,
      action: "billing.plan_change",
      resourceType: "workspace_billing",
      resourceId: workspaceId,
      payload: {
        from: row.planKey,
        to: target.planKey,
        fromRegistryVersion: row.registryVersion,
        toRegistryVersion: target.registryVersion,
        ...(target.seats === undefined ? {} : { fromSeats: row.purchasedSeatCapacity, toSeats: target.seats }),
        reason,
      },
    });
    await tx.insert(outboxEvents).values({
      workspaceId,
      type: ENTITLEMENTS_CHANGED,
      version: 1,
      actorKind: "system",
      actorId: null,
      aggregateType: "workspace_billing",
      aggregateId: workspaceId,
      payload: { authorizationVersion },
    });
    return true;
  });
}

/** Every Workspace pinned to an older registry whose Plan has a named successor. */
export async function migrateV1Plans(
  db: ScriptDb,
  options: { dryRun?: boolean } = {},
  report: Report = () => {}
): Promise<AssignResult> {
  const result: AssignResult = { changed: [], skipped: [] };
  for (const [version, mapping] of Object.entries(PLAN_MIGRATIONS)) {
    for (const [fromPlan, toPlan] of Object.entries(mapping)) {
      if (!toPlan) continue;
      const rows = await db
        .select({ workspaceId: workspaceBilling.workspaceId })
        .from(workspaceBilling)
        .where(and(eq(workspaceBilling.planKey, fromPlan), eq(workspaceBilling.registryVersion, Number(version))));
      for (const { workspaceId } of rows) {
        const moved = await assignOne(
          db,
          workspaceId,
          { planKey: toPlan, registryVersion: PLAN_REGISTRY_VERSION },
          "registry_migration",
          options.dryRun ?? false,
          report
        );
        (moved ? result.changed : result.skipped).push(workspaceId);
      }
    }
  }
  return result;
}

/** One Workspace onto a current Plan — how Enterprise is granted. */
export async function assignPlan(
  db: ScriptDb,
  input: { workspaceId: string; planKey: string; seats?: number; dryRun?: boolean },
  report: Report = () => {}
): Promise<AssignResult> {
  if (!isPlanKey(input.planKey) || !PLAN_REGISTRY[PLAN_REGISTRY_VERSION]?.[input.planKey]) {
    throw new Error(`"${input.planKey}" is not a Plan in registry version ${PLAN_REGISTRY_VERSION}.`);
  }
  if (input.seats !== undefined && (!Number.isInteger(input.seats) || input.seats < 1)) {
    throw new Error("--seats must be a whole number of at least 1.");
  }
  const moved = await assignOne(
    db,
    input.workspaceId,
    { planKey: input.planKey, registryVersion: PLAN_REGISTRY_VERSION, seats: input.seats },
    "sales_assignment",
    input.dryRun ?? false,
    report
  );
  return moved ? { changed: [input.workspaceId], skipped: [] } : { changed: [], skipped: [input.workspaceId] };
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (isEntryPoint(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const workspaceId = argValue("--workspace");
  const planKey = argValue("--plan");
  const seats = argValue("--seats");
  const { db, close } = openDb();
  const log: Report = (message) => console.log(message);

  const run = process.argv.includes("--migrate-v1")
    ? migrateV1Plans(db, { dryRun }, log)
    : workspaceId && planKey
      ? assignPlan(db, { workspaceId, planKey, seats: seats === undefined ? undefined : Number(seats), dryRun }, log)
      : Promise.reject(new Error("Use --migrate-v1, or --workspace <id> --plan <plan> [--seats <n>]. Add --dry-run to preview."));

  run
    .then(({ changed, skipped }) => {
      console.log(`${dryRun ? "would change" : "changed"} ${changed.length}, skipped ${skipped.length}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => close());
}
