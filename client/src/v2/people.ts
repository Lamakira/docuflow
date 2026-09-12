/**
 * People destination (#192, #211).
 * Novelty: accepting an Invitation is rare state indication (Membership
 * appears). Capability refusal opens from the control that failed.
 * Do not animate: register filter typing, role dropdown as decoration,
 * seat digits counting, the people list on load, hover on every avatar.
 */

import { chromeRefusal } from "./chrome";
import { memberInitials, memberName } from "./today";

export const PEOPLE_INVITE_ROLES = ["MEMBER", "ADMINISTRATOR"] as const;

export type PeopleMembershipInput = {
  membershipId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  workspaceRole: string;
  capabilities: string[];
  archived: boolean;
  hoursPerDay?: number;
  canViewDailyUpdates?: number;
};

export type PeopleInvitationInput = {
  id: string;
  email: string;
  workspaceRole: string;
};

export type PeopleInput = {
  workspaceName: string;
  currentUserId: string;
  ownerName: string | null;
  condition: "Trial" | "Read-only" | "Past due" | null;
  includeArchived: boolean;
  purchasedSeats: number | null;
  memberships: PeopleMembershipInput[];
  invitations?: PeopleInvitationInput[];
  filterQuery?: string;
  justAcceptedMembershipId?: string | null;
};

export type PeopleRow = {
  kind: "membership" | "invitation";
  membershipId: string;
  invitationId: string | null;
  userId: string;
  name: string;
  initials: string;
  email: string;
  workspaceRole: string;
  capabilities: string;
  status: "ACTIVE" | "ARCHIVED" | "INVITATION PENDING";
  canSignIn: boolean;
  consumesSeat: boolean;
  hoursPerDay: number | null;
  canViewDailyUpdates: number | null;
  archiveAction: "archive" | "restore" | null;
  revokeAction: boolean;
  justAccepted: boolean;
  self: boolean;
};

export type PeopleModel = {
  subhead: string;
  seatCopy: string;
  invitePreview: string;
  empty: boolean;
  emptyCopy: string;
  rows: PeopleRow[];
  pagePrimary: "case-ink";
};

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

export function invitationPagePath(token: string): string {
  return `/invitations/${encodeURIComponent(token)}`;
}

export function myInvitationsPath(): string {
  return "/api/invitations";
}

export function membershipProfilePath(membershipId: string): string {
  return `/api/workspace/memberships/${membershipId}`;
}

export function peopleArchivePath(userId: string): string {
  return `/api/admin/users/${userId}/archive`;
}

export function invitationRevokePath(id: string): string {
  return `/api/workspace/invitations/${id}/revoke`;
}

function capabilityLabel(capabilities: string[]): string {
  if (capabilities.length === 0) return "—";
  return capabilities.join(" · ");
}

export function composeInvitePreview(input: {
  activeCount: number;
  purchasedSeats: number | null;
}): string {
  if (input.purchasedSeats == null) {
    return "This Invitation consumes no Billable Seat until accepted.";
  }
  return `${input.activeCount} of ${input.purchasedSeats} Billable Seats consumed. This Invitation will consume 1 of ${input.purchasedSeats} if accepted.`;
}

function seatCopy(activeCount: number, pendingCount: number, purchasedSeats: number | null): string {
  const pending =
    pendingCount === 1 ? "1 Invitation pending consumes none." : `${pendingCount} Invitations pending consume none.`;
  if (purchasedSeats == null) {
    return `Only accepted active Memberships consume a Billable Seat. ${pending}`;
  }
  return `${activeCount} of ${purchasedSeats} Billable Seats consumed. ${pending}`;
}

function matchesFilter(query: string, row: { name: string; email: string }): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  return row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle);
}

export function composePeople(input: PeopleInput): PeopleModel {
  const invitations = input.invitations ?? [];
  const visible = input.memberships.filter((row) => input.includeArchived || !row.archived);
  const membershipRows: PeopleRow[] = visible.map((row) => {
    const self = row.userId === input.currentUserId;
    const archived = row.archived;
    const name = memberName(row);
    return {
      kind: "membership" as const,
      membershipId: row.membershipId,
      invitationId: null,
      userId: row.userId,
      name,
      initials: memberInitials(row),
      email: row.email,
      workspaceRole: row.workspaceRole,
      capabilities: capabilityLabel(row.capabilities),
      status: archived ? "ARCHIVED" : "ACTIVE",
      canSignIn: !archived,
      consumesSeat: !archived,
      hoursPerDay: row.hoursPerDay ?? 8,
      canViewDailyUpdates: row.canViewDailyUpdates ?? 0,
      archiveAction: self ? null : archived ? "restore" : "archive",
      revokeAction: false,
      justAccepted: row.membershipId === input.justAcceptedMembershipId,
      self,
    };
  });
  const invitationRows: PeopleRow[] = invitations.map((row) => ({
    kind: "invitation" as const,
    membershipId: row.id,
    invitationId: row.id,
    userId: row.id,
    name: row.email,
    initials: row.email.slice(0, 2).toUpperCase(),
    email: row.email,
    workspaceRole: row.workspaceRole,
    capabilities: "—",
    status: "INVITATION PENDING",
    canSignIn: false,
    consumesSeat: false,
    hoursPerDay: null,
    canViewDailyUpdates: null,
    archiveAction: null,
    revokeAction: true,
    justAccepted: false,
    self: false,
  }));
  const query = input.filterQuery ?? "";
  const rows = [...membershipRows, ...invitationRows].filter((row) => matchesFilter(query, row));
  const activeCount = input.memberships.filter((row) => !row.archived).length;
  const empty = rows.length === 0;
  return {
    subhead: `Memberships in ${input.workspaceName}.`,
    seatCopy: seatCopy(activeCount, invitations.length, input.purchasedSeats),
    invitePreview: composeInvitePreview({ activeCount, purchasedSeats: input.purchasedSeats }),
    empty,
    emptyCopy: empty ? "No active Memberships in this Workspace." : "",
    rows,
    pagePrimary: "case-ink",
  };
}

export type PeopleWriteRefusal =
  | { kind: "capability"; ownerName?: string | null }
  | { kind: "workspace-condition"; workspaceName: string; condition: "Read-only" | "Trial" | "Past due" }
  | { kind: "seat"; purchased: number }
  | {
      kind: "error";
      workspaceName: string;
      ownerName?: string | null;
      errorMessage: string;
      purchasedSeats?: number | null;
    };

export function peopleWriteRefusal(input: PeopleWriteRefusal): string {
  if (input.kind === "capability") {
    return input.ownerName
      ? `This action needs a Capability. ${input.ownerName} (Owner) can grant it.`
      : chromeRefusal({ kind: "generic", message: "Access denied" });
  }
  if (input.kind === "workspace-condition") {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: input.condition,
    });
  }
  if (input.kind === "seat") {
    return chromeRefusal({ kind: "seat", purchased: input.purchased });
  }

  const message = input.errorMessage;
  if (/read-only/i.test(message)) {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: "Read-only",
    });
  }
  if (/seat/i.test(message)) {
    return chromeRefusal({ kind: "seat", purchased: input.purchasedSeats ?? 0 });
  }
  if (/permission denied|not authorized|access denied|forbidden/i.test(message)) {
    return peopleWriteRefusal({ kind: "capability", ownerName: input.ownerName });
  }
  return chromeRefusal({ kind: "generic", message });
}

export type InvitationAcceptStatus =
  | "ready"
  | "accepted"
  | "revoked"
  | "expired"
  | "already"
  | "mismatch"
  | "unauthorized"
  | "error";

export function composeInvitationAccept(input: {
  signedIn: boolean;
  status: InvitationAcceptStatus;
  workspaceName?: string;
  message?: string;
}): {
  title: string;
  copy: string;
  action: "sign-in" | "accept" | "today" | "none";
} {
  if (!input.signedIn || input.status === "unauthorized") {
    return {
      title: "Accept Invitation",
      copy: "Sign in or create an identity to accept this Invitation. You will gain a Membership. This does not create a Workspace.",
      action: "sign-in",
    };
  }
  if (input.status === "ready") {
    return {
      title: "Accept Invitation",
      copy: input.workspaceName
        ? `Accept to join ${input.workspaceName}. You will gain a Membership. This does not create a Workspace.`
        : "Accept to join this Workspace. You will gain a Membership. This does not create a Workspace.",
      action: "accept",
    };
  }
  if (input.status === "accepted") {
    return {
      title: "Invitation accepted",
      copy: "Your Membership is active. Continue to Today.",
      action: "today",
    };
  }
  if (input.status === "revoked") {
    return { title: "Invitation revoked", copy: "This Invitation was revoked.", action: "none" };
  }
  if (input.status === "expired") {
    return { title: "Invitation expired", copy: "This Invitation expired.", action: "none" };
  }
  if (input.status === "already") {
    return {
      title: "Invitation already accepted",
      copy: "This Invitation was already accepted.",
      action: "today",
    };
  }
  if (input.status === "mismatch") {
    return {
      title: "Invitation",
      copy: "This Invitation was sent to a different email.",
      action: "none",
    };
  }
  return {
    title: "Invitation",
    copy: input.message ?? "This Invitation could not be accepted.",
    action: "none",
  };
}
