/**
 * Active Workspace presentation (#183). Chooser vs enter, rail switcher,
 * Timer origin, Notification origin. Motion lives in motion.ts.
 */

import { memberName } from "./today";

export type WorkspaceCondition = "Trial" | "Read-only" | "Past due" | null;

export type MembershipOption = {
  workspaceId: string;
  workspaceName: string;
  workspaceRole: string;
  condition: WorkspaceCondition;
  archived?: boolean;
};

export type MembershipsResponse = {
  /** Null for a User who belongs nowhere yet — Flow 1 starts from there. */
  activeWorkspaceId: string | null;
  preferredWorkspaceId: string | null;
  memberships: MembershipOption[];
  /** Every Membership archived, rather than never having held one (Flow 2). */
  hasArchivedMemberships?: boolean;
};

export type PendingInvitationOption = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRole: string;
  token: string;
};

export type ChooserInvitationRow = PendingInvitationOption & {
  kind: "invitation";
  action: "accept";
};

export function chooserInvitationRows(invitations: PendingInvitationOption[]): ChooserInvitationRow[] {
  return invitations.map((row) => ({
    ...row,
    kind: "invitation",
    action: "accept",
  }));
}

export type WorkspaceEntry =
  | { kind: "enter"; workspaceId: string }
  | { kind: "chooser"; rows: MembershipOption[] }
  /** No Membership anywhere: Flow 1 names the first Workspace, no list to pick from. */
  | { kind: "first-run" };

export function workspaceCondition(billingState: string | null | undefined): WorkspaceCondition {
  if (billingState === "Trialing") return "Trial";
  if (billingState === "ReadOnly") return "Read-only";
  if (billingState === "PastDue") return "Past due";
  return null;
}

/**
 * The Workspace Roles as prose, for refusal copy; a custom Role keeps the name
 * the Workspace gave it. presentation.ts's workspaceRoleLabel shouts the same
 * answer in caps for the rail, so the two can never disagree (#250).
 */
export function workspaceRoleInCopy(workspaceRole: string): string {
  const role = workspaceRole.trim().toUpperCase();
  // A Membership always carries a Role; an absent one reads as the least
  // privileged rather than as an empty chip or an empty sentence.
  if (!role) return "Member";
  if (role === "OWNER") return "Owner";
  if (role === "ADMINISTRATOR") return "Administrator";
  if (role === "MEMBER") return "Member";
  return workspaceRole.trim();
}

export type WorkspaceMemberRow = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  workspaceRole: string;
};

/**
 * The Owner a refusal names: the sole protected Membership of the Workspace the
 * reader is standing in. Never the platform SuperAdmin flag on a User — a
 * self-service Workspace has no SuperAdmin, and the seeded one's SuperAdmin
 * holds no authority over the Workspace being read (#250).
 */
export function workspaceOwnerName(memberships: WorkspaceMemberRow[]): string | null {
  const owner = memberships.find((row) => row.workspaceRole?.trim().toUpperCase() === "OWNER");
  return owner ? memberName(owner) : null;
}

export function membershipRoleLabel(slug: string): string {
  if (slug === "owner") return "OWNER";
  if (slug === "administrator") return "ADMINISTRATOR";
  return "MEMBER";
}

function activeMemberships(memberships: MembershipOption[]): MembershipOption[] {
  return memberships.filter((row) => !row.archived);
}

function byName(a: MembershipOption, b: MembershipOption): number {
  return a.workspaceName.localeCompare(b.workspaceName);
}

export function workspaceEntry(input: {
  memberships: MembershipOption[];
  lastActiveWorkspaceId: string | null;
  invitations?: Array<{ id: string }>;
}): WorkspaceEntry {
  const rows = activeMemberships(input.memberships).sort(byName);
  if ((input.invitations?.length ?? 0) > 0) {
    return { kind: "chooser", rows };
  }
  // An Invitation takes precedence over creation (Flow 6, step 4), so this
  // branch is reached only when nothing is waiting to be accepted either.
  if (rows.length === 0) {
    return { kind: "first-run" };
  }
  if (rows.length === 1) {
    return { kind: "enter", workspaceId: rows[0].workspaceId };
  }
  const remembered = rows.find((row) => row.workspaceId === input.lastActiveWorkspaceId);
  if (remembered) {
    return { kind: "enter", workspaceId: remembered.workspaceId };
  }
  return { kind: "chooser", rows };
}

export type WorkspaceSwitcherRow = MembershipOption & { active: boolean; timer: boolean };

export function workspaceSwitcher(input: {
  memberships: MembershipOption[];
  activeWorkspaceId: string;
  timerWorkspaceId: string | null;
}): {
  current: WorkspaceSwitcherRow | null;
  others: WorkspaceSwitcherRow[];
  rows: WorkspaceSwitcherRow[];
} {
  const rows = activeMemberships(input.memberships)
    .sort((a, b) => {
      if (a.workspaceId === input.activeWorkspaceId) return -1;
      if (b.workspaceId === input.activeWorkspaceId) return 1;
      return byName(a, b);
    })
    .map((row) => ({
      ...row,
      active: row.workspaceId === input.activeWorkspaceId,
      timer: input.timerWorkspaceId != null && row.workspaceId === input.timerWorkspaceId,
    }));
  return {
    current: rows.find((row) => row.active) ?? null,
    others: rows.filter((row) => !row.active),
    rows,
  };
}

export function notificationOrigin(notification: {
  workspace?: { name: string } | null;
}): string {
  return notification.workspace?.name?.trim() || "Workspace";
}

export function timerChipOnSwitch(input: {
  timerWorkspaceId: string | null;
  activeWorkspaceId: string;
  holdsAmber: boolean;
}): {
  holdsAmber: boolean;
  belongsToActiveWorkspace: boolean;
  welcomeMotion: "none";
} {
  return {
    holdsAmber: input.holdsAmber,
    belongsToActiveWorkspace:
      input.timerWorkspaceId != null && input.timerWorkspaceId === input.activeWorkspaceId,
    welcomeMotion: "none",
  };
}
