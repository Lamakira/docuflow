/**
 * People destination (#192, #211, F84, F88 to F91).
 * Novelty: accepting an Invitation is rare state indication (Membership
 * appears). A reader who may not change People is given no control to refuse.
 * Do not animate: register filter typing, role dropdown as decoration,
 * seat digits counting, the people list on load, hover on every avatar.
 */

import { emptyKindOf, emptyModelOf, type EmptyModel } from "./emptyState";
import { MONTHS, formatFullDate } from "./dates";
import { foldText } from "./text";
import { memberInitials, memberName } from "./today";

export const PEOPLE_INVITE_ROLES = ["MEMBER", "ADMINISTRATOR"] as const;
export type PeopleInviteRole = (typeof PEOPLE_INVITE_ROLES)[number];

/** The two roles a person can be given here, each with the one line saying what it allows. */
export const PEOPLE_ROLE_CHOICES: { value: PeopleInviteRole; label: string; line: string }[] = [
  { value: "MEMBER", label: "Member", line: "Works on their Projects. Cannot invite or manage people." },
  { value: "ADMINISTRATOR", label: "Administrator", line: "Manages People, Analytics and Administration." },
];

/** How long the UI lets Undo stand after an archive. */
export const ARCHIVE_UNDO_MS = 8000;

export type PeopleMembershipInput = {
  membershipId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  workspaceRole: string;
  capabilities: string[];
  archived: boolean;
  /** The grant on this Membership, 0 for everyone when the reader is a Member. */
  canViewDailyUpdates?: number;
  /** Whether the reader may change, archive or restore this row; the server decides. */
  manageable?: boolean;
};

export type PeopleInvitationInput = {
  id: string;
  email: string;
  workspaceRole: string;
  status: "pending" | "expired";
  expiresAt: string;
  invitedBy: string | null;
};

export type PeopleInput = {
  currentUserId: string;
  condition: "Trial" | "Read-only" | "Past due" | null;
  includeArchived: boolean;
  purchasedSeats: number | null;
  memberships: PeopleMembershipInput[];
  /** `null` when the list could not be read: no count, no rows, never `0 pending`. */
  invitations?: PeopleInvitationInput[] | null;
  filterQuery?: string;
  justAcceptedMembershipId?: string | null;
  /** Whether the reader may change People (an Owner or Administrator, Workspace not Read-only); omitted reads as yes. */
  canInvite?: boolean;
  /** Whether the reader is an Owner or Administrator, Read-only or not: the seat line is theirs. */
  canManage?: boolean;
};

export type PeopleRowState = "active" | "archived" | "invited" | "expired";

export type PeopleRow = {
  kind: "membership" | "invitation";
  membershipId: string;
  invitationId: string | null;
  userId: string;
  name: string;
  initials: string;
  email: string;
  /** "Owner", "Administrator", "Member". */
  workspaceRole: string;
  /** The role as the server spells it, for the settings dialog. */
  roleValue: string;
  /** `Daily Updates`, or `-`. */
  access: string;
  state: PeopleRowState;
  /** Plain text: `Active`, `Archived`, `Invited, expires 28 Nov`, `Invitation expired`. */
  status: string;
  /** The grant on the Membership, for the settings dialog. */
  canViewDailyUpdates: number;
  invitedBy: string | null;
  /** The row menu's actions, empty for a reader who may not act on it. */
  actions: ("settings" | "archive" | "restore" | "resend" | "revoke")[];
  justAccepted: boolean;
  self: boolean;
};

export type PeopleModel = {
  /** `3 Members`: the active ones. */
  chip: string;
  activeCount: number;
  /** The seat line, only for a manager who knows the seats. */
  seatCopy: string | null;
  empty: boolean;
  /** Why the register shows nothing (#325); null while it has rows. */
  emptyState: EmptyModel | null;
  rows: PeopleRow[];
  pagePrimary: "case-ink";
};

export type PeopleFilters = { q: string; archived: boolean };

export function readPeopleFilters(search: string): PeopleFilters {
  const params = new URLSearchParams(search);
  return { q: params.get("q") ?? "", archived: params.get("archived") === "1" };
}

/** The screen's query string, leaving defaults out so a plain screen stays `/people`. */
export function writePeopleFilters(search: string, filters: PeopleFilters): string {
  const params = new URLSearchParams(search);
  if (filters.q.trim()) params.set("q", filters.q);
  else params.delete("q");
  if (filters.archived) params.set("archived", "1");
  else params.delete("archived");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function workspaceMembershipsPath(opts: { includeArchived?: boolean } = {}): string {
  return opts.includeArchived
    ? "/api/workspace/memberships?includeArchived=true"
    : "/api/workspace/memberships";
}

export function workspaceInvitationsPath(): string {
  return "/api/workspace/invitations";
}

export function invitationAcceptPath(): string {
  return "/api/invitations/accept";
}

export function invitationLookupPath(): string {
  return "/api/invitations/lookup";
}

export function invitationPagePath(token: string): string {
  return `/invitations/${encodeURIComponent(token)}`;
}

export function myInvitationsPath(): string {
  return "/api/invitations";
}

export function membershipProfilePath(membershipId: string): string {
  return `/api/workspace/memberships/${membershipId}`;
}

export function membershipArchivePath(membershipId: string): string {
  return `/api/workspace/memberships/${membershipId}/archive`;
}

export function membershipRestorePath(membershipId: string): string {
  return `/api/workspace/memberships/${membershipId}/restore`;
}

export function invitationRevokePath(id: string): string {
  return `/api/workspace/invitations/${id}/revoke`;
}

export function invitationResendPath(id: string): string {
  return `/api/workspace/invitations/${id}/resend`;
}

/** The queries a change to People makes stale. */
export const PEOPLE_STALE_KEYS = [
  "/api/workspace/memberships",
  "/api/workspace/invitations",
  "/api/users",
  "/api/billing/subscription",
] as const;

/** `Owner`, `Administrator`, `Member`: the server's slug in sentence case. */
export function roleLabel(role: string): string {
  const lower = role.trim().toLowerCase();
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : "Member";
}

const ROLE_RANK: Record<string, number> = { OWNER: 0, ADMINISTRATOR: 1, MEMBER: 2 };

function roleRank(role: string): number {
  return ROLE_RANK[role.trim().toUpperCase()] ?? 3;
}

/** `28 Nov`, in the reader's time zone. */
function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

const DAILY_UPDATES_CAPABILITY = "view daily updates";

function accessLabel(row: PeopleMembershipInput): string {
  const capable = row.capabilities.some((name) => name.trim().toLowerCase() === DAILY_UPDATES_CAPABILITY);
  return capable || row.canViewDailyUpdates === 1 ? "Daily Updates" : "-";
}

function matchesFilter(query: string, row: { name: string; email: string }): boolean {
  if (!query.trim()) return true;
  const needle = foldText(query.trim());
  return foldText(row.name).includes(needle) || foldText(row.email).includes(needle);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

function seatLine(activeCount: number, pendingCount: number, purchased: number): string {
  const seats = purchased === 1 ? "Billable Seat" : "Billable Seats";
  const pending = pendingCount > 0 ? ` ${pendingCount} ${pendingCount === 1 ? "Invitation" : "Invitations"} pending.` : "";
  return `${activeCount} of ${purchased} ${seats} used.${pending}`;
}

/** The Invite dialog's line: an Invitation shows its seat impact before it is sent. */
export function invitePreview(workspaceName: string, activeCount: number, purchasedSeats: number | null): string {
  const join = `Send an Invitation to join ${workspaceName}.`;
  if (purchasedSeats == null) return `${join} It takes a Billable Seat when accepted.`;
  return `${join} ${activeCount} of ${purchasedSeats} Billable Seats used; it takes one when accepted.`;
}

export function composePeople(input: PeopleInput): PeopleModel {
  const invitations = input.invitations ?? [];
  const canAct = input.canInvite ?? true;
  const visible = input.memberships.filter((row) => input.includeArchived || !row.archived);
  const membershipRows: PeopleRow[] = visible.map((row) => {
    const archived = row.archived;
    const manageable = canAct && row.manageable === true;
    return {
      kind: "membership" as const,
      membershipId: row.membershipId,
      invitationId: null,
      userId: row.userId,
      name: memberName(row),
      initials: memberInitials(row),
      email: row.email,
      workspaceRole: roleLabel(row.workspaceRole),
      roleValue: row.workspaceRole.trim().toUpperCase(),
      access: accessLabel(row),
      state: archived ? ("archived" as const) : ("active" as const),
      status: archived ? "Archived" : "Active",
      canViewDailyUpdates: row.canViewDailyUpdates ?? 0,
      invitedBy: null,
      actions: !manageable ? [] : archived ? ["restore"] : ["settings", "archive"],
      justAccepted: row.membershipId === input.justAcceptedMembershipId,
      self: row.userId === input.currentUserId,
    };
  });
  const invitationRows: PeopleRow[] = invitations.map((row) => {
    const expired = row.status === "expired";
    return {
      kind: "invitation" as const,
      membershipId: row.id,
      invitationId: row.id,
      userId: row.id,
      name: row.email,
      initials: row.email.slice(0, 2).toUpperCase(),
      email: row.email,
      workspaceRole: roleLabel(row.workspaceRole),
      roleValue: row.workspaceRole.trim().toUpperCase(),
      access: "-",
      state: expired ? ("expired" as const) : ("invited" as const),
      status: expired ? "Invitation expired" : `Invited, expires ${shortDate(row.expiresAt)}`,
      canViewDailyUpdates: 0,
      invitedBy: row.invitedBy,
      actions: canAct ? ["resend", "revoke"] : [],
      justAccepted: false,
      self: false,
    };
  });

  // Active Members (Owner, Administrators, Members), then Invitations, then archived.
  const active = membershipRows
    .filter((row) => row.state === "active")
    .sort((a, b) => roleRank(a.roleValue) - roleRank(b.roleValue) || byName(a, b));
  const archivedRows = membershipRows.filter((row) => row.state === "archived").sort(byName);
  const query = input.filterQuery ?? "";
  const rows = [...active, ...invitationRows, ...archivedRows].filter((row) => matchesFilter(query, row));

  const activeCount = input.memberships.filter((row) => !row.archived).length;
  const pendingCount = invitations.filter((row) => row.status === "pending").length;
  const empty = rows.length === 0;
  return {
    activeCount,
    chip: `${activeCount} ${activeCount === 1 ? "Member" : "Members"}`,
    seatCopy:
      input.canManage !== false && input.purchasedSeats != null
        ? seatLine(activeCount, pendingCount, input.purchasedSeats)
        : null,
    empty,
    // The invitation names Invite only to a reader who has it (#325).
    emptyState: emptyModelOf(
      emptyKindOf(empty, Boolean(query.trim())),
      "Members",
      canAct === false
        ? { title: "No Members yet", copy: "Memberships are the people who work in this Workspace." }
        : {
            title: "Invite your first Member",
            copy: "Memberships are the people who work in this Workspace. Use Invite above to add the first Member.",
          },
      undefined,
      { search: query, searchOnly: true },
    ),
    rows,
    pagePrimary: "case-ink",
  };
}

/** The Invite dialog's email check: the field's own `type="email"` lets `a@b` through. */
export const INVITE_EMAIL_PROBLEM = "Enter a full email address, like name@company.com";

export function inviteEmailProblem(email: string): string | null {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email.trim()) ? null : INVITE_EMAIL_PROBLEM;
}

/** The settings dialog's one PATCH: only what changed, `null` when nothing did. */
export function memberSettingsPatch(
  row: { roleValue: string; canViewDailyUpdates: number },
  draft: { workspaceRole: string; canViewDailyUpdates: boolean },
): { workspaceRole?: PeopleInviteRole; canViewDailyUpdates?: 0 | 1 } | null {
  const patch: { workspaceRole?: PeopleInviteRole; canViewDailyUpdates?: 0 | 1 } = {};
  if (draft.workspaceRole !== row.roleValue && (PEOPLE_INVITE_ROLES as readonly string[]).includes(draft.workspaceRole)) {
    patch.workspaceRole = draft.workspaceRole as PeopleInviteRole;
  }
  // The grant is a Member's: an Administrator reads Daily Updates by role.
  const grant = draft.canViewDailyUpdates ? 1 : 0;
  if (draft.workspaceRole === "MEMBER" && grant !== row.canViewDailyUpdates) patch.canViewDailyUpdates = grant;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** What a failed change says: the server's words, the seat one naming Billing to those who can act on it. */
export function peopleFailure(message: string, opts: { purchasedSeats: number | null; canManage: boolean }): string {
  if (!/seat/i.test(message)) return message;
  const all = opts.purchasedSeats ? `All ${opts.purchasedSeats} Billable Seats are in use.` : "All Billable Seats are in use.";
  return opts.canManage
    ? `${all} Add seats in Administration → Billing, then try again.`
    : `${all} Ask an Administrator to add seats.`;
}

/** The toast after an Invitation is sent or sent again. */
export function invitationSentNotice(
  email: string,
  emailSent: boolean,
  again = false,
): { kind: "success" | "info"; message: string } {
  if (!emailSent) {
    return {
      kind: "info",
      message: "The Invitation is saved, but its email could not be sent. Use Resend Invitation.",
    };
  }
  return { kind: "success", message: again ? `Invitation sent again to ${email}` : `Invitation sent to ${email}` };
}

export type InvitationLookup = {
  workspaceName: string;
  workspaceRole: string;
  invitedBy: string | null;
  email: string;
  status: "pending" | "expired" | "revoked" | "accepted";
  expiresAt: string;
};

export type InvitationPageModel = {
  title: string;
  copy: string;
  /** Until when, for a pending Invitation. */
  detail: string | null;
  action: "sign-in" | "accept" | "switch" | "go" | "open" | "none";
  actionLabel: string | null;
};

const INVITER_FALLBACK = "the person who invited you";

/**
 * What the Invitation page says and offers. `lookup` is `null` for a link that
 * names no Invitation. `signedInEmail` is the identity's own address, when known.
 */
export function composeInvitationPage(input: {
  lookup: InvitationLookup | null;
  signedIn: boolean;
  signedInEmail?: string | null;
}): InvitationPageModel {
  const { lookup } = input;
  if (!lookup) {
    return {
      title: "Invitation not found",
      copy: "This link does not match an Invitation. Check the link, or ask for a new one.",
      detail: null,
      action: "go",
      actionLabel: "Go to DocuFlow",
    };
  }
  const inviter = lookup.invitedBy ?? INVITER_FALLBACK;
  if (lookup.status === "expired") {
    return {
      title: "Invitation expired",
      copy: `This Invitation expired. Ask ${inviter} to send it again.`,
      detail: null,
      action: "go",
      actionLabel: "Go to DocuFlow",
    };
  }
  if (lookup.status === "revoked") {
    return {
      title: "Invitation revoked",
      copy: `This Invitation was revoked. Ask ${inviter} for a new one.`,
      detail: null,
      action: "go",
      actionLabel: "Go to DocuFlow",
    };
  }
  if (lookup.status === "accepted") {
    return {
      title: "Invitation accepted",
      copy: "This Invitation was already accepted.",
      detail: null,
      action: "open",
      actionLabel: "Open DocuFlow",
    };
  }
  const role = roleLabel(lookup.workspaceRole);
  const title = `Join ${lookup.workspaceName}`;
  const copy = lookup.invitedBy
    ? `${lookup.invitedBy} invited ${lookup.email} to join as ${role}.`
    : `You were invited to join as ${role}. The Invitation is for ${lookup.email}.`;
  const detail = `The Invitation is open until ${formatFullDate(lookup.expiresAt)}.`;
  if (!input.signedIn) return { title, copy, detail, action: "sign-in", actionLabel: null };
  const own = input.signedInEmail?.trim().toLowerCase();
  if (own && own !== lookup.email.trim().toLowerCase()) {
    return {
      title,
      copy: `This Invitation was sent to ${lookup.email}. You are signed in as ${input.signedInEmail!.trim()}.`,
      detail: null,
      action: "switch",
      actionLabel: "Switch account",
    };
  }
  return { title, copy, detail, action: "accept", actionLabel: "Accept Invitation" };
}

/** What a refused accept says, with the next step. */
export function invitationAcceptRefusal(message: string, invitedBy: string | null): string {
  if (/seat/i.test(message)) {
    return `This Workspace has no free seat. Ask ${invitedBy ?? INVITER_FALLBACK} to add one, then open this link again.`;
  }
  if (/different email/i.test(message)) {
    return "This Invitation was sent to a different email address. Switch to the invited one, then open this link again.";
  }
  if (/confirm your email/i.test(message)) {
    return "Confirm your email address with your sign-in provider, then reload this page.";
  }
  if (/archived/i.test(message)) {
    return "This account is archived. Contact DocuFlow support to restore it.";
  }
  return message;
}
