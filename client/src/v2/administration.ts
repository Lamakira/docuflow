/**
 * Administration destination (#193), deepened with Tracking Policy and the
 * remaining billing actions (#212), one composer per tab since the
 * Administration review (F101-F110).
 * Novelty: a newly created or rotated key is shown once (rare state
 * indication); a saved Tracking Policy is signed off, not celebrated.
 * Do not animate: the settings form on every keystroke, billing numbers
 * counting up.
 */

import {
  DEFAULT_SCREENSHOT_POLICY,
  isTrackingPolicyClockTime,
  PUBLIC_API_CAPABILITIES,
  VIEW_DAILY_UPDATES_CAPABILITY_ID,
  type ScreenshotPolicy,
} from "@shared/schema";
import { isLowActivityThreshold } from "@shared/activityEvidence";
import { chromeRefusal } from "./chrome";
import { workspaceRoleInCopy, type WorkspaceCondition, type WorkspaceMemberRow } from "./workspace";
import { formatFullDate } from "./dates";

/**
 * Administration is a destination governed by the Workspace Role (#238), not a
 * Capability: `capabilities` has no row for it, so no Owner could grant one.
 */
export const ADMINISTRATION_DESTINATION = "Administration";

/** Analytics left Administration for the rail (#281); the same Workspace Roles reach it. */
export const ANALYTICS_DESTINATION = "Analytics";

/** Who governs it, said the way a reader would say it. */
const ADMINISTRATION_ROLES = "the Owner and Administrators";

/**
 * The single refusal every Administration or Analytics surface shows. It names
 * the destination, the authority that actually governs it, and the Workspace
 * Role the reader actually holds.
 */
export function administrationRefusal(input: {
  workspaceRole: string;
  ownerName?: string | null;
  destination?: typeof ADMINISTRATION_DESTINATION | typeof ANALYTICS_DESTINATION;
}): string {
  const destination = input.destination ?? ADMINISTRATION_DESTINATION;
  if (canManageAdministration(input.workspaceRole)) {
    // The Role qualifies and the read was refused anyway. Blaming the Role here
    // would be a second false reason, so say only what is known.
    return `${destination} could not be opened for your Membership in this Workspace.`;
  }
  return chromeRefusal({
    kind: "workspace-role",
    destination,
    roles: ADMINISTRATION_ROLES,
    workspaceRole: input.workspaceRole,
    ownerName: input.ownerName,
  });
}

const CAPABILITY_LABELS = new Map<string, string>([
  [VIEW_DAILY_UPDATES_CAPABILITY_ID, "View daily updates"],
  ...PUBLIC_API_CAPABILITIES.map((row) => [row.id, row.name] as const),
]);

export type ServiceAccountInput = {
  id: string;
  name: string;
  capabilityIds: string[];
  revokedAt: string | Date | null;
  plaintextKey?: string;
};

export type WebhookEndpointInput = {
  id: string;
  url: string;
  eventTypes: string[];
  disabledAt: string | Date | null;
  plaintextSecret?: string;
};

export type BillingInput = {
  planKey: "legacy" | "trial" | "pro" | "starter" | "growth" | "business" | "enterprise" | string;
  billingState: "Trialing" | "Active" | "PastDue" | "ReadOnly" | string;
  purchasedSeatCapacity: number;
  consumedSeatCount: number;
  trialEndsAt: string | Date | null;
  periodEndsAt: string | Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  /** A decrease waiting for the period's end; `null` when none is planned. */
  pendingSeatQuantity?: number | null;
  /** The price of one seat on the Subscription, in the currency's minor unit. */
  unitAmountMinor?: number | null;
  currency?: string | null;
  /** A live Subscription that is not cancelling. */
  canCancel?: boolean;
  /** A live Subscription that is cancelling. */
  canKeep?: boolean;
};

export type RevealedSecretInput = {
  kind: "service-account" | "webhook-endpoint";
  id: string;
  label: string;
  plaintext: string;
};

export type ServiceAccountRow = {
  id: string;
  name: string;
  capabilityIds: string[];
  capabilities: string;
  status: "Active" | "Revoked";
  rotate: boolean;
  revoke: boolean;
  edit: boolean;
};

export type WebhookEndpointRow = {
  id: string;
  url: string;
  eventTypes: string;
  status: "Active" | "Disabled";
  rotate: boolean;
  disable: boolean;
  enable: boolean;
};

export function serviceAccountsPath(): string {
  return "/api/service-accounts";
}

export function serviceAccountPath(id: string): string {
  return `/api/service-accounts/${id}`;
}

export function revokeServiceAccountPath(id: string): string {
  return `/api/service-accounts/${id}/revoke`;
}

export function rotateServiceAccountPath(id: string): string {
  return `/api/service-accounts/${id}/rotate`;
}

export function webhookEndpointsPath(): string {
  return "/api/webhook-endpoints";
}

export function webhookDisablePath(id: string): string {
  return `/api/webhook-endpoints/${id}/disable`;
}

export function webhookEnablePath(id: string): string {
  return `/api/webhook-endpoints/${id}/enable`;
}

export function rotateWebhookEndpointPath(id: string): string {
  return `/api/webhook-endpoints/${id}/rotate`;
}

export function billingSubscriptionPath(): string {
  return "/api/billing/subscription";
}

export function billingCheckoutPath(): string {
  return "/api/billing/checkout";
}

export function billingSeatsPath(): string {
  return "/api/billing/seats";
}

export function billingPaymentMethodPath(): string {
  return "/api/billing/payment-method";
}

export function billingCancelPath(): string {
  return "/api/billing/cancel-at-period-end";
}

export function billingKeepPath(): string {
  return "/api/billing/keep-subscription";
}

export function billingPricesPath(): string {
  return "/api/billing/prices";
}

export function workspacePath(): string {
  return "/api/workspace";
}

export function hostedBillingSession(input: { url: string }): { kind: "redirect"; url: string } {
  return { kind: "redirect", url: input.url };
}

export function canManageAdministration(workspaceRole: string): boolean {
  const role = workspaceRole.trim().toUpperCase();
  return role === "OWNER" || role === "ADMINISTRATOR";
}

export function isWorkspaceOwner(workspaceRole: string): boolean {
  return workspaceRole.trim().toUpperCase() === "OWNER";
}

export type AdministrationWriteRefusal =
  | { kind: "workspace-role"; workspaceRole: string; ownerName?: string | null }
  | { kind: "workspace-condition"; workspaceName: string; condition: "Read-only" | "Trial" | "Past due" }
  | {
      kind: "error";
      workspaceName: string;
      workspaceRole: string;
      ownerName?: string | null;
      errorMessage: string;
    };

export function administrationWriteRefusal(input: AdministrationWriteRefusal): string {
  if (input.kind === "workspace-role") {
    return administrationRefusal({
      workspaceRole: input.workspaceRole,
      ownerName: input.ownerName,
    });
  }
  if (input.kind === "workspace-condition") {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: input.condition,
    });
  }
  const message = input.errorMessage;
  if (/read-only/i.test(message)) {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: "Read-only",
    });
  }
  if (/permission denied|not authorized|access denied|forbidden/i.test(message)) {
    return administrationWriteRefusal({
      kind: "workspace-role",
      workspaceRole: input.workspaceRole,
      ownerName: input.ownerName,
    });
  }
  return chromeRefusal({ kind: "generic", message });
}

/** The line over every tab of a Read-only Workspace; `null` otherwise. */
export function administrationReadOnlyNote(workspaceName: string, condition: WorkspaceCondition): string | null {
  return condition === "Read-only"
    ? chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" })
    : null;
}

function capabilityLabel(capabilityIds: string[]): string {
  if (capabilityIds.length === 0) return "-";
  return capabilityIds.map((id) => CAPABILITY_LABELS.get(id) ?? id).join(" · ");
}

/** Initials from the first two words; kept here because presentation.ts imports this module. */
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

/* ── Workspace tab ─────────────────────────────────────────────────────── */

export const WORKSPACE_NAME_MAX = 100;

export type WorkspaceCardModel = {
  name: string;
  initials: string;
  roleBadge: string;
  /** Only the Owner renames the Workspace. */
  renamable: boolean;
  /** Who can rename it, for a reader who cannot. */
  renameNote: string | null;
  owner: { name: string; initials: string } | null;
  members: string | null;
};

export function composeWorkspaceCard(input: {
  workspaceName: string;
  workspaceRole: string;
  ownerName: string | null;
  members?: WorkspaceMemberRow[];
}): WorkspaceCardModel {
  const renamable = isWorkspaceOwner(input.workspaceRole);
  return {
    name: input.workspaceName,
    initials: nameInitials(input.workspaceName) || "WS",
    roleBadge: `You are ${workspaceRoleInCopy(input.workspaceRole)}`,
    renamable,
    renameNote: renamable
      ? null
      : input.ownerName
        ? `Only the Owner, ${input.ownerName}, can rename the Workspace.`
        : "Only the Owner can rename the Workspace.",
    owner: input.ownerName ? { name: input.ownerName, initials: nameInitials(input.ownerName) } : null,
    members: input.members
      ? `${input.members.length} ${input.members.length === 1 ? "Member" : "Members"}`
      : null,
  };
}

/** What stops a rename before it is sent; `null` when it can go. */
export function workspaceNameIssue(draft: string): string | null {
  const name = draft.trim();
  if (!name) return "Name the Workspace.";
  if (name.length > WORKSPACE_NAME_MAX) return `Keep the name to ${WORKSPACE_NAME_MAX} characters or fewer.`;
  return null;
}

/* ── Billing tab ───────────────────────────────────────────────────────── */

export type BillingAction = {
  id: "checkout" | "plan" | "seats" | "payment-method" | "cancel" | "keep";
  label: string;
  /**
   * A destructive action is set apart, so the reflex that reaches a routine
   * button does not reach this one (#245, F1).
   */
  tone: "neutral" | "destructive";
  /** What the action costs, stated before it runs. `null` when it costs nothing. */
  consequence: string | null;
};

export type BillingSummary = {
  plan: string;
  /** One sentence on why the Plan stands as it does. `null` when there is nothing to add. */
  lead: string | null;
  seats: { label: string; percent: number; over: boolean };
  writes: { allowed: boolean; label: "You can edit" | "Read-only" };
  term: { label: string; value: string };
};

export type BillingModel = {
  available: boolean;
  plan: string;
  condition: "Trial" | "Active" | "Past due" | "Read-only" | null;
  seats: string;
  /** What the seat field starts from, so it never contradicts the figure above it. */
  seatQuantityDefault: string;
  /** No fewer seats than Billable Seats in use: one per Member. */
  seatFloor: number;
  /** A planned decrease, and the button that keeps today's seats. */
  pendingSeats: { label: string; keepLabel: string; quantity: number } | null;
  /** The subscription read as a summary; `null` exactly when billing is not available. */
  summary: BillingSummary | null;
  actions: BillingAction[];
  checkout: "redirect";
};

const PLAN_LABEL: Record<string, string> = {
  trial: "Trial",
  legacy: "Legacy",
  pro: "Pro",
  starter: "Starter",
  growth: "Growth",
  business: "Business",
  enterprise: "Enterprise",
};

/** Plans whose Subscription buys Billable Seats; Enterprise is agreed with sales. */
const SEAT_PLANS = new Set(["pro", "starter", "growth", "business"]);

function planLabel(planKey: string): string {
  return PLAN_LABEL[planKey] ?? planKey;
}

function billingCondition(
  billingState: string,
): "Trial" | "Active" | "Past due" | "Read-only" | null {
  if (billingState === "Trialing") return "Trial";
  if (billingState === "Active") return "Active";
  if (billingState === "PastDue") return "Past due";
  if (billingState === "ReadOnly") return "Read-only";
  return null;
}

/**
 * The line above the Plan cards. The selected card is only a choice until
 * Checkout or the confirmation runs; the Workspace's Plan is named apart.
 */
export function planPickerNote(mode: "checkout" | "change", currentPlanLabel: string): string {
  return mode === "checkout"
    ? `Current Plan: ${currentPlanLabel}. Select a Plan, then continue to Checkout. The Workspace changes Plan once Checkout completes.`
    : `Current Plan: ${currentPlanLabel}. Select a Plan to move to; nothing changes until you confirm.`;
}

/** Whichever date actually governs the subscription next. */
function billingTerm(pin: BillingInput): { label: string; value: string } {
  if (pin.planKey === "trial" && pin.trialEndsAt) {
    return { label: "Trial ends", value: formatFullDate(pin.trialEndsAt) };
  }
  // A Subscription that has ended renews nothing; its last period end is history.
  if (pin.billingState === "ReadOnly") {
    return { label: "Subscription", value: "Ended" };
  }
  if (pin.cancelAtPeriodEnd && pin.periodEndsAt) {
    return { label: "Access ends", value: formatFullDate(pin.periodEndsAt) };
  }
  if (pin.periodEndsAt) {
    return { label: "Renews", value: formatFullDate(pin.periodEndsAt) };
  }
  // Legacy, sales-led and offered Plans have no period: nothing renews (F102).
  return { label: "Subscription", value: "Nothing renews" };
}

/** Why the Plan stands as it does; the first state that applies wins. */
function billingLead(pin: BillingInput, readOnly: boolean): string | null {
  if (readOnly) return "Writes are blocked. Viewing, export, and recovery stay available.";
  if (pin.billingState === "PastDue") {
    return "The last payment failed. Update the payment method to keep this Plan.";
  }
  if (pin.cancelAtPeriodEnd && pin.periodEndsAt) {
    return `Cancelled. ${planLabel(pin.planKey)} stays until ${formatFullDate(pin.periodEndsAt)}.`;
  }
  if (pin.billingState === "Trialing") {
    return pin.planKey === "trial"
      ? "Every Business feature, free, until the Trial ends."
      // Any other Plan on a Trial is an Offered Plan (ADR-0029).
      : "Offered by DocuFlow. Nothing is charged until it ends.";
  }
  if (pin.planKey === "legacy") return "Kept from before self-service billing. Nothing renews.";
  if (pin.planKey === "enterprise") return "Agreed with sales.";
  if (SEAT_PLANS.has(pin.planKey)) return "Billed for each Billable Seat.";
  return null;
}

/** What cancelling ends, and when: the card says it before the action runs. */
function cancellationConsequence(pin: BillingInput): string {
  const tail = "Viewing, export, and recovery stay available.";
  if (pin.periodEndsAt) {
    return (
      `${planLabel(pin.planKey)} entitlements stay until ${formatFullDate(pin.periodEndsAt)}. ` +
      `On that day writes stop and the Workspace becomes read-only. ${tail}`
    );
  }
  return `Writes stop at the end of the current period and the Workspace becomes read-only. ${tail}`;
}

function seatWord(count: number): string {
  return `${count} ${count === 1 ? "seat" : "seats"}`;
}

export function composeBilling(input: { billing: BillingInput | null; condition: WorkspaceCondition }): BillingModel {
  const pin = input.billing;
  if (!pin) {
    return {
      available: false,
      plan: "-",
      condition: input.condition === "Trial" || input.condition === "Past due" || input.condition === "Read-only"
        ? input.condition
        : null,
      seats: "Seat counts are not available.",
      seatQuantityDefault: "",
      seatFloor: 1,
      pendingSeats: null,
      summary: null,
      actions: [],
      checkout: "redirect",
    };
  }

  const condition = billingCondition(pin.billingState);
  const readOnly = pin.billingState === "ReadOnly" || input.condition === "Read-only";
  const routine = (id: BillingAction["id"], label: string): BillingAction => ({
    id,
    label,
    tone: "neutral",
    consequence: null,
  });

  const actions: BillingAction[] = [];
  // A lapsed Subscription comes back through Checkout, as a Trial does.
  if (pin.planKey === "trial" || (pin.billingState === "ReadOnly" && SEAT_PLANS.has(pin.planKey))) {
    actions.push(routine("checkout", "Choose a Plan"));
  }
  if (!readOnly && SEAT_PLANS.has(pin.planKey) && (pin.billingState === "Active" || pin.billingState === "PastDue")) {
    actions.push(routine("plan", "Change Plan"));
  }
  if (!readOnly && SEAT_PLANS.has(pin.planKey)) {
    actions.push(routine("seats", "Change seats"));
  }
  if (pin.stripeCustomerId) {
    actions.push(routine("payment-method", "Update payment method"));
  }
  // The server says whether a live Subscription stands behind the Plan (F102):
  // a Legacy or offered Plan has none to cancel, and a Past due one does.
  if (!readOnly && pin.canCancel === true) {
    actions.push({
      id: "cancel",
      label: "Cancel at period end",
      tone: "destructive",
      consequence: cancellationConsequence(pin),
    });
  }
  if (!readOnly && pin.canKeep === true) {
    actions.push({
      id: "keep",
      label: "Keep the Subscription",
      tone: "neutral",
      consequence: pin.periodEndsAt ? `Access ends ${formatFullDate(pin.periodEndsAt)}` : "Access ends at the end of the period",
    });
  }

  const pending =
    pin.pendingSeatQuantity != null && pin.pendingSeatQuantity !== pin.purchasedSeatCapacity
      ? pin.pendingSeatQuantity
      : null;

  return {
    available: true,
    plan: planLabel(pin.planKey),
    condition,
    seats: `${pin.consumedSeatCount} of ${pin.purchasedSeatCapacity} Billable Seats consumed.`,
    seatQuantityDefault: String(pin.purchasedSeatCapacity),
    seatFloor: Math.max(1, pin.consumedSeatCount),
    pendingSeats:
      pending === null
        ? null
        : {
            label: pin.periodEndsAt
              ? `${seatWord(pending)} from ${formatFullDate(pin.periodEndsAt)}`
              : `${seatWord(pending)} from the next period`,
            keepLabel: `Keep ${seatWord(pin.purchasedSeatCapacity)}`,
            quantity: pin.purchasedSeatCapacity,
          },
    summary: {
      plan: planLabel(pin.planKey),
      lead: billingLead(pin, readOnly),
      seats: {
        label: `${pin.consumedSeatCount} of ${pin.purchasedSeatCapacity}`,
        percent:
          pin.purchasedSeatCapacity > 0
            ? Math.min(100, Math.round((pin.consumedSeatCount / pin.purchasedSeatCapacity) * 100))
            : 0,
        over: pin.consumedSeatCount > pin.purchasedSeatCapacity,
      },
      writes: readOnly
        ? { allowed: false, label: "Read-only" }
        : { allowed: true, label: "You can edit" },
      term: billingTerm(pin),
    },
    actions,
    checkout: "redirect",
  };
}

export type BillingInterval = "monthly" | "annual";

export type BillingPrice = {
  planKey: string;
  interval: BillingInterval | string;
  unitAmountMinor: number;
  currency: string;
};

const INTERVAL_WORD: Record<string, string> = { monthly: "month", annual: "year" };

/** An amount in a currency's minor unit, with the currency's own number of decimals (none for JPY). */
export function formatMoney(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase();
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return `${code} ${amountMinor}`;
  }
  const value = amountMinor / 10 ** digits;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: code,
    currencyDisplay: "code",
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  })
    .format(value)
    .replace(/ /g, " ");
}

export function planPrice(prices: BillingPrice[], planKey: string, interval: string): BillingPrice | null {
  return prices.find((price) => price.planKey === planKey && price.interval === interval) ?? null;
}

/** "EUR 12 per seat, per month", under a Plan's name. */
export function seatPriceLine(price: BillingPrice): string {
  return `${formatMoney(price.unitAmountMinor, price.currency)} per seat, per ${INTERVAL_WORD[price.interval] ?? price.interval}`;
}

/** "3 seats x EUR 12 = EUR 36 per month, before tax". */
export function checkoutTotalLine(price: BillingPrice, seats: number): string {
  return (
    `${seatWord(seats)} x ${formatMoney(price.unitAmountMinor, price.currency)} = ` +
    `${formatMoney(price.unitAmountMinor * seats, price.currency)} per ${INTERVAL_WORD[price.interval] ?? price.interval}, before tax`
  );
}

/** "At least 3: one per Member", beside the seat field. */
export function seatFloorNote(floor: number): string {
  return `At least ${floor}: one per Member`;
}

/** Why a typed number of seats cannot be sent; `null` when it can. */
export function seatQuantityIssue(text: string, floor: number): string | null {
  const value = text.trim();
  if (!value) return "Enter a number of seats.";
  if (!/^\d+$/.test(value)) return "Enter a whole number of seats.";
  if (Number(value) < floor) return `Choose at least ${floor} ${floor === 1 ? "seat" : "seats"}: one per Member.`;
  return null;
}

/** What the confirmation of a seat change says before it is sent (F104). */
export function seatChangeConfirmation(input: {
  from: number;
  to: number;
  periodEndsAt: string | Date | null;
  unitAmountMinor?: number | null;
  currency?: string | null;
  interval?: string | null;
}): { title: string; consequence: string; confirmLabel: string } {
  const until = input.periodEndsAt ? formatFullDate(input.periodEndsAt) : null;
  const title = `From ${input.from} to ${seatWord(input.to)}`;
  if (input.to > input.from) {
    const added = input.to - input.from;
    const now = until
      ? `The ${added === 1 ? "new seat is" : `${added} new seats are`} charged now, in proportion to the time left until ${until}.`
      : `The ${added === 1 ? "new seat is" : `${added} new seats are`} charged now, in proportion to the time left in the period.`;
    const next =
      input.unitAmountMinor != null && input.currency
        ? ` Then the Subscription costs ${formatMoney(input.unitAmountMinor * input.to, input.currency)}` +
          `${input.interval && INTERVAL_WORD[input.interval] ? ` per ${INTERVAL_WORD[input.interval]}` : ""}, before tax.`
        : "";
    return { title, consequence: `${now}${next}`, confirmLabel: `Add ${seatWord(added)}` };
  }
  return {
    title,
    consequence: until
      ? `The change applies on ${until}. Until then the Workspace keeps ${seatWord(input.from)}.`
      : `The change applies at the end of the period. Until then the Workspace keeps ${seatWord(input.from)}.`,
    confirmLabel: `Change to ${seatWord(input.to)}`,
  };
}

/* ── Integrations tab ──────────────────────────────────────────────────── */

export const SERVICE_ACCOUNT_NAME_MAX = 100;

export type ServiceAccountsModel = {
  empty: boolean;
  emptyCopy: string;
  emptyTitle: string;
  rows: ServiceAccountRow[];
  /** Revoked ones, hidden until asked for (F109). */
  revokedCount: number;
  createAllowed: boolean;
};

export function composeServiceAccounts(input: {
  serviceAccounts: ServiceAccountInput[];
  condition: WorkspaceCondition;
  showRevoked: boolean;
}): ServiceAccountsModel {
  const readOnly = input.condition === "Read-only";
  const all: ServiceAccountRow[] = input.serviceAccounts.map((row) => {
    const revoked = row.revokedAt != null;
    return {
      id: row.id,
      name: row.name,
      capabilityIds: row.capabilityIds,
      capabilities: capabilityLabel(row.capabilityIds),
      status: revoked ? "Revoked" : "Active",
      rotate: !revoked && !readOnly,
      revoke: !revoked && !readOnly,
      edit: !revoked && !readOnly,
    };
  });
  const rows = input.showRevoked ? all : all.filter((row) => row.status === "Active");
  return {
    empty: rows.length === 0,
    emptyCopy: "A Service Account lets an integration call the public API with its own key. Create one to get a key.",
    emptyTitle: "Add your first Service Account",
    rows,
    revokedCount: all.length - all.filter((row) => row.status === "Active").length,
    createAllowed: !readOnly,
  };
}

/** What stops a Service Account from being saved; `null` when it can go. */
export function serviceAccountIssue(name: string, capabilityIds: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name the Service Account.";
  if (trimmed.length > SERVICE_ACCOUNT_NAME_MAX) return `Keep the name to ${SERVICE_ACCOUNT_NAME_MAX} characters or fewer.`;
  if (capabilityIds.length === 0) return "Choose at least one Capability, or the Service Account can do nothing.";
  return null;
}

export type WebhookEndpointsModel = {
  empty: boolean;
  emptyCopy: string;
  emptyTitle: string;
  rows: WebhookEndpointRow[];
  createAllowed: boolean;
};

export function composeWebhookEndpoints(input: {
  webhookEndpoints: WebhookEndpointInput[];
  condition: WorkspaceCondition;
}): WebhookEndpointsModel {
  const rows: WebhookEndpointRow[] = input.webhookEndpoints.map((row) => {
    const disabled = row.disabledAt != null;
    return {
      id: row.id,
      url: row.url,
      eventTypes: row.eventTypes.join(" · "),
      status: disabled ? "Disabled" : "Active",
      rotate: true,
      disable: !disabled,
      enable: disabled,
    };
  });
  return {
    empty: rows.length === 0,
    emptyCopy: "A Webhook Endpoint is a public https address that receives the events you choose.",
    emptyTitle: "Add your first Webhook Endpoint",
    rows,
    createAllowed: input.condition !== "Read-only",
  };
}

export type SecretOnce = RevealedSecretInput & {
  confirmation: string;
};

/** A new or rotated key, shown once; the list never carries one. */
export function secretOnce(revealed: RevealedSecretInput | null): SecretOnce | null {
  return revealed ? { ...revealed, confirmation: "Copy this now. It will not be shown again." } : null;
}

/* ── Workspace settings (#212) ─────────────────────────────────────────── */

export function workspaceSettingsPath(): string {
  return "/api/admin/org-settings";
}

/* ── Tracking Policy (#212) ────────────────────────────────────────────────
 * It lives on `/api/admin/org-settings`. The save sends only what changed, is
 * signed off, never celebrated, and the form does not animate on a keystroke.
 */

/** The number fields of the policy, with the server's bounds. */
export const POLICY_NUMBERS = {
  captureIntervalMinMin: { name: "Minimum interval", min: 3, max: 15 },
  captureIntervalMaxMin: { name: "Maximum interval", min: 3, max: 15 },
  lowActivityThresholdPercent: { name: "Low-activity threshold", min: 0, max: 100 },
  idleTimeoutMinutes: { name: "Idle timeout", min: 1, max: 60 },
  idleCountdownSeconds: { name: "Prompt countdown", min: 15, max: 120 },
} as const;

export type PolicyNumberKey = keyof typeof POLICY_NUMBERS;

const POLICY_NUMBER_KEYS = Object.keys(POLICY_NUMBERS) as PolicyNumberKey[];

/**
 * Unsaved edits over the policy as read. A number holds the text typed, so a
 * cleared field stays empty; the saved policy shows through every key left out.
 */
export type PolicyEdits = Partial<Omit<ScreenshotPolicy, PolicyNumberKey>> & Partial<Record<PolicyNumberKey, string>>;

/** What the form shows: the saved policy under the edits, every number as text. */
export type PolicyForm = Omit<ScreenshotPolicy, PolicyNumberKey> & Record<PolicyNumberKey, string>;

function isPolicyNumberKey(key: string): key is PolicyNumberKey {
  return key in POLICY_NUMBERS;
}

export function policyForm(saved: ScreenshotPolicy, edits: PolicyEdits): PolicyForm {
  const form = { ...saved, ...edits } as Record<string, unknown>;
  for (const key of POLICY_NUMBER_KEYS) form[key] = edits[key] ?? String(saved[key]);
  return form as PolicyForm;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (a === null) === (b === null) && ((a as string[] | null) ?? []).join("\n") === ((b as string[] | null) ?? []).join("\n");
  }
  return a === b;
}

/** The edits without any key that matches the policy as read, so an undone edit is no edit. */
export function pruneEdits(saved: ScreenshotPolicy, edits: PolicyEdits): PolicyEdits {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edits)) {
    if (value === undefined) continue;
    const same = isPolicyNumberKey(key)
      ? value === String(saved[key])
      : sameValue(value, saved[key as keyof ScreenshotPolicy]);
    if (!same) kept[key] = value;
  }
  return kept as PolicyEdits;
}

/** A typed number the server would take, or `null`. */
function parsedNumber(key: PolicyNumberKey, text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  if (key === "lowActivityThresholdPercent") return isLowActivityThreshold(number) ? number : null;
  const { min, max } = POLICY_NUMBERS[key];
  return number >= min && number <= max ? number : null;
}

/**
 * The keys that differ from the policy as read, and why they cannot be saved.
 * Only what is sent is checked, with the min/max pair on the merged policy, so
 * a stored value out of bounds never blocks saving something else (F108).
 */
export function policyPatch(
  saved: ScreenshotPolicy,
  edits: PolicyEdits,
): { patch: Partial<ScreenshotPolicy>; issue: string | null } {
  const patch: Record<string, unknown> = {};
  let issue: string | null = null;
  for (const [key, value] of Object.entries(edits) as Array<[keyof ScreenshotPolicy, unknown]>) {
    if (value === undefined) continue;
    if (isPolicyNumberKey(key)) {
      const text = value as string;
      if (text === String(saved[key])) continue;
      const number = parsedNumber(key, text);
      const { name, min, max } = POLICY_NUMBERS[key];
      if (number === null) {
        issue ??= text.trim() === "" ? `Enter the ${name.toLowerCase()}.` : `${name} must be a whole number from ${min} to ${max}.`;
        patch[key] = text;
        continue;
      }
      if (number !== saved[key]) patch[key] = number;
      continue;
    }
    if (sameValue(value, saved[key])) continue;
    patch[key] = value;
  }
  if (
    !issue &&
    (("activeHoursStart" in patch && !isTrackingPolicyClockTime(String(patch.activeHoursStart))) ||
      ("activeHoursEnd" in patch && !isTrackingPolicyClockTime(String(patch.activeHoursEnd))))
  ) {
    issue = "Active hours must be 24-hour times such as 08:00.";
  }
  if (!issue && ("captureIntervalMinMin" in patch || "captureIntervalMaxMin" in patch)) {
    const min = (patch.captureIntervalMinMin as number | undefined) ?? saved.captureIntervalMinMin;
    const max = (patch.captureIntervalMaxMin as number | undefined) ?? saved.captureIntervalMaxMin;
    if (min > max) issue = "The minimum interval cannot exceed the maximum.";
  }
  return { patch: patch as Partial<ScreenshotPolicy>, issue };
}

/** The policy the hints describe: each valid edit over the saved value. */
function effectivePolicy(saved: ScreenshotPolicy, edits: PolicyEdits): ScreenshotPolicy {
  const merged = { ...saved, ...edits } as Record<string, unknown>;
  for (const key of POLICY_NUMBER_KEYS) {
    const text = edits[key];
    merged[key] = text === undefined ? saved[key] : (parsedNumber(key, text) ?? saved[key]);
  }
  return merged as unknown as ScreenshotPolicy;
}

export type SimultaneousTimersSetting = {
  launched: boolean;
  launchAt: string | null;
  includedInPlan: boolean;
};

export type SimultaneousTimersOption = {
  /** False on a Plan without Tasks (Starter): the option is not shown at all. */
  visible: boolean;
  /** Before the launch the switch cannot be turned on. */
  disabled: boolean;
  label: string;
  hint: string;
  /** Why it is disabled, or null. */
  note: string | null;
};

export const SIMULTANEOUS_TIMERS_LABEL = "Simultaneous Timers";
export const SIMULTANEOUS_TIMERS_HINT = "Let Members run up to 3 Timers at once. Each hour counts once in their day.";

export function simultaneousTimersOption(
  setting: SimultaneousTimersSetting | null | undefined,
  options: { locale?: string; timeZone?: string } = {},
): SimultaneousTimersOption {
  const base = { label: SIMULTANEOUS_TIMERS_LABEL, hint: SIMULTANEOUS_TIMERS_HINT };
  if (!setting || !setting.includedInPlan) return { ...base, visible: false, disabled: true, note: null };
  if (setting.launched) return { ...base, visible: true, disabled: false, note: null };
  const date = setting.launchAt ? new Date(setting.launchAt) : null;
  const note =
    date && !Number.isNaN(date.getTime())
      ? `Available from ${new Intl.DateTimeFormat(options.locale ?? "en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: options.timeZone,
        }).format(date)}`
      : "Available once every desktop app can be updated";
  return { ...base, visible: true, disabled: true, note };
}

export type TrackingPolicyInput = {
  workspaceName: string;
  workspaceRole: string;
  ownerName: string | null;
  condition: WorkspaceCondition;
  /** `null` when the saved policy has not been read: never edit defaults as if saved. */
  saved: ScreenshotPolicy | null;
  edits: PolicyEdits;
  /** The BFF refused the read behind the same Administration gate: name it, do not edit defaults. */
  refused?: boolean;
};

export type TrackingPolicyModel =
  | { kind: "refusal"; refusal: string }
  | { kind: "unreadable"; note: string }
  | {
      kind: "ready";
      editable: boolean;
      form: PolicyForm;
      /** Only the keys that changed; the save sends this and nothing else. */
      patch: Partial<ScreenshotPolicy>;
      dirty: boolean;
      issue: string | null;
      canSave: boolean;
      writeRefusal: string | null;
      footnote: string;
      hints: TrackingPolicyHints;
    };

export type TrackingPolicyHints = {
  activeHours: string;
  idleTimeout: string;
  lowActivity: string;
  prompt: string;
  countdown: string;
};

/** What each idle and active-hours field does on the Device, for the draft as it stands. */
export function trackingPolicyHints(draft: ScreenshotPolicy): TrackingPolicyHints {
  const clock = "Uses each Member's computer clock, not a Workspace time zone.";
  const span =
    isTrackingPolicyClockTime(draft.activeHoursStart) &&
    isTrackingPolicyClockTime(draft.activeHoursEnd)
      ? draft.activeHoursStart === draft.activeHoursEnd
        ? " The same start and end restricts nothing."
        : draft.activeHoursStart > draft.activeHoursEnd
          ? ` From ${draft.activeHoursStart} to ${draft.activeHoursEnd} runs overnight, into the next morning.`
          : ""
      : "";
  return {
    activeHours: `${clock}${span}`,
    idleTimeout: `After ${draft.idleTimeoutMinutes} min without keyboard or mouse input, the Timer pauses and the idle time is not counted.`,
    lowActivity: `A capture is low activity when both keyboard and mouse are below ${draft.lowActivityThresholdPercent} % of the minute before it. It is a fact about the capture, not a score.`,
    prompt: draft.idlePromptEnabled
      ? `The Member is asked first and has ${draft.idleCountdownSeconds} s to answer before the Timer pauses.`
      : "The Timer pauses at the timeout without asking. The Member resumes it.",
    countdown: "Shown on the idle prompt. When it reaches zero with no answer, the Timer pauses.",
  };
}

export function normalizeScreenshotPolicy(policy: Partial<ScreenshotPolicy> | null | undefined): ScreenshotPolicy {
  return { ...DEFAULT_SCREENSHOT_POLICY, ...(policy ?? {}) };
}

/** The sign-off a saved policy gets: what happens next, not a celebration. The desktop agent reads it every 60 s. */
export const TRACKING_POLICY_SAVED = "Policy saved. Devices apply it within a minute.";

export function composeTrackingPolicyEditor(input: TrackingPolicyInput): TrackingPolicyModel {
  if (input.refused || !canManageAdministration(input.workspaceRole)) {
    return {
      kind: "refusal",
      refusal: administrationRefusal({
        workspaceRole: input.workspaceRole,
        ownerName: input.ownerName,
      }),
    };
  }

  if (input.saved === null) {
    return {
      kind: "unreadable",
      note: "The Tracking Policy could not be read. Editing stays closed until it loads.",
    };
  }

  const readOnly = input.condition === "Read-only";
  const { patch, issue } = policyPatch(input.saved, input.edits);
  const dirty = Object.keys(patch).length > 0;

  return {
    kind: "ready",
    editable: !readOnly,
    form: policyForm(input.saved, input.edits),
    patch,
    dirty,
    issue,
    canSave: !readOnly && dirty && issue === null,
    writeRefusal: readOnly
      ? chromeRefusal({
          kind: "workspace-condition",
          workspaceName: input.workspaceName,
          condition: "Read-only",
        })
      : null,
    footnote: "Activity shows this policy to every Member. Devices apply it within a minute.",
    hints: trackingPolicyHints(effectivePolicy(input.saved, input.edits)),
  };
}

/* ── Workspace time zone (#341) ────────────────────────────────────────── */

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Every IANA zone the runtime knows, except those already taken, sorted. */
export function timezoneSuggestions(allowed: string[]): string[] {
  const taken = new Set(allowed);
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return supported.filter((zone) => !taken.has(zone)).sort();
}

/** The zones the combobox offers: the runtime's, and the saved one even when the runtime lists it under another name. */
export function workspaceTimeZoneChoices(saved: string | null | undefined): string[] {
  const zones = timezoneSuggestions([]);
  return saved && !zones.includes(saved) ? [saved, ...zones] : zones;
}

export type WorkspaceTimeZoneInput = {
  /** `null` when the Workspace settings have not been read. */
  saved: string | null | undefined;
  draft: string;
  editable: boolean;
};

export type WorkspaceTimeZoneModel = {
  /** The zone in force, or the plain statement that none is set. */
  current: string;
  copy: string;
  dirty: boolean;
  issue: string | null;
  canSave: boolean;
};

/** The Workspace time zone card (#341): the zone Workday Daily Update reminders count in. */
export function composeWorkspaceTimeZone(input: WorkspaceTimeZoneInput): WorkspaceTimeZoneModel {
  const draft = input.draft.trim();
  const dirty = draft !== (input.saved ?? "");
  const issue = draft && !isValidTimezone(draft) ? `"${draft}" is not a time zone DocuFlow knows.` : null;
  return {
    current: input.saved || "Not set",
    copy: "Workday Daily Update reminders go out at 18:00 in this time zone.",
    dirty,
    issue,
    canSave: input.editable && dirty && draft !== "" && issue === null,
  };
}
