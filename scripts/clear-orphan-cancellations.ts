/**
 * clear-orphan-cancellations.ts - the clean-up after F102.
 *
 *   npm run billing:clear-orphan-cancellations             # dry run
 *   npm run billing:clear-orphan-cancellations -- --apply
 *   npm run billing:clear-orphan-cancellations -- --check-stripe   # also reads Stripe
 *
 * Cancel at period end used to be set without asking Stripe. Where there is no
 * live Subscription (no Stripe id, or not Active or Past due) the flag stayed
 * for good and the page said `Renews -`: `--apply` clears it, audited as the
 * system actor. Where there is one, Stripe's next event put the flag back to
 * false and the customer goes on paying: those are listed, never changed, for
 * someone to settle with the customer. Live Subscriptions flagged to end are
 * listed too, never changed: one the old code flagged was never sent to Stripe.
 * `--check-stripe` reads each from Stripe (`STRIPE_SECRET_KEY`, read only) and
 * says whether it agrees; clicking Cancel again sends one that does not.
 *
 * Connects as the owner (`DATABASE_MIGRATE_URL`, else `DATABASE_URL`) and prints
 * the masked target first. Re-running is a no-op once the flags are cleared.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { auditEvents, workspaceBilling } from "../shared/schema";
import { maskDatabaseUrl, requireMigrateDatabaseUrl } from "../shared/databaseUrl";
import type { BillingProvider } from "../server/modules/billing/billingProvider";
import { createBillingProvider } from "../server/modules/billing/createBillingProvider";
import { openDb, type Report, type ScriptDb } from "./lib/db";
import { isEntryPoint } from "./lib/entrypoint";

const CANCEL = "billing.cancel_at_period_end";
const UNDO = "billing.cancel_at_period_end_undone";

export interface OrphanCancellations {
  /** The flag set with no live Subscription. */
  orphans: string[];
  cleared: string[];
  /** A live Subscription whose last cancel or undo is a user's cancel, while the flag is false. */
  lost: string[];
  /** A live Subscription flagged to end, and whether Stripe agrees. */
  cancelling: Array<{ workspaceId: string; stripe: StripeAnswer }>;
}

export type StripeAnswer = "agrees" | "disagrees" | "not checked" | "could not answer";

function isLive(row: { stripeSubscriptionId: string | null; billingState: string }): boolean {
  return row.stripeSubscriptionId != null && (row.billingState === "Active" || row.billingState === "PastDue");
}

async function clearOne(db: ScriptDb, workspaceId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workspaceBilling)
      .where(eq(workspaceBilling.workspaceId, workspaceId))
      .for("update")
      .limit(1);
    if (!row || !row.cancelAtPeriodEnd || isLive(row)) return false;
    await tx
      .update(workspaceBilling)
      .set({ cancelAtPeriodEnd: false, authorizationVersion: row.authorizationVersion + 1, updatedAt: new Date() })
      .where(eq(workspaceBilling.workspaceId, workspaceId));
    await tx.insert(auditEvents).values({
      workspaceId,
      actorKind: "system",
      actorId: null,
      action: UNDO,
      resourceType: "workspace_billing",
      resourceId: workspaceId,
      payload: { reason: "no_subscription" },
    });
    return true;
  });
}

export async function clearOrphanCancellations(
  db: ScriptDb,
  options: { apply?: boolean; checkStripe?: BillingProvider } = {},
  report: Report = () => {}
): Promise<OrphanCancellations> {
  const result: OrphanCancellations = { orphans: [], cleared: [], lost: [], cancelling: [] };
  const rows = await db.select().from(workspaceBilling);

  for (const row of rows) {
    if (!row.cancelAtPeriodEnd || isLive(row)) continue;
    result.orphans.push(row.workspaceId);
    const what = `${row.workspaceId} (${row.planKey}, ${row.billingState}, Subscription ${row.stripeSubscriptionId ?? "none"})`;
    if (!options.apply) {
      report(`would clear ${what}`);
      continue;
    }
    if (await clearOne(db, row.workspaceId)) {
      result.cleared.push(row.workspaceId);
      report(`cleared ${what}`);
    }
  }

  for (const row of rows) {
    if (row.cancelAtPeriodEnd || !isLive(row)) continue;
    const [last] = await db
      .select({ action: auditEvents.action, actorKind: auditEvents.actorKind, actorId: auditEvents.actorId, createdAt: auditEvents.createdAt })
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, row.workspaceId), inArray(auditEvents.action, [CANCEL, UNDO])))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);
    if (last?.action !== CANCEL || last.actorKind !== "user") continue;
    result.lost.push(row.workspaceId);
    report(
      `lost cancellation ${row.workspaceId}: Subscription ${row.stripeSubscriptionId}, cancelled by user ${last.actorId ?? "unknown"} ` +
        `on ${last.createdAt.toISOString()}, still renewing; settle with the customer, nothing changed`
    );
  }
  for (const row of rows) {
    if (!row.cancelAtPeriodEnd || !isLive(row)) continue;
    let stripe: StripeAnswer = "not checked";
    if (options.checkStripe) {
      try {
        const subscription = await options.checkStripe.fetchSubscription(row.stripeSubscriptionId!);
        stripe = subscription.cancelAtPeriodEnd ? "agrees" : "disagrees";
      } catch (error) {
        stripe = "could not answer";
        report(`Stripe could not answer for ${row.workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    result.cancelling.push({ workspaceId: row.workspaceId, stripe });
    const said =
      stripe === "disagrees"
        ? "Stripe says it renews; Cancel again on the Billing page sends it"
        : stripe === "agrees"
          ? "Stripe agrees"
          : `Stripe ${stripe}`;
    report(`cancelling ${row.workspaceId}: Subscription ${row.stripeSubscriptionId}, ${said}, nothing changed`);
  }
  return result;
}

if (isEntryPoint(import.meta.url)) {
  const apply = process.argv.includes("--apply");
  const checkStripe = process.argv.includes("--check-stripe");
  if (checkStripe && !process.env.STRIPE_SECRET_KEY) {
    console.error("--check-stripe needs STRIPE_SECRET_KEY");
    process.exit(1);
  }
  const url = requireMigrateDatabaseUrl();
  console.log(`database: ${maskDatabaseUrl(url)}${apply ? "" : " (dry run)"}`);
  const { db, close } = openDb(url);
  const provider = checkStripe ? createBillingProvider({ secretKey: process.env.STRIPE_SECRET_KEY }) : undefined;
  clearOrphanCancellations(db, { apply, checkStripe: provider }, (message) => console.log(message))
    .then(({ orphans, cleared, lost, cancelling }) => {
      const disagree = cancelling.filter((row) => row.stripe === "disagrees").length;
      const tail =
        `${lost.length} lost cancellations, ${cancelling.length} live cancellations listed` +
        (checkStripe ? ` (${disagree} Stripe does not have)` : " (Stripe not checked)");
      console.log(
        apply ? `cleared ${cleared.length} of ${orphans.length}; ${tail}` : `would clear ${orphans.length}; ${tail} (dry run)`
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => close());
}
