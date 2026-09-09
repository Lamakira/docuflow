/**
 * Active Workspace presentation (#183). Chooser vs enter, rail switcher,
 * Timer origin, Notification origin. Motion lives in motion.ts.
 */

export type WorkspaceCondition = "Trial" | "Read-only" | "Past due" | null;

export type MembershipOption = {
  workspaceId: string;
  workspaceName: string;
  workspaceRole: string;
  condition: WorkspaceCondition;
  archived?: boolean;
};

export type MembershipsResponse = {
  activeWorkspaceId: string;
  preferredWorkspaceId: string | null;
  memberships: MembershipOption[];
};

export type WorkspaceEntry =
  | { kind: "enter"; workspaceId: string }
  | { kind: "chooser"; rows: MembershipOption[] };

export function workspaceCondition(billingState: string | null | undefined): WorkspaceCondition {
  if (billingState === "Trialing") return "Trial";
  if (billingState === "ReadOnly") return "Read-only";
  if (billingState === "PastDue") return "Past due";
  return null;
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
}): WorkspaceEntry {
  const rows = activeMemberships(input.memberships).sort(byName);
  if (rows.length === 1) {
    return { kind: "enter", workspaceId: rows[0].workspaceId };
  }
  const remembered = rows.find((row) => row.workspaceId === input.lastActiveWorkspaceId);
  if (remembered) {
    return { kind: "enter", workspaceId: remembered.workspaceId };
  }
  return { kind: "chooser", rows };
}

export function workspaceSwitcher(input: {
  memberships: MembershipOption[];
  activeWorkspaceId: string;
  timerWorkspaceId: string | null;
}): {
  rows: Array<MembershipOption & { active: boolean; timer: boolean }>;
} {
  const rows = activeMemberships(input.memberships).sort((a, b) => {
    if (a.workspaceId === input.activeWorkspaceId) return -1;
    if (b.workspaceId === input.activeWorkspaceId) return 1;
    return byName(a, b);
  });
  return {
    rows: rows.map((row) => ({
      ...row,
      active: row.workspaceId === input.activeWorkspaceId,
      timer: input.timerWorkspaceId != null && row.workspaceId === input.timerWorkspaceId,
    })),
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
