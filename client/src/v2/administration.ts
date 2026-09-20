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
  PUBLIC_API_CAPABILITIES,
  VIEW_DAILY_UPDATES_CAPABILITY_ID,
  type ScreenshotPolicy,
} from "@shared/schema";
import { chromeRefusal } from "./chrome";
import { formatRelativeTime } from "./devices";
import { formatHours } from "./today";
import type { WorkspaceCondition } from "./workspace";

/**
 * Administration is a destination governed by the Workspace Role (#238), not a
 * Capability: `capabilities` has no row for it, so no Owner could grant one.
 */
export const ADMINISTRATION_DESTINATION = "Administration";

/** Who governs it, said the way a reader would say it. */
const ADMINISTRATION_ROLES = "the Owner and Administrators";

/**
 * The single refusal every Administration surface shows. It names the
 * destination, the authority that actually governs it, and the Workspace Role
 * the reader actually holds.
 */
export function administrationRefusal(input: {
  workspaceRole: string;
  ownerName?: string | null;
}): string {
  if (canManageAdministration(input.workspaceRole)) {
    // The Role qualifies and the read was refused anyway. Blaming the Role here
    // would be a second false reason, so say only what is known.
    return `${ADMINISTRATION_DESTINATION} could not be opened for your Membership in this Workspace.`;
  }
  return chromeRefusal({
    kind: "workspace-role",
    destination: ADMINISTRATION_DESTINATION,
    roles: ADMINISTRATION_ROLES,
    workspaceRole: input.workspaceRole,
    ownerName: input.ownerName,
  });
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function formatFullDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
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
  planKey: "legacy" | "trial" | "pro" | string;
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
  id: "checkout" | "seats" | "payment-method" | "cancel";
  label: string;
  /**
   * A destructive action is set apart, so the reflex that reaches a routine
   * button does not reach this one (#245, F1).
   */
  tone: "neutral" | "destructive";
  /** What the action costs, stated before it runs. `null` when it costs nothing. */
  consequence: string | null;
};

export type BillingModel = {
  available: boolean;
  plan: string;
  condition: "Trial" | "Active" | "Past due" | "Read-only" | null;
  seats: string;
  entitlements: string;
  /**
   * The entitlement sentence, and only when it says more than the WRITES figure
   * does. "Writes allowed." beside a figure reading Allowed is the same fact twice.
   */
  entitlementNote: string | null;
  /** What the seat field starts from, so it never contradicts the figure above it. */
  seatQuantityDefault: string;
  /** The subscription read as discrete facts, so the card is not three loose lines. */
  figures: AnalyticsFigure[];
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
      subhead: string;
      pagePrimary: "case-ink";
      writeRefusal: string | null;
      secretOnce: SecretOnce | null;
      serviceAccounts: {
        empty: boolean;
        emptyCopy: string;
        rows: ServiceAccountRow[];
        createAllowed: boolean;
      };
      webhookEndpoints: {
        empty: boolean;
        emptyCopy: string;
        rows: WebhookEndpointRow[];
        createAllowed: boolean;
      };
      billing: BillingModel;
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
  if (capabilityIds.length === 0) return "—";
  return capabilityIds.map((id) => CAPABILITY_LABELS.get(id) ?? id).join(" · ");
}

function planLabel(planKey: string): string {
  if (planKey === "trial") return "Trial";
  if (planKey === "pro") return "Pro";
  if (planKey === "legacy") return "Legacy";
  return planKey;
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

/** Whichever date actually governs the subscription next. */
function billingTermFigure(pin: BillingInput): AnalyticsFigure {
  if (pin.planKey === "trial" && pin.trialEndsAt) {
    return { label: "TRIAL ENDS", value: formatFullDay(pin.trialEndsAt) };
  }
  if (pin.cancelAtPeriodEnd && pin.periodEndsAt) {
    return { label: "ACCESS ENDS", value: formatFullDay(pin.periodEndsAt) };
  }
  if (pin.periodEndsAt) {
    return { label: "RENEWS", value: formatFullDay(pin.periodEndsAt) };
  }
  return { label: "RENEWS", value: "—" };
}

/** What cancelling ends, and when — the card says it before the action runs. */
function cancellationConsequence(pin: BillingInput): string {
  const tail = "Viewing, export, and recovery stay available.";
  if (pin.periodEndsAt) {
    return (
      `${planLabel(pin.planKey)} entitlements stay until ${formatFullDay(pin.periodEndsAt)}. ` +
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
      plan: "—",
      condition: input.condition === "Trial" || input.condition === "Past due" || input.condition === "Read-only"
        ? input.condition
        : null,
      seats: "Seat counts are not available.",
      entitlements: "",
      entitlementNote: null,
      seatQuantityDefault: "",
      figures: [],
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
  if (pin.planKey === "trial") {
    actions.push(routine("checkout", "Start Pro"));
  }
  if (!readOnly && pin.planKey === "pro") {
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

  const entitlements = readOnly
    ? "Writes blocked. Viewing, export, and recovery stay available."
    : "Writes allowed.";

  return {
    available: true,
    plan: planLabel(pin.planKey),
    condition,
    seats: `${pin.consumedSeatCount} of ${pin.purchasedSeatCapacity} Billable Seats consumed.`,
    entitlements,
    // Read-only carries a clause the figure cannot: what still works.
    entitlementNote: readOnly ? entitlements : null,
    seatQuantityDefault: String(pin.purchasedSeatCapacity),
    figures: [
      { label: "PLAN", value: planLabel(pin.planKey) },
      // The domain calls this the billing state. "CONDITION" was this card's own
      // word for it, and said the same thing as the chip in the header.
      { label: "BILLING STATE", value: condition ?? "—" },
      { label: "WRITES", value: readOnly ? "Blocked" : "Allowed" },
      {
        label: "BILLABLE SEATS",
        value: `${pin.consumedSeatCount} of ${pin.purchasedSeatCapacity}`,
      },
      billingTermFigure(pin),
    ],
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

  return {
    kind: "ready",
    subhead: `Operator controls for ${input.workspaceName}.`,
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
      emptyCopy: "No Service Accounts in this Workspace.",
      rows: serviceRows,
      createAllowed: !readOnly,
    },
    webhookEndpoints: {
      empty: webhookRows.length === 0,
      emptyCopy: "No Webhook Endpoints in this Workspace.",
      rows: webhookRows,
      createAllowed: !readOnly,
    },
    billing: composeBilling(input),
  };
}

/* ── Analytics (#212) ─────────────────────────────────────────────────────
 * Composed from the existing `/api/admin/analytics*` routes. Figures are
 * read, never animated: no chart decoration and no counting digits.
 */

export type AnalyticsRangePreset = "7d" | "30d" | "90d";

export type AnalyticsRange = { start: Date; end: Date };

export const ANALYTICS_RANGE_PRESETS: Array<{ id: AnalyticsRangePreset; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
];

const RANGE_DAYS: Record<AnalyticsRangePreset, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function analyticsRange(preset: AnalyticsRangePreset, now: Date): AnalyticsRange {
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - RANGE_DAYS[preset] * 24 * 60 * 60 * 1000);
  return { start, end };
}

function rangeQuery(range: AnalyticsRange): string {
  const params = new URLSearchParams();
  params.set("start", range.start.toISOString());
  params.set("end", range.end.toISOString());
  return params.toString();
}

export function analyticsOverviewPath(range: AnalyticsRange): string {
  return `/api/admin/analytics/overview?${rangeQuery(range)}`;
}

export function analyticsActivityPath(range: AnalyticsRange): string {
  return `/api/admin/analytics/activity?${rangeQuery(range)}`;
}

export function analyticsCoveragePath(range: AnalyticsRange): string {
  return `/api/admin/analytics/coverage?${rangeQuery(range)}`;
}

export function analyticsDevicesPath(): string {
  return "/api/admin/analytics/devices";
}

export function analyticsExportPath(range: AnalyticsRange): string {
  return `/api/admin/analytics/export?${rangeQuery(range)}`;
}

export function workspaceSettingsPath(): string {
  return "/api/admin/org-settings";
}

export type AnalyticsOverviewInput = {
  totalTrackedSeconds: number;
  totalIdleSeconds: number;
  entriesCount: number;
  runningNow: number;
  activeUsersToday: number;
  screenshotsInWindow: number;
  lowActivityEntries: number;
  revokedDevices: number;
};

export type AnalyticsActivityInput = {
  byUser: Array<{
    userId: string;
    userName: string;
    totalSeconds: number;
    idleSeconds: number;
    idleEventCount: number;
  }>;
};

export type AnalyticsCoverageInput = {
  summary: {
    totalTrackedSeconds: number;
    totalScreenshots: number;
    expectedScreenshots: number;
    coveragePercent: number | null;
    totalEntries: number;
    entriesWithoutScreenshots: number;
    lowCoverageEntries: number;
    deletedScreenshots: number;
  };
  byUser: Array<{
    userId: string;
    userName: string;
    trackedSeconds: number;
    entriesCount: number;
    entriesWithoutScreenshots: number;
    screenshotCount: number;
    expectedScreenshots: number;
    coveragePct: number | null;
  }>;
};

export type AnalyticsDeviceInput = {
  id: string;
  userId: string;
  userName: string;
  name: string;
  os: string | null;
  clientVersion: string | null;
  lastSeenAt: string | Date | null;
  revokedAt: string | Date | null;
  createdAt: string | Date | null;
};

export type AnalyticsInput = {
  now: Date;
  workspaceRole: string;
  ownerName: string | null;
  range: AnalyticsRange;
  overview: AnalyticsOverviewInput | null;
  activity: AnalyticsActivityInput | null;
  coverage: AnalyticsCoverageInput | null;
  devices: AnalyticsDeviceInput[];
  /** The BFF refused the read behind the same Administration gate — name it, do not draw an empty range. */
  refused?: boolean;
  /** A read failed for some other reason — say so; an outage is not an empty Workspace. */
  readFailed?: boolean;
};

export type AnalyticsFigure = { label: string; value: string };

export type AnalyticsActivityRow = {
  userId: string;
  who: string;
  tracked: string;
  idle: string;
  idleEvents: string;
};

export type AnalyticsCoverageRow = {
  userId: string;
  who: string;
  tracked: string;
  entries: string;
  evidence: string;
  coverage: string;
};

export type AnalyticsDeviceRow = {
  id: string;
  name: string;
  who: string;
  platform: string;
  lastSeen: string;
  status: "ACTIVE" | "REVOKED";
};

export type AnalyticsModel =
  | { kind: "refusal"; refusal: string }
  | { kind: "unreadable"; note: string }
  | {
      kind: "ready";
      rangeLabel: string;
      overview: AnalyticsFigure[];
      activity: {
        empty: boolean;
        emptyCopy: string;
        footnote: string;
        rows: AnalyticsActivityRow[];
      };
      coverage: {
        empty: boolean;
        emptyCopy: string;
        summary: AnalyticsFigure[];
        rows: AnalyticsCoverageRow[];
      };
      devices: { empty: boolean; emptyCopy: string; rows: AnalyticsDeviceRow[] };
      export: { href: string; label: string; filename: string };
    };

function formatDay(value: Date): string {
  return `${value.getDate()} ${MONTHS[value.getMonth()]}`;
}

function formatPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function platformLabel(device: AnalyticsDeviceInput): string {
  const parts = [device.os?.trim(), device.clientVersion?.trim()].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function toIsoOrNull(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function composeAnalytics(input: AnalyticsInput): AnalyticsModel {
  if (input.refused || !canManageAdministration(input.workspaceRole)) {
    return {
      kind: "refusal",
      refusal: administrationRefusal({
        workspaceRole: input.workspaceRole,
        ownerName: input.ownerName,
      }),
    };
  }

  if (input.readFailed) {
    return {
      kind: "unreadable",
      note: "Analytics could not be read for this range. Nothing here is a count of zero.",
    };
  }

  const overview: AnalyticsFigure[] = input.overview
    ? [
        { label: "TRACKED", value: formatHours(input.overview.totalTrackedSeconds) },
        { label: "IDLE", value: formatHours(input.overview.totalIdleSeconds) },
        { label: "TIME ENTRIES", value: String(input.overview.entriesCount) },
        { label: "RUNNING NOW", value: String(input.overview.runningNow) },
        { label: "ACTIVE TODAY", value: String(input.overview.activeUsersToday) },
        { label: "EVIDENCE", value: String(input.overview.screenshotsInWindow) },
        { label: "LOW ACTIVITY", value: String(input.overview.lowActivityEntries) },
        { label: "REVOKED DEVICES", value: String(input.overview.revokedDevices) },
      ]
    : [];

  const activityRows: AnalyticsActivityRow[] = (input.activity?.byUser ?? []).map((row) => ({
    userId: row.userId,
    who: row.userName,
    tracked: formatHours(row.totalSeconds),
    idle: formatHours(row.idleSeconds),
    idleEvents: String(row.idleEventCount),
  }));

  const coverageSummary: AnalyticsFigure[] = input.coverage
    ? [
        { label: "COVERAGE", value: formatPercent(input.coverage.summary.coveragePercent) },
        {
          label: "EVIDENCE",
          value: `${input.coverage.summary.totalScreenshots} of ${input.coverage.summary.expectedScreenshots}`,
        },
        {
          label: "ENTRIES WITHOUT EVIDENCE",
          value: String(input.coverage.summary.entriesWithoutScreenshots),
        },
        { label: "TOMBSTONED", value: String(input.coverage.summary.deletedScreenshots) },
      ]
    : [];

  const coverageRows: AnalyticsCoverageRow[] = (input.coverage?.byUser ?? []).map((row) => ({
    userId: row.userId,
    who: row.userName,
    tracked: formatHours(row.trackedSeconds),
    entries: String(row.entriesCount),
    evidence: `${row.screenshotCount} of ${row.expectedScreenshots}`,
    coverage: formatPercent(row.coveragePct),
  }));

  const deviceRows: AnalyticsDeviceRow[] = input.devices.map((device) => ({
    id: device.id,
    name: device.name,
    who: device.userName,
    platform: platformLabel(device),
    lastSeen: formatRelativeTime(toIsoOrNull(device.lastSeenAt), input.now),
    status: device.revokedAt ? "REVOKED" : "ACTIVE",
  }));

  return {
    kind: "ready",
    rangeLabel: `${formatDay(input.range.start)} – ${formatDay(input.range.end)}`,
    overview,
    activity: {
      empty: activityRows.length === 0,
      emptyCopy: "No tracked time in this range.",
      footnote: "Recorded totals with provenance. DocuFlow does not score or rank Members.",
      rows: activityRows,
    },
    coverage: {
      empty: coverageRows.length === 0,
      emptyCopy: "No Activity Evidence in this range.",
      summary: coverageSummary,
      rows: coverageRows,
    },
    devices: {
      empty: deviceRows.length === 0,
      emptyCopy: "No Device paired in this Workspace.",
      rows: deviceRows,
    },
    export: {
      href: analyticsExportPath(input.range),
      label: "Export CSV",
      filename: `docuflow-export-${isoDay(input.range.start)}.csv`,
    },
  };
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
  justSaved: boolean;
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
      savedNote: string | null;
      footnote: string;
      timezones: {
        rows: string[];
        empty: boolean;
        emptyCopy: string;
        dirty: boolean;
        canSave: boolean;
      };
    };

export type TimezoneEdit = { ok: true; timezones: string[] } | { ok: false; reason: string };

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
  if (draft.idleCountdownSeconds < 15 || draft.idleCountdownSeconds > 120) {
    return "Idle countdown must be between 15 and 120 seconds.";
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

export function removeAllowedTimezone(timezones: string[], value: string): string[] {
  return timezones.filter((timezone) => timezone !== value);
}

function samePolicy(a: ScreenshotPolicy, b: ScreenshotPolicy): boolean {
  return (Object.keys(DEFAULT_SCREENSHOT_POLICY) as Array<keyof ScreenshotPolicy>).every(
    (key) => a[key] === b[key],
  );
}

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
    savedNote: input.justSaved ? "Policy saved. Devices apply it on their next heartbeat." : null,
    footnote: "Activity shows this policy to every Member; Devices apply it on their next heartbeat.",
    timezones: {
      rows: input.draftTimezones,
      empty: input.draftTimezones.length === 0,
      emptyCopy: "No timezone curated — each Member's browser timezone is used.",
      dirty: timezonesDirty,
      canSave: !readOnly && timezonesDirty,
    },
  };
}
