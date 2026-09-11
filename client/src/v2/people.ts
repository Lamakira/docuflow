/**
 * People destination (#192).
 * Novelty: a Capability refusal opens from the control that failed
 * (spatial consistency). Do not animate: the people list on load,
 * hover on every avatar.
 */

import { chromeRefusal } from "./chrome";
import { memberInitials, memberName } from "./today";

export type PeopleMembershipInput = {
  membershipId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  workspaceRole: string;
  capabilities: string[];
  archived: boolean;
};

export type PeopleInput = {
  workspaceName: string;
  currentUserId: string;
  ownerName: string | null;
  condition: "Trial" | "Read-only" | "Past due" | null;
  includeArchived: boolean;
  purchasedSeats: number | null;
  memberships: PeopleMembershipInput[];
};

export type PeopleRow = {
  membershipId: string;
  userId: string;
  name: string;
  initials: string;
  email: string;
  workspaceRole: string;
  capabilities: string;
  status: "ACTIVE" | "ARCHIVED";
  canSignIn: boolean;
  archiveAction: "archive" | "restore" | null;
  self: boolean;
};

export type PeopleModel = {
  subhead: string;
  seatCopy: string;
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

export function peopleArchivePath(userId: string): string {
  return `/api/admin/users/${userId}/archive`;
}

function capabilityLabel(capabilities: string[]): string {
  if (capabilities.length === 0) return "—";
  return capabilities.join(" · ");
}

function seatCopy(activeCount: number, purchasedSeats: number | null): string {
  const rule = "Only accepted active Memberships consume a Billable Seat.";
  if (purchasedSeats == null) return rule;
  return `${activeCount} of ${purchasedSeats} Billable Seats consumed. ${rule}`;
}

export function composePeople(input: PeopleInput): PeopleModel {
  const visible = input.memberships.filter((row) => input.includeArchived || !row.archived);
  const rows: PeopleRow[] = visible.map((row) => {
    const self = row.userId === input.currentUserId;
    const archived = row.archived;
    return {
      membershipId: row.membershipId,
      userId: row.userId,
      name: memberName(row),
      initials: memberInitials(row),
      email: row.email,
      workspaceRole: row.workspaceRole,
      capabilities: capabilityLabel(row.capabilities),
      status: archived ? "ARCHIVED" : "ACTIVE",
      canSignIn: !archived,
      archiveAction: self ? null : archived ? "restore" : "archive",
      self,
    };
  });
  const activeCount = input.memberships.filter((row) => !row.archived).length;
  const empty = rows.length === 0;
  return {
    subhead: `Memberships in ${input.workspaceName}.`,
    seatCopy: seatCopy(activeCount, input.purchasedSeats),
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
