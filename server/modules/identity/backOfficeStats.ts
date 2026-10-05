/**
 * Platform statistics for the back office (#314). Aggregates only: counts, sums
 * and money per currency. No Workspace content, and no call to Stripe: revenue
 * is read from the pin's last-reported unit amount, so the dashboard answers
 * even while Stripe is down.
 *
 * Money is never added across currencies. MRR is the unit amount times the
 * purchased seats, divided by 12 for an annual Subscription, summed per
 * currency and rounded once at the end.
 */

import { and, count, eq, gte, isNull, lte, sql, sum } from "drizzle-orm";
import {
  auditEvents,
  devices,
  memberships,
  paymentDisputes,
  billingPayments,
  timeEntries,
  timeEntryScreenshots,
  users,
  workspaceBilling,
  workspaces,
} from "@shared/schema";
import { db } from "../../db";
import { forWorkspaces, inWorkspace } from "../../workspaceContext";
import { hasPaidSubscription, isOfferedPlan } from "../billing";
import { isDisputeOpen } from "./backOfficeWorkspaces";

export type PlatformStats = {
  days: number;
  from: string;
  to: string;
  growth: { newUsers: number; newWorkspaces: number; activeWorkspaces7d: number; activeWorkspaces30d: number };
  revenue: {
    mrr: Array<{ currency: string; amountMinor: number }>;
    trialsInProgress: number;
    offeredPlansInProgress: number;
    trialConversions: number;
    cancellations: number;
  };
  payments: {
    failedPayments: number;
    readOnlyByReason: Array<{ reason: string; count: number }>;
    openDisputes: number;
  };
  usage: { hoursTracked: number; activeDesktopAgents: number; screenshotsCaptured: number };
};

export const STATS_PERIODS = [7, 30, 90] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

type WorkspaceFigures = {
  active7d: boolean;
  active30d: boolean;
  mrrCurrency: string | null;
  mrrMinor: number;
  trial: boolean;
  offered: boolean;
  conversions: number;
  cancellations: number;
  failedPayments: number;
  readOnlyReason: string | null;
  openDisputes: number;
  seconds: number;
  screenshots: number;
};

/** Whether a member signed in, or a Time Entry started, since `since`. */
async function activeSince(since: Date): Promise<boolean> {
  const [login] = await db
    .select({ n: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    // `users.lastLoginAt` is per User, so a sign-in counts for every Workspace
    // the User belongs to.
    .where(and(inWorkspace(memberships), isNull(memberships.archivedAt), gte(users.lastLoginAt, since)));
  if (Number(login?.n ?? 0) > 0) return true;
  const [entry] = await db
    .select({ n: count() })
    .from(timeEntries)
    .where(and(inWorkspace(timeEntries), gte(timeEntries.startTime, since)));
  return Number(entry?.n ?? 0) > 0;
}

async function figuresInContext(from: Date, to: Date): Promise<WorkspaceFigures> {
  const [pin] = await db.select().from(workspaceBilling).where(inWorkspace(workspaceBilling)).limit(1);

  const figures: WorkspaceFigures = {
    active7d: await activeSince(new Date(to.getTime() - 7 * DAY_MS)),
    active30d: await activeSince(new Date(to.getTime() - 30 * DAY_MS)),
    mrrCurrency: null,
    mrrMinor: 0,
    trial: false,
    offered: false,
    conversions: 0,
    cancellations: 0,
    failedPayments: 0,
    readOnlyReason: null,
    openDisputes: 0,
    seconds: 0,
    screenshots: 0,
  };

  if (pin) {
    figures.trial = pin.billingState === "Trialing" && pin.planKey === "trial";
    figures.offered = isOfferedPlan(pin);
    if (hasPaidSubscription(pin) && pin.unitAmountMinor != null && pin.currency) {
      const monthly = pin.unitAmountMinor * pin.purchasedSeatCapacity;
      figures.mrrCurrency = pin.currency;
      figures.mrrMinor = pin.billingInterval === "annual" ? monthly / 12 : monthly;
    }
  }

  const transitions = await db
    .select({ payload: auditEvents.payload, createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(and(inWorkspace(auditEvents), eq(auditEvents.action, "billing.state_transition")))
    .orderBy(sql`${auditEvents.createdAt} desc`);
  for (const event of transitions) {
    const { from: was, to: became } = event.payload as { from?: unknown; to?: unknown };
    const inPeriod = event.createdAt >= from && event.createdAt <= to;
    if (inPeriod && was === "Trialing" && became === "Active") figures.conversions += 1;
    // A cancelled Subscription ending. PastDue to ReadOnly is dunning, which the
    // failed payments already show.
    if (inPeriod && was === "Active" && became === "ReadOnly") figures.cancellations += 1;
  }
  if (pin?.billingState === "ReadOnly") {
    const latest = transitions.find((event) => (event.payload as { to?: unknown }).to === "ReadOnly");
    const { from: was, reason } = (latest?.payload ?? {}) as { from?: unknown; reason?: unknown };
    // The projection records `provider_projection` even when dunning ran out;
    // only the notice says `dunning_exhausted`. Read it back from the PastDue origin.
    figures.readOnlyReason =
      reason === "provider_projection" && was === "PastDue"
        ? "dunning_exhausted"
        : typeof reason === "string" && reason
          ? reason
          : "unknown";
  }

  const [failed] = await db
    .select({ n: count() })
    .from(billingPayments)
    .where(
      and(
        inWorkspace(billingPayments),
        eq(billingPayments.outcome, "failed"),
        gte(billingPayments.occurredAt, from),
        lte(billingPayments.occurredAt, to)
      )
    );
  figures.failedPayments = Number(failed?.n ?? 0);

  const disputes = await db
    .select({ status: paymentDisputes.status })
    .from(paymentDisputes)
    .where(inWorkspace(paymentDisputes));
  figures.openDisputes = disputes.filter((dispute) => isDisputeOpen(dispute.status)).length;

  const [tracked] = await db
    .select({ seconds: sum(timeEntries.duration) })
    .from(timeEntries)
    .where(and(inWorkspace(timeEntries), gte(timeEntries.startTime, from), lte(timeEntries.startTime, to)));
  figures.seconds = Number(tracked?.seconds ?? 0);

  const [shots] = await db
    .select({ n: count() })
    .from(timeEntryScreenshots)
    .where(
      and(
        inWorkspace(timeEntryScreenshots),
        gte(timeEntryScreenshots.createdAt, from),
        lte(timeEntryScreenshots.createdAt, to)
      )
    );
  figures.screenshots = Number(shots?.n ?? 0);
  return figures;
}

export async function platformStats(days: number, now = new Date()): Promise<PlatformStats> {
  const to = now;
  const from = new Date(to.getTime() - days * DAY_MS);

  const workspaceRows = await db.select({ id: workspaces.id, createdAt: workspaces.createdAt }).from(workspaces);
  const figures = await forWorkspaces(workspaceRows, () => figuresInContext(from, to));

  const [newUsers] = await db
    .select({ n: count() })
    .from(users)
    .where(and(gte(users.createdAt, from), lte(users.createdAt, to)));
  const newWorkspaces = workspaceRows.filter(
    (row) => row.createdAt != null && row.createdAt >= from && row.createdAt <= to
  ).length;
  const [agents] = await db
    .select({ n: count() })
    .from(devices)
    .where(and(gte(devices.lastSeenAt, from), lte(devices.lastSeenAt, to)));

  const mrr = new Map<string, number>();
  const reasons = new Map<string, number>();
  for (const figure of figures) {
    if (figure.mrrCurrency) mrr.set(figure.mrrCurrency, (mrr.get(figure.mrrCurrency) ?? 0) + figure.mrrMinor);
    if (figure.readOnlyReason) reasons.set(figure.readOnlyReason, (reasons.get(figure.readOnlyReason) ?? 0) + 1);
  }
  const total = (pick: (figure: WorkspaceFigures) => number) =>
    figures.reduce((acc, figure) => acc + pick(figure), 0);

  return {
    days,
    from: from.toISOString(),
    to: to.toISOString(),
    growth: {
      newUsers: Number(newUsers?.n ?? 0),
      newWorkspaces,
      activeWorkspaces7d: figures.filter((figure) => figure.active7d).length,
      activeWorkspaces30d: figures.filter((figure) => figure.active30d).length,
    },
    revenue: {
      mrr: [...mrr.entries()]
        .map(([currency, amount]) => ({ currency, amountMinor: Math.round(amount) }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      trialsInProgress: figures.filter((figure) => figure.trial).length,
      offeredPlansInProgress: figures.filter((figure) => figure.offered).length,
      trialConversions: total((figure) => figure.conversions),
      cancellations: total((figure) => figure.cancellations),
    },
    payments: {
      failedPayments: total((figure) => figure.failedPayments),
      readOnlyByReason: [...reasons.entries()]
        .map(([reason, n]) => ({ reason, count: n }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      openDisputes: total((figure) => figure.openDisputes),
    },
    usage: {
      hoursTracked: Math.round((total((figure) => figure.seconds) / 3600) * 10) / 10,
      activeDesktopAgents: Number(agents?.n ?? 0),
      screenshotsCaptured: total((figure) => figure.screenshots),
    },
  };
}
