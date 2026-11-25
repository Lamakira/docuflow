/**
 * Administration destination (#193), deepened with analytics, Tracking Policy,
 * and the remaining billing actions (#212).
 * Novelty: a newly created or rotated secret is shown once (rare state
 * indication); a saved Tracking Policy is signed off, not celebrated.
 * Do not animate: the settings form on every keystroke, billing numbers
 * counting up, analytics figures as decoration.
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
import { memberName } from "./today";
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
};

export type RevealedSecretInput = {
  kind: "service-account" | "webhook-endpoint";
  id: string;
  label: string;
  plaintext: string;
};

export type AdministrationInput = {
  workspaceName: string;
  ownerName: string | null;
  workspaceRole: string;
  condition: WorkspaceCondition;
  serviceAccounts: ServiceAccountInput[];
  webhookEndpoints: WebhookEndpointInput[];
  billing: BillingInput | null;
  revealedSecret: RevealedSecretInput | null;
  /** Active Memberships, for the Workspace and Members & Roles tabs (#281). */
  members?: WorkspaceMemberRow[];
};

export type AdministrationMemberRow = {
  id: string;
  name: string;
  email: string;
  workspaceRole: string;
};

export type ServiceAccountRow = {
  id: string;
  name: string;
  capabilities: string;
  status: "ACTIVE" | "REVOKED";
  rotate: boolean;
  revoke: boolean;
};

export type WebhookEndpointRow = {
  id: string;
  url: string;
  eventTypes: string;
  status: "ACTIVE" | "DISABLED";
  rotate: boolean;
  disable: boolean;
  enable: boolean;
};

export type BillingAction = {
  id: "checkout" | "plan" | "seats" | "payment-method" | "cancel";
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
  writes: { allowed: boolean; label: "Writes allowed" | "Writes blocked" };
  term: { label: string; value: string };
};

export type BillingModel = {
  available: boolean;
  plan: string;
  condition: "Trial" | "Active" | "Past due" | "Read-only" | null;
  seats: string;
  /** What the seat field starts from, so it never contradicts the figure above it. */
  seatQuantityDefault: string;
  /** The subscription read as a summary; `null` exactly when billing is not available. */
  summary: BillingSummary | null;
  actions: BillingAction[];
  checkout: "redirect";
};

export type SecretOnce = RevealedSecretInput & {
  confirmation: string;
};

export type AdministrationModel =
  | { kind: "refusal"; refusal: string; pagePrimary: "case-ink" }
  | {
      kind: "ready";
      pagePrimary: "case-ink";
      writeRefusal: string | null;
      secretOnce: SecretOnce | null;
      serviceAccounts: {
        empty: boolean;
        emptyCopy: string;
        emptyTitle: string;
        rows: ServiceAccountRow[];
        createAllowed: boolean;
      };
      webhookEndpoints: {
        empty: boolean;
        emptyCopy: string;
        emptyTitle: string;
        rows: WebhookEndpointRow[];
        createAllowed: boolean;
      };
      billing: BillingModel;
      workspace: {
        name: string;
        initials: string;
        roleBadge: string;
        owner: { name: string; initials: string } | null;
        members: string | null;
      };
      members: {
        empty: boolean;
        emptyCopy: string;
        /** Who reaches what, and where a Workspace Role is changed. */
        note: string;
        rows: AdministrationMemberRow[];
      };
    };

export function serviceAccountsPath(): string {
  return "/api/service-accounts";
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

export function hostedBillingSession(input: { url: string }): { kind: "redirect"; url: string } {
  return { kind: "redirect", url: input.url };
}

export function canManageAdministration(workspaceRole: string): boolean {
  const role = workspaceRole.trim().toUpperCase();
  return role === "OWNER" || role === "ADMINISTRATOR";
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

function capabilityLabel(capabilityIds: string[]): string {
  if (capabilityIds.length === 0) return "-";
  return capabilityIds.map((id) => CAPABILITY_LABELS.get(id) ?? id).join(" · ");
}

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
  return { label: "Renews", value: "-" };
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

/** Initials from the first two words; kept here because presentation.ts imports this module. */
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

/** What cancelling ends, and when — the card says it before the action runs. */
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

function composeBilling(input: AdministrationInput): BillingModel {
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
  if (!readOnly && pin.billingState === "Active" && !pin.cancelAtPeriodEnd) {
    actions.push({
      id: "cancel",
      label: "Cancel at period end",
      tone: "destructive",
      consequence: cancellationConsequence(pin),
    });
  }

  return {
    available: true,
    plan: planLabel(pin.planKey),
    condition,
    seats: `${pin.consumedSeatCount} of ${pin.purchasedSeatCapacity} Billable Seats consumed.`,
    seatQuantityDefault: String(pin.purchasedSeatCapacity),
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
        ? { allowed: false, label: "Writes blocked" }
        : { allowed: true, label: "Writes allowed" },
      term: billingTerm(pin),
    },
    actions,
    checkout: "redirect",
  };
}

export function composeAdministration(input: AdministrationInput): AdministrationModel {
  if (!canManageAdministration(input.workspaceRole)) {
    return {
      kind: "refusal",
      refusal: administrationRefusal({
        workspaceRole: input.workspaceRole,
        ownerName: input.ownerName,
      }),
      pagePrimary: "case-ink",
    };
  }

  const readOnly = input.condition === "Read-only";
  const serviceRows: ServiceAccountRow[] = input.serviceAccounts.map((row) => {
    const revoked = row.revokedAt != null;
    return {
      id: row.id,
      name: row.name,
      capabilities: capabilityLabel(row.capabilityIds),
      status: revoked ? "REVOKED" : "ACTIVE",
      rotate: !revoked,
      revoke: !revoked,
    };
  });
  const webhookRows: WebhookEndpointRow[] = input.webhookEndpoints.map((row) => {
    const disabled = row.disabledAt != null;
    return {
      id: row.id,
      url: row.url,
      eventTypes: row.eventTypes.join(" · "),
      status: disabled ? "DISABLED" : "ACTIVE",
      rotate: true,
      disable: !disabled,
      enable: disabled,
    };
  });
  const billing = composeBilling(input);
  const memberRows: AdministrationMemberRow[] = (input.members ?? []).map((row, index) => ({
    id: row.email || `member-${index}`,
    name: memberName(row),
    email: row.email ?? "",
    workspaceRole: workspaceRoleInCopy(row.workspaceRole),
  }));
  return {
    kind: "ready",
    pagePrimary: "case-ink",
    writeRefusal: readOnly
      ? chromeRefusal({
          kind: "workspace-condition",
          workspaceName: input.workspaceName,
          condition: "Read-only",
        })
      : null,
    secretOnce: input.revealedSecret
      ? {
          ...input.revealedSecret,
          confirmation: "Copy this now. It will not be shown again.",
        }
      : null,
    serviceAccounts: {
      empty: serviceRows.length === 0,
      emptyCopy: "A Service Account lets an integration call the public API with its own key. Create one to get a key.",
      emptyTitle: "Add your first Service Account",
      rows: serviceRows,
      createAllowed: !readOnly,
    },
    webhookEndpoints: {
      empty: webhookRows.length === 0,
      emptyCopy: "A Webhook Endpoint is a URL that receives the events you choose. Add one to start receiving them.",
      emptyTitle: "Add your first Webhook Endpoint",
      rows: webhookRows,
      createAllowed: !readOnly,
    },
    billing,
    workspace: {
      name: input.workspaceName,
      initials: nameInitials(input.workspaceName) || "WS",
      roleBadge: `You are ${workspaceRoleInCopy(input.workspaceRole)}`,
      owner: input.ownerName ? { name: input.ownerName, initials: nameInitials(input.ownerName) } : null,
      members: input.members
        ? `${input.members.length} ${input.members.length === 1 ? "Member" : "Members"}`
        : null,
    },
    members: {
      empty: memberRows.length === 0,
      emptyCopy: "No active Memberships in this Workspace.",
      note: `Analytics and Administration are open to ${ADMINISTRATION_ROLES}. A Workspace Role is changed in People.`,
      rows: memberRows,
    },
  };
}

/* ── Workspace settings (#212) ─────────────────────────────────────────────
 * Analytics left for its own module, analytics.ts.
 */

export function workspaceSettingsPath(): string {
  return "/api/admin/org-settings";
}

/* ── Tracking Policy and the Screencasts timezone list (#212) ─────────────
 * Both live on `/api/admin/org-settings`. The save is signed off, never
 * celebrated, and the form itself does not animate on a keystroke.
 */

export type TrackingPolicyInput = {
  workspaceName: string;
  workspaceRole: string;
  ownerName: string | null;
  condition: WorkspaceCondition;
  /** `null` when the saved policy has not been read — never edit defaults as if saved. */
  saved: ScreenshotPolicy | null;
  draft: ScreenshotPolicy;
  savedTimezones: string[];
  draftTimezones: string[];
  /** The BFF refused the read behind the same Administration gate — name it, do not edit defaults. */
  refused?: boolean;
};

export type TrackingPolicyModel =
  | { kind: "refusal"; refusal: string }
  | { kind: "unreadable"; note: string }
  | {
      kind: "ready";
      editable: boolean;
      dirty: boolean;
      issue: string | null;
      canSave: boolean;
      writeRefusal: string | null;
      footnote: string;
      hints: TrackingPolicyHints;
      timezones: {
        rows: string[];
        empty: boolean;
        emptyCopy: string;
        dirty: boolean;
        canSave: boolean;
      };
    };

export type TimezoneEdit = { ok: true; timezones: string[] } | { ok: false; reason: string };

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
          ? ` ${draft.activeHoursStart}–${draft.activeHoursEnd} runs overnight, into the next morning.`
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

/** Mirrors the `/api/admin/org-settings` bounds so a refusal is named before the PATCH. */
export function trackingPolicyIssue(draft: ScreenshotPolicy): string | null {
  if (draft.captureIntervalMinMin < 3) {
    return "Minimum capture interval must be at least 3 minutes.";
  }
  if (draft.captureIntervalMaxMin > 15) {
    return "Maximum capture interval cannot exceed 15 minutes.";
  }
  if (draft.captureIntervalMinMin > draft.captureIntervalMaxMin) {
    return "Minimum capture interval cannot exceed the maximum.";
  }
  if (draft.idleTimeoutMinutes < 1 || draft.idleTimeoutMinutes > 60) {
    return "Idle timeout must be between 1 and 60 minutes.";
  }
  if (!isLowActivityThreshold(draft.lowActivityThresholdPercent)) {
    return "Low-activity threshold must be a whole number from 0 to 100.";
  }
  if (draft.idleCountdownSeconds < 15 || draft.idleCountdownSeconds > 120) {
    return "Idle countdown must be between 15 and 120 seconds.";
  }
  if (
    !isTrackingPolicyClockTime(draft.activeHoursStart) ||
    !isTrackingPolicyClockTime(draft.activeHoursEnd)
  ) {
    return "Active hours must be 24-hour times such as 08:00.";
  }
  return null;
}

export function normalizeScreenshotPolicy(policy: Partial<ScreenshotPolicy> | null | undefined): ScreenshotPolicy {
  return { ...DEFAULT_SCREENSHOT_POLICY, ...(policy ?? {}) };
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function addAllowedTimezone(timezones: string[], candidate: string): TimezoneEdit {
  const value = candidate.trim();
  if (!value) {
    return { ok: false, reason: "Enter an IANA timezone, for example Europe/Paris." };
  }
  if (!isValidTimezone(value)) {
    return { ok: false, reason: `"${value}" is not a valid IANA timezone.` };
  }
  if (timezones.includes(value)) {
    return { ok: false, reason: `"${value}" is already in the list.` };
  }
  return { ok: true, timezones: [...timezones, value] };
}

/**
 * The zones the input offers as a list (#260). v1 chose from one; v2 kept the
 * free-text input and its validation, and suggests every IANA zone the runtime
 * knows that this Workspace does not allow yet.
 */
export function timezoneSuggestions(allowed: string[]): string[] {
  const taken = new Set(allowed);
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return supported.filter((zone) => !taken.has(zone)).sort();
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
  const issue = draft && !isValidTimezone(draft) ? `"${draft}" is not a valid IANA timezone.` : null;
  return {
    current: input.saved || "Not set",
    copy: "The Workday Daily Update reminders and notifications count in this time zone: the reminder goes out at 18:00 here.",
    dirty,
    issue,
    canSave: input.editable && dirty && draft !== "" && issue === null,
  };
}

export function removeAllowedTimezone(timezones: string[], value: string): string[] {
  return timezones.filter((timezone) => timezone !== value);
}

function samePolicy(a: ScreenshotPolicy, b: ScreenshotPolicy): boolean {
  return (Object.keys(DEFAULT_SCREENSHOT_POLICY) as Array<keyof ScreenshotPolicy>).every(
    (key) =>
      key === "screenshotProjectIds"
        ? (a[key] ?? []).join("\n") === (b[key] ?? []).join("\n") && (a[key] === null) === (b[key] === null)
        : a[key] === b[key],
  );
}

/** The sign-off a saved policy gets: what happens next, not a celebration. */
export const TRACKING_POLICY_SAVED = "Policy saved. Devices apply it on their next heartbeat.";

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
  const issue = trackingPolicyIssue(input.draft);
  const dirty = !samePolicy(input.saved, input.draft);
  const timezonesDirty =
    input.savedTimezones.length !== input.draftTimezones.length ||
    input.savedTimezones.some((timezone, index) => timezone !== input.draftTimezones[index]);

  return {
    kind: "ready",
    editable: !readOnly,
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
    footnote: "Activity shows this policy to every Member; Devices apply it on their next heartbeat.",
    hints: trackingPolicyHints(input.draft),
    timezones: {
      rows: input.draftTimezones,
      empty: input.draftTimezones.length === 0,
      emptyCopy: "No timezone curated: each Member's browser timezone is used.",
      dirty: timezonesDirty,
      canSave: !readOnly && timezonesDirty,
    },
  };
}
