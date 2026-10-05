/**
 * The back office (#314), inside the platform console (#266).
 *
 * Platform Staff run the product from six tabs: Workspaces, Users,
 * Subscriptions, Disputes, Stats and Support access. Every figure here is a
 * Workspace's billing or support fact, never its content. Money is shown per
 * currency and never converted or added across currencies.
 *
 * The types below mirror the HTTP contract of the `/api/platform/*` routes; the
 * client does not import server code.
 */

import { formatWhen } from "./today";

export type BillingStateName = "Trialing" | "Active" | "PastDue" | "ReadOnly";
export type BackOfficeStatus = "trial" | "offered" | "active" | "past_due" | "read_only" | "cancelled";

export type PlatformWorkspaceRow = {
  id: string;
  name: string;
  owner: { userId: string; name: string; email: string } | null;
  planKey: string | null;
  planLabel: string | null;
  billingState: BillingStateName | null;
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

export type SupportCategory = "billing" | "bug" | "account" | "other";
export type SupportStatus = "open" | "in_progress" | "resolved";

export type PlatformSupportRequestRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  user: { userId: string; name: string; email: string };
  category: SupportCategory;
  message: string;
  status: SupportStatus;
  assignedStaff: { id: string; email: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type PlatformSupportRequestDetail = PlatformSupportRequestRow & {
  entries: Array<{
    id: string;
    kind: "answer" | "note";
    body: string;
    staff: { id: string; email: string | null } | null;
    createdAt: string;
    emailedAt: string | null;
  }>;
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

export type PlatformUserWorkspace = {
  workspaceId: string;
  workspaceName: string;
  workspaceRole: string;
  archived: boolean;
};

export type PlatformStaffOption = { id: string; email: string | null };

export type PlatformSupportGrant = {
  grantId: string;
  workspaceId: string;
  workspaceName: string;
  expiresAt: string;
  createdAt: string;
};

export type OperatorWorkspaceView = {
  id: string;
  name: string;
  access: "grant" | "break_glass";
  projects: Array<{ id: string; name: string }>;
};

/* ----------------------------------------------------------------- tabs --- */

export const BACK_OFFICE_TAB_IDS = ["workspaces", "users", "subscriptions", "disputes", "stats", "access"] as const;
export type BackOfficeTabId = (typeof BACK_OFFICE_TAB_IDS)[number];

const TAB_LABEL: Record<BackOfficeTabId, string> = {
  workspaces: "Workspaces",
  users: "Users",
  subscriptions: "Subscriptions",
  disputes: "Disputes & Support",
  stats: "Stats",
  access: "Support access",
};

export const BACK_OFFICE_HOME = "/platform/workspaces";

export function backOfficeTabHref(tab: BackOfficeTabId): string {
  return `/platform/${tab}`;
}

export function backOfficeTabs(current: BackOfficeTabId): Array<{
  id: BackOfficeTabId;
  label: string;
  href: string;
  current: boolean;
}> {
  return BACK_OFFICE_TAB_IDS.map((id) => ({
    id,
    label: TAB_LABEL[id],
    href: backOfficeTabHref(id),
    current: id === current,
  }));
}

export function workspacePageHref(workspaceId: string): string {
  return `/platform/workspaces/${workspaceId}`;
}

export function supportRequestHref(requestId: string): string {
  return `/platform/disputes/requests/${requestId}`;
}

export type BackOfficeLocation =
  | { kind: "tab"; tab: BackOfficeTabId }
  | { kind: "workspace"; tab: "workspaces"; workspaceId: string }
  | { kind: "support-request"; tab: "disputes"; requestId: string };

/** Reads a `/platform/...` path; null when it names nothing the back office has. */
export function parseBackOfficePath(path: string): BackOfficeLocation | null {
  const pathname = (path.split("?")[0] || "/").replace(/\/+$/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "platform") return null;
  if (parts.length === 1) return { kind: "tab", tab: "workspaces" };
  const tab = parts[1] as BackOfficeTabId;
  if (!(BACK_OFFICE_TAB_IDS as readonly string[]).includes(tab)) return null;
  if (parts.length === 2) return { kind: "tab", tab };
  if (tab === "workspaces" && parts.length === 3) return { kind: "workspace", tab, workspaceId: parts[2] };
  if (tab === "disputes" && parts.length === 4 && parts[2] === "requests") {
    return { kind: "support-request", tab, requestId: parts[3] };
  }
  return null;
}

/* ---------------------------------------------------------------- paths --- */

export const platformWorkspacesPath = () => "/api/platform/workspaces";
export const platformWorkspacePath = (id: string) => `/api/platform/workspaces/${id}`;
export const platformTrialExtensionPath = (id: string) => `/api/platform/workspaces/${id}/trial-extension`;
export const platformOfferedPlanPath = (id: string) => `/api/platform/workspaces/${id}/offered-plan`;
export const platformCancelAtPeriodEndPath = (id: string) => `/api/platform/workspaces/${id}/cancel-at-period-end`;
export const platformUserWorkspacesPath = (userId: string) => `/api/platform/users/${userId}/workspaces`;
export const platformSubscriptionsPath = () => "/api/platform/subscriptions";
export const platformDisputesPath = () => "/api/platform/disputes";
export const platformSupportRequestsPath = () => "/api/platform/support-requests";
export const platformSupportRequestPath = (id: string) => `/api/platform/support-requests/${id}`;
export const platformSupportAnswersPath = (id: string) => `/api/platform/support-requests/${id}/answers`;
export const platformSupportNotesPath = (id: string) => `/api/platform/support-requests/${id}/notes`;
export const platformStatsPath = (days: number) => `/api/platform/stats?days=${days}`;
export const platformStaffPath = () => "/api/platform/staff";
export const platformSupportAccessPath = () => "/api/platform/support-access";
export const operatorWorkspacePath = (id: string) => `/api/operator/workspaces/${id}`;
export const operatorBreakGlassPath = (id: string) => `/api/operator/workspaces/${id}/break-glass`;

export type AuditFilters = { workspaceId: string; platformStaffId: string; action: string };

/** An empty filter is left off the query. */
export function platformAuditEventsPath(filters: Partial<AuditFilters> = {}): string {
  const params = new URLSearchParams();
  if (filters.workspaceId) params.set("workspaceId", filters.workspaceId);
  if (filters.platformStaffId) params.set("platformStaffId", filters.platformStaffId);
  if (filters.action?.trim()) params.set("action", filters.action.trim());
  const query = params.toString();
  return `/api/platform/audit-events${query ? `?${query}` : ""}`;
}

/* -------------------------------------------------------------- formats --- */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `5 OCT 2026`, or a dash when there is no date. */
export function dayLabel(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** `5 OCT 2026, 14:30`. */
export function dateTimeLabel(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${dayLabel(value)}, ${clock(date)}`;
}

/** Minor units in their own currency; never converted. */
export function formatMoney(amountMinor: number | null, currency: string | null): string {
  if (amountMinor == null || !currency) return "—";
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** digits);
  } catch {
    return `${amountMinor} ${currency.toUpperCase()}`;
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function titleCase(value: string): string {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const roleLabel = titleCase;

const INTERVAL_LABEL = { monthly: "Monthly", annual: "Annual" } as const;

/* ------------------------------------------------------------- workspaces --- */

export const BACK_OFFICE_STATUS_LABEL: Record<BackOfficeStatus, string> = {
  trial: "Trial",
  offered: "Offered Plan",
  active: "Active",
  past_due: "Past due",
  read_only: "Read-only",
  cancelled: "Cancelled",
};

export type StatusFilter = BackOfficeStatus | "all";

export const statusFilterOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All states" },
  ...(Object.keys(BACK_OFFICE_STATUS_LABEL) as BackOfficeStatus[]).map((value) => ({
    value,
    label: BACK_OFFICE_STATUS_LABEL[value],
  })),
];

export const ALL_PLANS = "all";

/** The Plans present in the rows, in the order they first appear, after "All Plans". */
export function planFilterOptions(rows: PlatformWorkspaceRow[]): Array<{ value: string; label: string }> {
  const plans = new Map<string, string>();
  for (const row of rows) {
    if (row.planKey && !plans.has(row.planKey)) plans.set(row.planKey, row.planLabel ?? row.planKey);
  }
  return [
    { value: ALL_PLANS, label: "All Plans" },
    ...[...plans.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

function statusLabel(status: BackOfficeStatus | null): string {
  return status ? BACK_OFFICE_STATUS_LABEL[status] : "No Plan";
}

function planState(row: PlatformWorkspaceRow): string {
  return `${row.planLabel ?? "No Plan"} · ${statusLabel(row.status)}`;
}

function seatsLabel(row: PlatformWorkspaceRow): string {
  return `${row.seatsUsed} / ${row.seatsPurchased}`;
}

/** The Trial end for a Trial or an Offered Plan, the period end for a Subscription. */
function endsLabel(row: PlatformWorkspaceRow): string {
  const trialLike = row.status === "trial" || row.status === "offered";
  const end = trialLike ? row.trialEndsAt : row.periodEndsAt;
  if (!end) return "—";
  return row.cancelAtPeriodEnd ? `${dayLabel(end)} · cancels` : dayLabel(end);
}

export type WorkspaceRegisterRow = {
  id: string;
  href: string;
  name: string;
  owner: string;
  status: BackOfficeStatus | null;
  planState: string;
  seats: string;
  members: string;
  ends: string;
  created: string;
  lastActivity: string;
};

export type WorkspaceRegisterModel = {
  columns: ["WORKSPACE", "PLAN · STATE", "SEATS", "ENDS", "CREATED", "LAST ACTIVITY"];
  filterPlaceholder: string;
  rows: WorkspaceRegisterRow[];
  count: number;
  countLabel: string;
  empty: boolean;
  emptyCopy: string;
};

function ownerLine(owner: PlatformWorkspaceRow["owner"]): string {
  return owner ? `${owner.name} · ${owner.email}` : "No Owner";
}

export function composeWorkspaceRegister(input: {
  rows: PlatformWorkspaceRow[];
  query: string;
  status: StatusFilter;
  plan: string;
  now: Date;
}): WorkspaceRegisterModel {
  const needle = input.query.trim().toLowerCase();
  const filtered = input.rows.filter((row) => {
    if (input.status !== "all" && row.status !== input.status) return false;
    if (input.plan !== ALL_PLANS && row.planKey !== input.plan) return false;
    if (!needle) return true;
    return `${row.name} ${row.owner?.name ?? ""} ${row.owner?.email ?? ""} ${row.planLabel ?? ""}`
      .toLowerCase()
      .includes(needle);
  });
  const rows = filtered.map((row) => ({
    id: row.id,
    href: workspacePageHref(row.id),
    name: row.name,
    owner: ownerLine(row.owner),
    status: row.status,
    planState: planState(row),
    seats: seatsLabel(row),
    members: plural(row.memberCount, "member", "members"),
    ends: endsLabel(row),
    created: dayLabel(row.createdAt),
    lastActivity: formatWhen(row.lastActivityAt, input.now) || "—",
  }));
  const narrowed = needle !== "" || input.status !== "all" || input.plan !== ALL_PLANS;
  return {
    columns: ["WORKSPACE", "PLAN · STATE", "SEATS", "ENDS", "CREATED", "LAST ACTIVITY"],
    filterPlaceholder: "Search by Workspace, Owner name, email or Plan",
    rows,
    count: rows.length,
    countLabel: plural(rows.length, "WORKSPACE", "WORKSPACES"),
    empty: rows.length === 0,
    emptyCopy:
      rows.length > 0 ? "" : narrowed ? "No Workspace matches this filter." : "No Workspaces on the platform yet.",
  };
}

/* ---------------------------------------------------------- subscriptions --- */

export type SubscriptionRegisterModel = {
  columns: ["WORKSPACE", "PLAN", "INTERVAL", "SEATS", "STATE", "PERIOD OR TRIAL END"];
  rows: Array<{
    id: string;
    href: string;
    name: string;
    owner: string;
    plan: string;
    interval: string;
    seats: string;
    state: string;
    ends: string;
  }>;
  countLabel: string;
  empty: boolean;
  emptyCopy: string;
};

export function composeSubscriptions(rows: PlatformWorkspaceRow[]): SubscriptionRegisterModel {
  return {
    columns: ["WORKSPACE", "PLAN", "INTERVAL", "SEATS", "STATE", "PERIOD OR TRIAL END"],
    rows: rows.map((row) => ({
      id: row.id,
      href: workspacePageHref(row.id),
      name: row.name,
      owner: ownerLine(row.owner),
      plan: row.planLabel ?? "No Plan",
      interval: row.billingInterval ? INTERVAL_LABEL[row.billingInterval] : "—",
      seats: seatsLabel(row),
      state: statusLabel(row.status),
      ends: endsLabel(row),
    })),
    countLabel: plural(rows.length, "SUBSCRIPTION", "SUBSCRIPTIONS"),
    empty: rows.length === 0,
    emptyCopy: "No paid Subscription or Offered Plan yet.",
  };
}

/* ------------------------------------------------------ workspace actions --- */

export type WorkspaceActionKind = "extend-trial" | "offer-plan" | "cancel" | "undo-cancel";

export type WorkspaceAction = {
  kind: WorkspaceActionKind;
  label: string;
  title: string;
  consequence: string;
  confirmLabel: string;
  destructive: boolean;
  /** Fields the confirm dialog asks for, in order. */
  fields: Array<"days" | "plan" | "seats">;
  /** The Plans an Offered Plan can pick from. */
  plans: Array<{ value: string; label: string }>;
  daysMax: number;
  daysDefault: string;
};

export const STRIPE_DASHBOARD_NOTE = "Refunds, invoices and payment methods are handled in the Stripe Dashboard.";

function composeActions(detail: PlatformWorkspaceDetail): WorkspaceAction[] {
  const { subscription: sub } = detail;
  const name = detail.name;
  const base = { plans: [], daysMax: 0, daysDefault: "", destructive: false, fields: [] as WorkspaceAction["fields"] };
  const actions: WorkspaceAction[] = [];
  if (sub.canExtendTrial) {
    actions.push({
      ...base,
      kind: "extend-trial",
      label: "Extend Trial",
      title: `Extend the Trial of ${name}`,
      consequence: `The Trial of ${name} ends later by the days you enter. The Owner and Members keep full access until then.`,
      confirmLabel: "Extend Trial",
      fields: ["days"],
      daysMax: 90,
      daysDefault: "14",
    });
  }
  if (sub.canOfferPlan) {
    actions.push({
      ...base,
      kind: "offer-plan",
      label: "Offer a Plan",
      title: `Offer a Plan to ${name}`,
      consequence: `${name} gets the chosen Plan for the days you enter, free of charge. It ends like a Trial: the Workspace becomes Read-only when it ends unless the Owner subscribes.`,
      confirmLabel: "Offer Plan",
      fields: ["plan", "days", "seats"],
      plans: detail.offerablePlans.map((plan) => ({ value: plan.planKey, label: plan.label })),
      daysMax: 365,
      daysDefault: "30",
    });
  }
  const periodEnd = dayLabel(detail.periodEndsAt);
  if (sub.canCancel) {
    actions.push({
      ...base,
      kind: "cancel",
      label: "Cancel at period end",
      title: `Cancel the Subscription of ${name} at period end`,
      consequence: `The Subscription stays active until ${periodEnd}, then ends and ${name} becomes Read-only. ${STRIPE_DASHBOARD_NOTE}`,
      confirmLabel: "Cancel at period end",
      destructive: true,
    });
  }
  if (sub.canUndoCancel) {
    actions.push({
      ...base,
      kind: "undo-cancel",
      label: "Undo cancellation",
      title: `Undo the cancellation for ${name}`,
      consequence: `The Subscription of ${name} keeps renewing after ${periodEnd}. The Workspace stays Active.`,
      confirmLabel: "Undo cancellation",
    });
  }
  return actions;
}

function wholeNumber(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

export type BodyResult<T> = { ok: true; body: T } | { ok: false; reason: string };

export function trialExtensionBody(input: { days: string }): BodyResult<{ days: number }> {
  const days = wholeNumber(input.days);
  if (days == null || days < 1 || days > 90) return { ok: false, reason: "Enter a whole number of days from 1 to 90." };
  return { ok: true, body: { days } };
}

export function offeredPlanBody(input: {
  planKey: string;
  days: string;
  seats: string;
}): BodyResult<{ planKey: string; days: number; seats?: number }> {
  if (!input.planKey) return { ok: false, reason: "Choose a Plan to offer." };
  const days = wholeNumber(input.days);
  if (days == null || days < 1 || days > 365) return { ok: false, reason: "Enter a whole number of days from 1 to 365." };
  if (input.seats.trim() === "") return { ok: true, body: { planKey: input.planKey, days } };
  const seats = wholeNumber(input.seats);
  if (seats == null || seats < 1) return { ok: false, reason: "Seats must be a whole number of 1 or more, or left empty." };
  return { ok: true, body: { planKey: input.planKey, days, seats } };
}

export function cancelBody(action: "cancel" | "undo-cancel"): { cancel: boolean } {
  return { cancel: action === "cancel" };
}

/** The toast once an action went through. */
export function workspaceActionDone(kind: WorkspaceActionKind): string {
  if (kind === "extend-trial") return "Trial extended";
  if (kind === "offer-plan") return "Plan offered";
  if (kind === "cancel") return "Subscription set to cancel at period end";
  return "Cancellation undone";
}

/* ---------------------------------------------------------- workspace page --- */

export type WorkspacePageModel = {
  title: string;
  subhead: string;
  status: BackOfficeStatus | null;
  statusLabel: string;
  facts: Array<{ label: string; value: string }>;
  subscription: {
    figures: Array<{ label: string; value: string }>;
    actions: WorkspaceAction[];
    stripeLinks: Array<{ label: string; href: string }>;
    stripeNote: string;
  };
  payments: {
    rows: Array<{ id: string; invoice: string; outcome: "Paid" | "Failed"; failed: boolean; amount: string; when: string; stripeUrl: string | null }>;
    emptyCopy: string;
  };
  disputes: { rows: DisputeRow[]; emptyCopy: string };
  supportRequests: { rows: SupportRequestRow[]; emptyCopy: string };
  members: {
    rows: Array<{ id: string; name: string; email: string; role: string; archived: boolean }>;
    emptyCopy: string;
  };
  auditEvents: { rows: AuditRow[]; emptyCopy: string };
  breakGlass: { label: string };
};

export function composeWorkspacePage(detail: PlatformWorkspaceDetail, now: Date): WorkspacePageModel {
  const { subscription: sub } = detail;
  const unit = sub.unitAmountMinor != null && sub.currency
    ? `${formatMoney(sub.unitAmountMinor, sub.currency)} per seat${
        detail.billingInterval ? ` per ${detail.billingInterval === "annual" ? "year" : "month"}` : ""
      }`
    : "—";
  const stripeLinks: Array<{ label: string; href: string }> = [];
  if (sub.stripeCustomerUrl) stripeLinks.push({ label: "Stripe customer", href: sub.stripeCustomerUrl });
  if (sub.stripeSubscriptionUrl) stripeLinks.push({ label: "Stripe subscription", href: sub.stripeSubscriptionUrl });

  return {
    title: detail.name,
    subhead: `Owner ${ownerLine(detail.owner)}`,
    status: detail.status,
    statusLabel: statusLabel(detail.status),
    facts: [
      { label: "OWNER", value: ownerLine(detail.owner) },
      { label: "MEMBERS", value: plural(detail.memberCount, "member", "members") },
      { label: "CREATED", value: dayLabel(detail.createdAt) },
      { label: "LAST ACTIVITY", value: formatWhen(detail.lastActivityAt, now) || "—" },
    ],
    subscription: {
      figures: [
        { label: "PLAN", value: detail.planLabel ?? "No Plan" },
        { label: "INTERVAL", value: detail.billingInterval ? INTERVAL_LABEL[detail.billingInterval] : "—" },
        { label: "BILLABLE SEATS", value: seatsLabel(detail) },
        { label: "STATE", value: statusLabel(detail.status) },
        { label: "TRIAL END", value: dayLabel(detail.trialEndsAt) },
        { label: "PERIOD END", value: dayLabel(detail.periodEndsAt) },
        { label: "CANCEL AT PERIOD END", value: detail.cancelAtPeriodEnd ? "Yes" : "No" },
        { label: "UNIT PRICE", value: unit },
      ],
      actions: composeActions(detail),
      stripeLinks,
      stripeNote: STRIPE_DASHBOARD_NOTE,
    },
    payments: {
      rows: detail.payments.map((payment) => ({
        id: payment.id,
        invoice: payment.providerInvoiceId,
        outcome: payment.outcome === "paid" ? "Paid" : "Failed",
        failed: payment.outcome === "failed",
        amount: formatMoney(payment.amountMinor, payment.currency),
        when: dateTimeLabel(payment.occurredAt),
        stripeUrl: payment.stripeUrl,
      })),
      emptyCopy: "No payment recorded yet.",
    },
    disputes: { rows: detail.disputes.map(disputeRow), emptyCopy: "No payment dispute for this Workspace." },
    supportRequests: {
      rows: detail.supportRequests.map((row) => supportRequestRow(row, now)),
      emptyCopy: "No Support Request from this Workspace.",
    },
    members: {
      rows: detail.members.map((member) => ({
        id: member.userId,
        name: member.name,
        email: member.email,
        role: roleLabel(member.workspaceRole),
        archived: member.archived,
      })),
      emptyCopy: "No Member in this Workspace.",
    },
    auditEvents: {
      rows: detail.auditEvents.map((event) => auditRow(event)),
      emptyCopy: "No Audit Event for this Workspace.",
    },
    breakGlass: { label: "Break-glass" },
  };
}

/* ---------------------------------------------------------------- disputes --- */

export type DisputeRow = {
  id: string;
  workspaceId: string;
  workspace: string;
  href: string;
  amount: string;
  reason: string;
  status: string;
  open: boolean;
  opened: string;
  stripeUrl: string | null;
};

export type DisputesModel = {
  columns: ["WORKSPACE", "AMOUNT", "REASON", "STATUS", "OPENED"];
  note: string;
  rows: DisputeRow[];
  countLabel: string;
  empty: boolean;
  emptyCopy: string;
};

export const DISPUTES_NOTE = "Stripe answers disputes. They are listed here so Platform Staff can see them and open them in the Stripe Dashboard.";

function disputeRow(row: PlatformDisputeRow): DisputeRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspace: row.workspaceName,
    href: workspacePageHref(row.workspaceId),
    amount: formatMoney(row.amountMinor, row.currency),
    reason: titleCase(row.reason),
    status: titleCase(row.status),
    open: row.open,
    opened: dayLabel(row.openedAt),
    stripeUrl: row.stripeUrl,
  };
}

export function composeDisputes(rows: PlatformDisputeRow[]): DisputesModel {
  return {
    columns: ["WORKSPACE", "AMOUNT", "REASON", "STATUS", "OPENED"],
    note: DISPUTES_NOTE,
    rows: rows.map(disputeRow),
    countLabel: plural(rows.length, "DISPUTE", "DISPUTES"),
    empty: rows.length === 0,
    emptyCopy: "No payment dispute.",
  };
}

/* -------------------------------------------------------- support requests --- */

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  billing: "Billing",
  bug: "Bug",
  account: "Account",
  other: "Other",
};

export type SupportStatusFilter = SupportStatus | "all";

export const supportStatusFilterOptions: Array<{ value: SupportStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
];

export type SupportRequestRow = {
  id: string;
  href: string;
  workspace: string;
  user: string;
  category: string;
  preview: string;
  status: SupportStatus;
  statusLabel: string;
  assignee: string;
  when: string;
};

function preview(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

function supportRequestRow(row: PlatformSupportRequestRow, now: Date): SupportRequestRow {
  return {
    id: row.id,
    href: supportRequestHref(row.id),
    workspace: row.workspaceName,
    user: row.user.name,
    category: SUPPORT_CATEGORY_LABEL[row.category] ?? titleCase(row.category),
    preview: preview(row.message),
    status: row.status,
    statusLabel: SUPPORT_STATUS_LABEL[row.status],
    assignee: row.assignedStaff ? (row.assignedStaff.email ?? "Platform Staff") : "Unassigned",
    when: formatWhen(row.createdAt, now) || "—",
  };
}

export function composeSupportRequests(
  rows: PlatformSupportRequestRow[],
  filter: { status: SupportStatusFilter },
  now: Date,
) {
  const shown = rows.filter((row) => filter.status === "all" || row.status === filter.status);
  return {
    columns: ["WORKSPACE", "USER", "CATEGORY", "MESSAGE", "STATUS", "ASSIGNED", "RECEIVED"] as const,
    rows: shown.map((row) => supportRequestRow(row, now)),
    countLabel: plural(shown.length, "SUPPORT REQUEST", "SUPPORT REQUESTS"),
    empty: shown.length === 0,
    emptyCopy:
      shown.length > 0
        ? ""
        : filter.status === "all"
          ? "No Support Request yet."
          : `No ${SUPPORT_STATUS_LABEL[filter.status].toLowerCase()} Support Request.`,
  };
}

export const SUPPORT_ENTRY_MAX = 10000;

export type SupportRequestModel = {
  title: string;
  subhead: string;
  facts: Array<{ label: string; value: string }>;
  message: string;
  status: SupportStatus;
  statusOptions: Array<{ value: SupportStatus; label: string }>;
  assignedStaffId: string | null;
  entries: Array<{
    id: string;
    kind: "answer" | "note";
    label: string;
    author: string;
    when: string;
    body: string;
    detail: string;
  }>;
  entriesEmptyCopy: string;
  composer: { placeholder: string; answerHint: string; noteHint: string; answerLabel: string; noteLabel: string };
  workspaceHref: string;
};

export function composeSupportRequest(detail: PlatformSupportRequestDetail, now: Date): SupportRequestModel {
  return {
    title: `${SUPPORT_CATEGORY_LABEL[detail.category] ?? titleCase(detail.category)} · ${detail.workspaceName}`,
    subhead: `From ${detail.user.name} (${detail.user.email}), ${formatWhen(detail.createdAt, now) || dayLabel(detail.createdAt)}.`,
    facts: [
      { label: "WORKSPACE", value: detail.workspaceName },
      { label: "USER", value: `${detail.user.name} · ${detail.user.email}` },
      { label: "CATEGORY", value: SUPPORT_CATEGORY_LABEL[detail.category] ?? titleCase(detail.category) },
      { label: "RECEIVED", value: dateTimeLabel(detail.createdAt) },
    ],
    message: detail.message,
    status: detail.status,
    statusOptions: (Object.keys(SUPPORT_STATUS_LABEL) as SupportStatus[]).map((value) => ({
      value,
      label: SUPPORT_STATUS_LABEL[value],
    })),
    assignedStaffId: detail.assignedStaff?.id ?? null,
    entries: detail.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.kind === "answer" ? "Answer" : "Internal note",
      author: entry.staff?.email ?? "Platform Staff",
      when: dateTimeLabel(entry.createdAt),
      body: entry.body,
      detail:
        entry.kind === "answer"
          ? entry.emailedAt
            ? `Emailed to ${detail.user.email} on ${dateTimeLabel(entry.emailedAt)}`
            : `Emailed to ${detail.user.email}`
          : "Only Platform Staff see this note.",
    })),
    entriesEmptyCopy: "No answer or note yet.",
    composer: {
      placeholder: "Write an answer or an internal note",
      answerHint: `Send answer emails it to ${detail.user.name} (${detail.user.email}).`,
      noteHint: "Add internal note keeps it among Platform Staff; the User never sees it.",
      answerLabel: "Send answer",
      noteLabel: "Add internal note",
    },
    workspaceHref: workspacePageHref(detail.workspaceId),
  };
}

export function validateSupportEntry(body: string): BodyResult<{ body: string }> {
  const text = body.trim();
  if (!text) return { ok: false, reason: "Write something first." };
  if (text.length > SUPPORT_ENTRY_MAX) return { ok: false, reason: `Keep it under ${SUPPORT_ENTRY_MAX} characters.` };
  return { ok: true, body: { body: text } };
}

export function assigneeOptions(staff: PlatformStaffOption[]): Array<{ value: string; label: string }> {
  return [
    { value: "none", label: "Unassigned" },
    ...staff.map((member) => ({ value: member.id, label: member.email ?? "Platform Staff" })),
  ];
}

/* ------------------------------------------------------------------- stats --- */

export const statsPeriods: Array<{ value: "7" | "30" | "90"; label: string }> = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export const READ_ONLY_REASON_LABEL: Record<string, string> = {
  trial_expired: "Trial ended",
  offer_expired: "Offered Plan ended",
  dunning_exhausted: "Payment retries ran out",
  cancel_at_period_end: "Cancelled at period end",
  provider_projection: "Subscription ended",
  unknown: "Unknown",
};

export function readOnlyReasonLabel(reason: string): string {
  return READ_ONLY_REASON_LABEL[reason] ?? READ_ONLY_REASON_LABEL.unknown;
}

export type StatsGroup = {
  id: "growth" | "revenue" | "payments" | "usage";
  title: string;
  tiles: Array<{ label: string; value: string }>;
  lists: Array<{ title: string; lines: Array<{ label: string; value: string }>; emptyCopy: string }>;
};

export function composeStats(stats: PlatformStats): { period: string; groups: StatsGroup[] } {
  const count = (value: number) => String(value);
  return {
    period: `${stats.days} days`,
    groups: [
      {
        id: "growth",
        title: "Growth",
        tiles: [
          { label: "NEW USERS", value: count(stats.growth.newUsers) },
          { label: "NEW WORKSPACES", value: count(stats.growth.newWorkspaces) },
          { label: "ACTIVE WORKSPACES, 7 DAYS", value: count(stats.growth.activeWorkspaces7d) },
          { label: "ACTIVE WORKSPACES, 30 DAYS", value: count(stats.growth.activeWorkspaces30d) },
        ],
        lists: [],
      },
      {
        id: "revenue",
        title: "Revenue",
        tiles: [
          { label: "TRIALS IN PROGRESS", value: count(stats.revenue.trialsInProgress) },
          { label: "OFFERED PLANS IN PROGRESS", value: count(stats.revenue.offeredPlansInProgress) },
          { label: "TRIAL CONVERSIONS", value: count(stats.revenue.trialConversions) },
          { label: "CANCELLATIONS", value: count(stats.revenue.cancellations) },
        ],
        lists: [
          {
            // One line per currency: amounts in different currencies are never added.
            title: "MRR",
            lines: stats.revenue.mrr.map((line) => ({
              label: line.currency.toUpperCase(),
              value: formatMoney(line.amountMinor, line.currency),
            })),
            emptyCopy: "No recurring revenue yet",
          },
        ],
      },
      {
        id: "payments",
        title: "Payments",
        tiles: [
          { label: "FAILED PAYMENTS", value: count(stats.payments.failedPayments) },
          { label: "OPEN DISPUTES", value: count(stats.payments.openDisputes) },
        ],
        lists: [
          {
            title: "Read-only Workspaces by reason",
            lines: stats.payments.readOnlyByReason.map((entry) => ({
              label: readOnlyReasonLabel(entry.reason),
              value: count(entry.count),
            })),
            emptyCopy: "No Workspace is Read-only.",
          },
        ],
      },
      {
        id: "usage",
        title: "Usage",
        tiles: [
          { label: "HOURS TRACKED", value: stats.usage.hoursTracked.toFixed(1) },
          { label: "ACTIVE DESKTOP AGENTS", value: count(stats.usage.activeDesktopAgents) },
          { label: "SCREENSHOTS CAPTURED", value: count(stats.usage.screenshotsCaptured) },
        ],
        lists: [],
      },
    ],
  };
}

/* ---------------------------------------------------------- support access --- */

export function composeSupportAccess(grants: PlatformSupportGrant[]) {
  return {
    columns: ["WORKSPACE", "GRANTED", "EXPIRES"] as const,
    rows: grants.map((grant) => ({
      id: grant.grantId,
      workspaceId: grant.workspaceId,
      workspace: grant.workspaceName,
      granted: dateTimeLabel(grant.createdAt),
      expires: dateTimeLabel(grant.expiresAt),
    })),
    empty: grants.length === 0,
    emptyCopy: "No Support Access Grant is active for you. A Workspace Owner grants one from its Administration.",
  };
}

export function composeOperatorWorkspace(view: OperatorWorkspaceView) {
  return {
    title: view.name,
    access: view.access === "grant" ? "Support Access Grant" : "Break-glass",
    note: "Read-only. Nothing you open here can be changed.",
    projects: view.projects.map((project) => ({ id: project.id, name: project.name })),
    emptyCopy: "No Project in this Workspace.",
  };
}

export const BREAK_GLASS_REASON_MAX = 1000;

export function composeBreakGlass(workspaceName: string) {
  return {
    label: "Break-glass",
    title: `Break-glass into ${workspaceName}`,
    description: `Opens ${workspaceName} read-only without a Support Access Grant. The Owner is told, and your reason is recorded on an Audit Event.`,
    reasonLabel: "REASON",
    submitLabel: "Open with break-glass",
  };
}

export function validateBreakGlassReason(reason: string): BodyResult<{ reason: string }> {
  const text = reason.trim();
  if (!text) return { ok: false, reason: "Write why you need access." };
  if (text.length > BREAK_GLASS_REASON_MAX) {
    return { ok: false, reason: `Keep the reason under ${BREAK_GLASS_REASON_MAX} characters.` };
  }
  return { ok: true, body: { reason: text } };
}

/* --------------------------------------------------------------- audit log --- */

export type AuditRow = {
  id: string;
  action: string;
  actor: string;
  workspaceId: string;
  workspace: string;
  resource: string;
  when: string;
};

function auditRow(event: PlatformAuditEventRow): AuditRow {
  return {
    id: event.id,
    action: event.action,
    actor: event.actorLabel ?? titleCase(event.actorKind),
    workspaceId: event.workspaceId,
    workspace: event.workspaceName,
    resource: event.resourceId ? `${event.resourceType} · ${event.resourceId}` : event.resourceType,
    when: dateTimeLabel(event.createdAt),
  };
}

export function composeAuditLog(rows: PlatformAuditEventRow[], filters: Partial<AuditFilters>) {
  const narrowed = Boolean(filters.workspaceId || filters.platformStaffId || filters.action?.trim());
  return {
    columns: ["ACTION", "PLATFORM STAFF", "WORKSPACE", "RESOURCE", "WHEN"] as const,
    rows: rows.map((row) => auditRow(row)),
    countLabel: plural(rows.length, "AUDIT EVENT", "AUDIT EVENTS"),
    empty: rows.length === 0,
    emptyCopy: narrowed ? "No Audit Event matches these filters." : "No Platform Staff action recorded yet.",
  };
}

/* ------------------------------------------------------------------- users --- */

export function composeUserWorkspaces(rows: PlatformUserWorkspace[]) {
  return {
    rows: rows.map((row) => ({
      id: row.workspaceId,
      href: workspacePageHref(row.workspaceId),
      name: row.workspaceName,
      role: roleLabel(row.workspaceRole),
      archived: row.archived,
    })),
    empty: rows.length === 0,
    emptyCopy: "This User belongs to no Workspace.",
  };
}

/** The tone a state wears on the shared status pill. */
export function statusTone(status: BackOfficeStatus | null): "positive" | "active" | "alert" | undefined {
  if (status === "active") return "positive";
  if (status === "trial" || status === "offered") return "active";
  if (status) return "alert";
  return undefined;
}
