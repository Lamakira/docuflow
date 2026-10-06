/**
 * Back office reads and billing commands (#314, ADR-0015). Platform Staff see
 * every Workspace, so each read walks the Workspaces and reads inside that
 * Workspace's context: row-level security matches nothing without one.
 *
 * Nothing here returns Workspace content. A row carries names, counts, billing
 * facts and dates; Audit Events are listed without their payload. Content is
 * the grant and break-glass path in `operatorAccess.ts`.
 *
 * The commands that change a Workspace live in billing; this file only
 * runs them in the target Workspace and answers the fresh detail.
 */

import { and, desc, eq, gt, isNull, like, max, or } from "drizzle-orm";
import {
  auditEvents,
  memberships,
  paymentDisputes,
  platformStaff,
  supportAccessGrants,
  supportRequests,
  timeEntries,
  users,
  workspaceBilling,
  workspaceRoles,
  workspaces,
  billingPayments,
  type SupportCategory,
  type SupportStatus,
} from "@shared/schema";
import { db } from "../../db";
import { forWorkspaces, inWorkspace, runWithWorkspaceContext } from "../../workspaceContext";
import {
  PLAN_LABEL,
  PLAN_REGISTRY,
  PLAN_REGISTRY_VERSION,
  isPlanKey,
  billingProvider,
  countConsumedSeats,
  extendTrial,
  hasPaidSubscription,
  isOfferedPlan,
  offerPlan,
  setOperatorCancelAtPeriodEnd,
  type BillingProjection,
  type BillingProvider,
  type BillingState,
} from "../billing";
import { WorkspaceNotFoundError } from "./operatorAccess";

export type BackOfficeStatus = "trial" | "offered" | "active" | "past_due" | "read_only" | "cancelled";

type Person = { userId: string; name: string; email: string };
type StaffRef = { id: string; email: string | null };

export type PlatformWorkspaceRow = {
  id: string;
  name: string;
  owner: Person | null;
  planKey: string | null;
  planLabel: string | null;
  billingState: BillingState | null;
  status: BackOfficeStatus | null;
  billingInterval: "monthly" | "annual" | null;
  seatsUsed: number;
  seatsPurchased: number;
  memberCount: number;
  trialEndsAt: string | null;
  periodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasPaidSubscription: boolean;
  createdAt: string | null;
  lastActivityAt: string | null;
};

export type PlatformPayment = {
  id: string;
  providerInvoiceId: string;
  outcome: "paid" | "failed";
  amountMinor: number | null;
  currency: string | null;
  occurredAt: string;
  stripeUrl: string | null;
};

export type PlatformDisputeRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  amountMinor: number;
  currency: string;
  reason: string;
  status: string;
  open: boolean;
  openedAt: string;
  stripeUrl: string | null;
};

export type PlatformSupportRequestRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  user: Person;
  category: SupportCategory;
  message: string;
  status: SupportStatus;
  assignedStaff: StaffRef | null;
  createdAt: string;
  updatedAt: string;
};

export type PlatformAuditEventRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  actorKind: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
};

export type PlatformWorkspaceDetail = PlatformWorkspaceRow & {
  subscription: {
    unitAmountMinor: number | null;
    currency: string | null;
    stripeCustomerUrl: string | null;
    stripeSubscriptionUrl: string | null;
    canExtendTrial: boolean;
    canOfferPlan: boolean;
    canCancel: boolean;
    canUndoCancel: boolean;
  };
  payments: PlatformPayment[];
  disputes: PlatformDisputeRow[];
  supportRequests: PlatformSupportRequestRow[];
  members: Array<{ userId: string; name: string; email: string; workspaceRole: string; archived: boolean }>;
  auditEvents: PlatformAuditEventRow[];
  offerablePlans: Array<{ planKey: string; label: string }>;
};

/** Stripe's terminal dispute statuses. Anything else still needs attention. */
const CLOSED_DISPUTE_STATUSES = ["won", "lost", "warning_closed"];

export function isDisputeOpen(status: string): boolean {
  return !CLOSED_DISPUTE_STATUSES.includes(status);
}

export function personName(user: { firstName: string | null; lastName: string | null; email: string }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function backOfficeStatus(pin: {
  billingState: string;
  planKey: string;
  stripeSubscriptionId: string | null;
}): BackOfficeStatus | null {
  switch (pin.billingState) {
    case "Trialing":
      return isOfferedPlan(pin) ? "offered" : "trial";
    case "Active":
      return "active";
    case "PastDue":
      return "past_due";
    case "ReadOnly":
      return pin.stripeSubscriptionId ? "cancelled" : "read_only";
    default:
      return null;
  }
}

export async function staffDirectory(): Promise<Map<string, string | null>> {
  const rows = await db.select({ id: platformStaff.id, email: platformStaff.email }).from(platformStaff);
  return new Map(rows.map((row) => [row.id, row.email]));
}

type WorkspaceRef = { id: string; name: string; createdAt: Date | null };

async function allWorkspaces(): Promise<WorkspaceRef[]> {
  return db
    .select({ id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
    .from(workspaces)
    .orderBy(workspaces.name);
}

export async function findWorkspace(workspaceId: string): Promise<WorkspaceRef> {
  const [row] = await db
    .select({ id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new WorkspaceNotFoundError();
  return row;
}

/** Runs `fn` as each Workspace, with the Workspace's name beside it. */
async function inEachWorkspace<T>(fn: (workspace: WorkspaceRef) => Promise<T>): Promise<T[]> {
  return forWorkspaces(await allWorkspaces(), fn);
}

async function ownerOf(): Promise<Person | null> {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(inWorkspace(memberships), isNull(memberships.archivedAt), eq(workspaceRoles.slug, "owner")))
    .orderBy(memberships.createdAt)
    .limit(1);
  return row ? { userId: row.userId, name: personName(row), email: row.email } : null;
}

async function lastActivityAt(): Promise<Date | null> {
  const [login] = await db
    .select({ at: max(users.lastLoginAt) })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(inWorkspace(memberships), isNull(memberships.archivedAt)));
  const [entry] = await db
    .select({ at: max(timeEntries.startTime) })
    .from(timeEntries)
    .where(inWorkspace(timeEntries));
  const times = [login?.at, entry?.at]
    .filter((at) => at != null)
    .map((at) => new Date(at as Date).getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

/** One Workspace's register row. Runs inside that Workspace's context. */
async function rowInContext(workspace: WorkspaceRef): Promise<PlatformWorkspaceRow> {
  const [pin] = await db.select().from(workspaceBilling).where(inWorkspace(workspaceBilling)).limit(1);
  const seatsUsed = await countConsumedSeats();
  const planKey = pin?.planKey ?? null;
  return {
    id: workspace.id,
    name: workspace.name,
    owner: await ownerOf(),
    planKey,
    planLabel: planKey ? (isPlanKey(planKey) ? PLAN_LABEL[planKey] : planKey) : null,
    billingState: (pin?.billingState as BillingState | undefined) ?? null,
    status: pin ? backOfficeStatus(pin) : null,
    billingInterval: pin?.billingInterval === "monthly" || pin?.billingInterval === "annual" ? pin.billingInterval : null,
    seatsUsed,
    seatsPurchased: pin?.purchasedSeatCapacity ?? 0,
    memberCount: seatsUsed,
    trialEndsAt: iso(pin?.trialEndsAt),
    periodEndsAt: iso(pin?.periodEndsAt),
    cancelAtPeriodEnd: pin?.cancelAtPeriodEnd ?? false,
    hasPaidSubscription: pin ? hasPaidSubscription(pin) : false,
    createdAt: iso(workspace.createdAt),
    lastActivityAt: iso(await lastActivityAt()),
  };
}

export async function listWorkspaceRows(): Promise<PlatformWorkspaceRow[]> {
  return inEachWorkspace(rowInContext);
}

/** Workspaces on a paid Subscription or an Offered Plan. */
export async function listSubscriptionRows(): Promise<PlatformWorkspaceRow[]> {
  return (await listWorkspaceRows()).filter((row) => row.hasPaidSubscription || row.status === "offered");
}

function disputeRow(
  workspace: WorkspaceRef,
  row: typeof paymentDisputes.$inferSelect,
  provider: BillingProvider
): PlatformDisputeRow {
  return {
    id: row.providerDisputeId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    amountMinor: row.amountMinor,
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    open: isDisputeOpen(row.status),
    openedAt: row.openedAt.toISOString(),
    stripeUrl: provider.dashboardUrl("dispute", row.providerDisputeId),
  };
}

async function disputesInContext(workspace: WorkspaceRef, provider: BillingProvider) {
  const rows = await db
    .select()
    .from(paymentDisputes)
    .where(inWorkspace(paymentDisputes))
    .orderBy(desc(paymentDisputes.openedAt));
  return rows.map((row) => disputeRow(workspace, row, provider));
}

export async function listDisputes(provider: BillingProvider = billingProvider): Promise<PlatformDisputeRow[]> {
  const perWorkspace = await inEachWorkspace((workspace) => disputesInContext(workspace, provider));
  return perWorkspace.flat().sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

export async function supportRequestRowsInContext(
  workspace: WorkspaceRef,
  staff: Map<string, string | null>
): Promise<PlatformSupportRequestRow[]> {
  const rows = await db
    .select({
      request: supportRequests,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(supportRequests)
    .innerJoin(users, eq(users.id, supportRequests.userId))
    .where(inWorkspace(supportRequests))
    .orderBy(desc(supportRequests.createdAt));
  return rows.map(({ request, email, firstName, lastName }) => ({
    id: request.id,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    user: { userId: request.userId, name: personName({ firstName, lastName, email }), email },
    category: request.category as SupportCategory,
    message: request.message,
    status: request.status as SupportStatus,
    assignedStaff: request.assignedStaffId
      ? { id: request.assignedStaffId, email: staff.get(request.assignedStaffId) ?? null }
      : null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  }));
}

export async function listSupportRequestRows(): Promise<PlatformSupportRequestRow[]> {
  const staff = await staffDirectory();
  const perWorkspace = await inEachWorkspace((workspace) => supportRequestRowsInContext(workspace, staff));
  return perWorkspace.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

type AuditFilter = { actorId?: string; action?: string; platformStaffOnly?: boolean; limit: number };

/**
 * Audit Events without their payload. The Workspace page shows what staff did
 * and the billing history; the Audit Log lists staff actions only.
 */
async function auditRowsInContext(
  workspace: WorkspaceRef,
  staff: Map<string, string | null>,
  filter: AuditFilter
): Promise<PlatformAuditEventRow[]> {
  const conditions = [inWorkspace(auditEvents)];
  if (filter.platformStaffOnly) {
    conditions.push(eq(auditEvents.actorKind, "platform_staff"));
  } else {
    conditions.push(
      or(
        eq(auditEvents.actorKind, "platform_staff"),
        like(auditEvents.action, "billing.%"),
        like(auditEvents.action, "support_request.%")
      )!
    );
  }
  if (filter.actorId) conditions.push(eq(auditEvents.actorId, filter.actorId));
  if (filter.action) conditions.push(eq(auditEvents.action, filter.action));
  const rows = await db
    .select({
      id: auditEvents.id,
      actorKind: auditEvents.actorKind,
      actorId: auditEvents.actorId,
      action: auditEvents.action,
      resourceType: auditEvents.resourceType,
      resourceId: auditEvents.resourceId,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt))
    .limit(filter.limit);
  return rows.map((row) => ({
    id: row.id,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    actorKind: row.actorKind,
    actorId: row.actorId,
    actorLabel: row.actorKind === "platform_staff" && row.actorId ? (staff.get(row.actorId) ?? null) : null,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listAuditEvents(filters: {
  workspaceId?: string;
  platformStaffId?: string;
  action?: string;
}): Promise<PlatformAuditEventRow[]> {
  const staff = await staffDirectory();
  const refs = filters.workspaceId ? [await findWorkspace(filters.workspaceId)] : await allWorkspaces();
  const perWorkspace = await forWorkspaces(refs, (ref) =>
    auditRowsInContext(ref, staff, {
      actorId: filters.platformStaffId,
      action: filters.action,
      platformStaffOnly: true,
      limit: 200,
    })
  );
  return perWorkspace.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}

export async function workspaceDetail(
  workspaceId: string,
  provider: BillingProvider = billingProvider
): Promise<PlatformWorkspaceDetail> {
  const workspace = await findWorkspace(workspaceId);
  const staff = await staffDirectory();
  return runWithWorkspaceContext({ workspaceId }, async () => {
    const row = await rowInContext(workspace);
    const [pin] = await db.select().from(workspaceBilling).where(inWorkspace(workspaceBilling)).limit(1);
    const payments = await db
      .select()
      .from(billingPayments)
      .where(inWorkspace(billingPayments))
      .orderBy(desc(billingPayments.occurredAt))
      .limit(20);
    const members = await db
      .select({
        userId: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        slug: workspaceRoles.slug,
        archivedAt: memberships.archivedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
      .where(inWorkspace(memberships))
      .orderBy(memberships.createdAt);
    const plans = PLAN_REGISTRY[PLAN_REGISTRY_VERSION] ?? {};

    return {
      ...row,
      subscription: {
        unitAmountMinor: pin?.unitAmountMinor ?? null,
        currency: pin?.currency ?? null,
        stripeCustomerUrl: pin?.stripeCustomerId ? provider.dashboardUrl("customer", pin.stripeCustomerId) : null,
        stripeSubscriptionUrl: pin?.stripeSubscriptionId
          ? provider.dashboardUrl("subscription", pin.stripeSubscriptionId)
          : null,
        canExtendTrial: row.billingState === "Trialing",
        canOfferPlan: row.billingState === "Trialing" || row.billingState === "ReadOnly",
        canCancel: row.hasPaidSubscription && !row.cancelAtPeriodEnd,
        canUndoCancel: row.hasPaidSubscription && row.cancelAtPeriodEnd,
      },
      payments: payments.map((payment) => ({
        id: payment.id,
        providerInvoiceId: payment.providerInvoiceId,
        outcome: payment.outcome === "paid" ? "paid" : "failed",
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        occurredAt: payment.occurredAt.toISOString(),
        stripeUrl: provider.dashboardUrl("invoice", payment.providerInvoiceId),
      })),
      disputes: await disputesInContext(workspace, provider),
      supportRequests: await supportRequestRowsInContext(workspace, staff),
      members: members.map((member) => ({
        userId: member.userId,
        name: personName(member),
        email: member.email,
        workspaceRole: member.slug,
        archived: member.archivedAt != null,
      })),
      auditEvents: await auditRowsInContext(workspace, staff, { limit: 50 }),
      offerablePlans: Object.keys(plans)
        .filter((key) => key !== "trial" && isPlanKey(key))
        .map((key) => ({ planKey: key, label: isPlanKey(key) ? PLAN_LABEL[key] : key })),
    };
  });
}

export async function listUserWorkspaces(
  userId: string
): Promise<Array<{ workspaceId: string; workspaceName: string; workspaceRole: string; archived: boolean }>> {
  const perWorkspace = await inEachWorkspace(async (workspace) => {
    const rows = await db
      .select({ slug: workspaceRoles.slug, archivedAt: memberships.archivedAt })
      .from(memberships)
      .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
      .where(and(inWorkspace(memberships), eq(memberships.userId, userId)));
    return rows.map((row) => ({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRole: row.slug,
      archived: row.archivedAt != null,
    }));
  });
  return perWorkspace.flat();
}

/** Active Support Access Grants naming the signed-in staff member, across Workspaces. */
export async function listOwnSupportAccess(
  staffId: string,
  now = new Date()
): Promise<Array<{ grantId: string; workspaceId: string; workspaceName: string; expiresAt: string; createdAt: string }>> {
  const perWorkspace = await inEachWorkspace(async (workspace) => {
    const rows = await db
      .select({
        id: supportAccessGrants.id,
        expiresAt: supportAccessGrants.expiresAt,
        createdAt: supportAccessGrants.createdAt,
      })
      .from(supportAccessGrants)
      .where(
        and(
          inWorkspace(supportAccessGrants),
          eq(supportAccessGrants.platformStaffId, staffId),
          isNull(supportAccessGrants.revokedAt),
          gt(supportAccessGrants.expiresAt, now)
        )
      );
    return rows.map((row) => ({
      grantId: row.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  });
  return perWorkspace.flat().sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

/** Runs a billing command as the Workspace and answers its fresh detail. */
export async function runBillingCommand(
  workspaceId: string,
  command: () => Promise<BillingProjection>
): Promise<PlatformWorkspaceDetail> {
  await findWorkspace(workspaceId);
  await runWithWorkspaceContext({ workspaceId }, command);
  return workspaceDetail(workspaceId);
}

export function extendTrialFor(workspaceId: string, staffId: string, input: { days: number }) {
  return runBillingCommand(workspaceId, () => extendTrial({ kind: "platform_staff", id: staffId }, input));
}

export function offerPlanTo(
  workspaceId: string,
  staffId: string,
  input: { planKey: string; days: number; seats?: number }
) {
  return runBillingCommand(workspaceId, () => offerPlan({ kind: "platform_staff", id: staffId }, input));
}

export function setCancelAtPeriodEndFor(
  workspaceId: string,
  staffId: string,
  input: { cancel: boolean },
  provider: BillingProvider = billingProvider
) {
  return runBillingCommand(workspaceId, () =>
    setOperatorCancelAtPeriodEnd({ kind: "platform_staff", id: staffId }, input, provider)
  );
}
