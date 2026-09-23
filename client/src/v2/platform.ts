/**
 * The platform console (#266, decided on #261).
 *
 * The User directory is a platform surface, not a Workspace one: `users` has no
 * `workspace_id`, so ADR-0025 keeps it on the global `users.role` column behind
 * `requirePlatformAdmin`. The console lives outside the Workspace chrome and
 * reaches five routes. Create, delete and profile edit stay on the server and
 * out of v2: Invitations and Clerk create accounts, archive covers delete, and
 * a Membership's profile is People's.
 */

export type PlatformUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isMainAdmin: number;
  isArchived: boolean;
  lastLoginAt?: Date | string | null;
};

export type PlatformDirectoryInput = {
  users: PlatformUser[];
  currentUserId: string;
  filterQuery: string;
  selectedId: string | null;
};

export type PlatformActionKind = "role" | "reset" | "archive" | "restore";

export type PlatformAction = {
  kind: PlatformActionKind;
  label: string;
  /** Role changes and archiving ask first, in the shared modal. */
  confirm: boolean;
  title: string;
  consequence: string;
  /** The body the route takes; reset takes none. */
  body: Record<string, unknown> | null;
  /** What the page says once it worked, where the result is not visible in the register. */
  done: string | null;
};

export type PlatformRow = {
  id: string;
  name: string;
  email: string;
  role: "PLATFORM ADMIN" | "USER";
  archived: boolean;
  superAdmin: boolean;
  self: boolean;
  selected: boolean;
};

export type PlatformDirectoryModel = {
  subhead: string;
  rows: PlatformRow[];
  count: number;
  empty: boolean;
  emptyCopy: string;
  detail: {
    id: string;
    name: string;
    email: string;
    role: PlatformRow["role"];
    archived: boolean;
    superAdmin: boolean;
    actions: PlatformAction[];
    /** Why a User shows no actions, when that is the case. */
    note: string | null;
  } | null;
};

export function platformUsersPath(includeArchived: boolean): string {
  return includeArchived ? "/api/admin/users?includeArchived=true" : "/api/admin/users";
}

export function platformUserPath(userId: string): string {
  return `/api/admin/users/${userId}`;
}

export function platformUserRolePath(userId: string): string {
  return `/api/admin/users/${userId}/role`;
}

export function platformUserResetPath(userId: string): string {
  return `/api/admin/users/${userId}/reset-password`;
}

export function platformUserArchivePath(userId: string): string {
  return `/api/admin/users/${userId}/archive`;
}

/** The console's gate on the client. `requirePlatformAdmin` stays the real one. */
export function isPlatformAdmin(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "admin";
}

/** Where v1's `/admin`, `/admin/create` and `/admin/user/:id` land. */
export function legacyAdminDestination(platformAdmin: boolean): "/platform" | "/administration" {
  return platformAdmin ? "/platform" : "/administration";
}

/**
 * The one place v2 reads the SuperAdmin flag (#266). Here the SuperAdmin is the
 * subject — an account every route shields — never a stand-in for the Owner,
 * which #250 took out of every other screen.
 */
export function toPlatformUser(user: {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isMainAdmin: number;
  isArchived: boolean;
  lastLoginAt?: Date | string | null;
}): PlatformUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isMainAdmin: user.isMainAdmin,
    isArchived: user.isArchived,
    lastLoginAt: user.lastLoginAt,
  };
}

function displayName(user: PlatformUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email || "Unnamed User";
}

function roleLabel(user: PlatformUser): PlatformRow["role"] {
  return user.role === "admin" ? "PLATFORM ADMIN" : "USER";
}

/**
 * Mirrors what each route refuses, so the page never offers a refusal:
 * role and reset refuse the SuperAdmin to anyone but itself; archive refuses
 * the SuperAdmin always, and anyone archiving themselves.
 */
function composeActions(target: PlatformUser, currentUserId: string): PlatformAction[] {
  const self = target.id === currentUserId;
  const superAdmin = target.isMainAdmin === 1;
  if (superAdmin && !self) return [];
  const name = displayName(target);
  const admin = target.role === "admin";
  const actions: PlatformAction[] = [];

  actions.push(
    admin
      ? {
          kind: "role",
          label: "Remove platform admin",
          confirm: true,
          title: "Remove platform admin",
          consequence: self
            ? "You will lose access to this console at once. Your role in each Workspace does not change."
            : `${name} will lose access to this console and to every account on the platform. Their role in each Workspace does not change.`,
          body: { role: "user" },
          done: null,
        }
      : {
          kind: "role",
          label: "Make platform admin",
          confirm: true,
          title: "Make platform admin",
          consequence: `${name} will reach this console and every account on the platform. Their role in each Workspace does not change.`,
          body: { role: "admin" },
          done: null,
        },
  );

  actions.push({
    kind: "reset",
    label: "Send password reset",
    confirm: false,
    title: "Send password reset",
    consequence: `${target.email ?? name} will receive an email to set a new password.`,
    body: null,
    done: `Password reset sent to ${target.email ?? name}.`,
  });

  if (!superAdmin && !self) {
    actions.push(
      target.isArchived
        ? {
            kind: "restore",
            label: "Restore",
            confirm: false,
            title: "Restore",
            consequence: `${name}'s Memberships are restored.`,
            body: { isArchived: false },
            done: null,
          }
        : {
            kind: "archive",
            label: "Archive",
            confirm: true,
            title: `Archive ${name}`,
            consequence: `${name}'s Memberships in every Workspace will be archived, so they reach no Workspace. Their records stay, and the account can be restored here.`,
            body: { isArchived: true },
            done: null,
          },
    );
  }
  return actions;
}

export function composePlatformDirectory(input: PlatformDirectoryInput): PlatformDirectoryModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const rows = input.users
    .filter((user) => {
      if (!needle) return true;
      return `${displayName(user)} ${user.email ?? ""}`.toLowerCase().includes(needle);
    })
    .map((user) => ({
      id: user.id,
      name: displayName(user),
      email: user.email ?? "—",
      role: roleLabel(user),
      archived: user.isArchived,
      superAdmin: user.isMainAdmin === 1,
      self: user.id === input.currentUserId,
      selected: user.id === input.selectedId,
    }));

  const selected = input.users.find((user) => user.id === input.selectedId) ?? null;
  const detail = selected
    ? (() => {
        const actions = composeActions(selected, input.currentUserId);
        return {
          id: selected.id,
          name: displayName(selected),
          email: selected.email ?? "—",
          role: roleLabel(selected),
          archived: selected.isArchived,
          superAdmin: selected.isMainAdmin === 1,
          actions,
          note: actions.length === 0 ? "Only the SuperAdmin can change the SuperAdmin." : null,
        };
      })()
    : null;

  const empty = rows.length === 0;
  return {
    subhead: "Every account on the platform, across all Workspaces. Only platform admins see this console.",
    rows,
    count: rows.length,
    empty,
    emptyCopy: empty ? (needle ? "No User matches this filter." : "No Users on the platform yet.") : "",
    detail,
  };
}
