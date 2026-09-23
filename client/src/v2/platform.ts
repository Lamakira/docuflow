import { formatWhen, memberName } from "./today";

/**
 * The platform console (#266, decided on #261).
 *
 * The User directory is a platform surface, not a Workspace one: `users` has no
 * `workspace_id`, so ADR-0025 keeps it on the global `users.role` column behind
 * `requirePlatformAdmin`. The console lives outside the Workspace chrome and
 * reaches five routes. Create, delete and profile edit stay on the server and
 * out of v2: Invitations and Clerk create Users, archive covers delete, and a
 * Membership's profile is People's.
 */

export const PLATFORM_CONSOLE_LABEL = "Platform console";

export type PlatformUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  /** The SuperAdmin: the one User every directory route shields. */
  superAdmin: boolean;
  isArchived: boolean;
  lastLoginAt: Date | string | null;
  createdAt: Date | string | null;
};

export type PlatformDirectoryInput = {
  now: Date;
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
  /** Takes something away, so it wears the destructive treatment. */
  destructive: boolean;
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
  role: "SUPERADMIN" | "PLATFORM ADMIN" | "USER";
  status: "ARCHIVED" | "ACTIVE";
  archived: boolean;
  superAdmin: boolean;
  self: boolean;
  selected: boolean;
  lastSignIn: string;
  joined: string;
};

export type PlatformDirectoryModel = {
  title: typeof PLATFORM_CONSOLE_LABEL;
  subhead: string;
  filterPlaceholder: string;
  columns: ["USER", "ROLE", "STATUS"];
  rows: PlatformRow[];
  count: number;
  countLabel: string;
  empty: boolean;
  emptyCopy: string;
  detail:
    | (PlatformRow & {
        actions: PlatformAction[];
        /** Why a User shows no actions, when that is the case. */
        note: string | null;
        /**
         * Whether the detail route will answer. It refuses the SuperAdmin to
         * every other platform admin, so the page does not ask.
         */
        readable: boolean;
      })
    | null;
};

/** The whole directory, archived Users included, so one can be restored. */
export function platformUsersPath(): string {
  return "/api/admin/users?includeArchived=true";
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
 * subject — a User every route shields — never a stand-in for the Owner, which
 * #250 took out of every other screen.
 */
export function toPlatformUser(
  user: Omit<PlatformUser, "superAdmin"> & { isMainAdmin: number },
): PlatformUser {
  const { isMainAdmin, ...rest } = user;
  return { ...rest, superAdmin: isMainAdmin === 1 };
}

/** What a platform admin reaches that no Workspace Role grants. */
const PLATFORM_REACH = "every User on the platform and the controls kept for platform admins";

/**
 * Mirrors what each route refuses, so the page never offers a refusal:
 * role and reset refuse the SuperAdmin to anyone but itself; archive refuses
 * the SuperAdmin always, and anyone archiving themselves.
 */
function composeActions(target: PlatformUser, self: boolean): PlatformAction[] {
  if (target.superAdmin && !self) return [];
  const name = memberName(target);
  const actions: PlatformAction[] = [];

  actions.push(
    target.role === "admin"
      ? {
          kind: "role",
          label: "Remove platform admin",
          confirm: true,
          destructive: true,
          title: "Remove platform admin",
          consequence: self
            ? `You will lose access to this console at once, and to ${PLATFORM_REACH}. Your role in each Workspace does not change.`
            : `${name} will lose this console, ${PLATFORM_REACH}. Their role in each Workspace does not change.`,
          body: { role: "user" },
          done: null,
        }
      : {
          kind: "role",
          label: "Make platform admin",
          confirm: true,
          destructive: false,
          title: "Make platform admin",
          consequence: `${name} will reach this console, ${PLATFORM_REACH}. Their role in each Workspace does not change.`,
          body: { role: "admin" },
          done: null,
        },
  );

  actions.push({
    kind: "reset",
    label: "Send password reset",
    confirm: false,
    destructive: false,
    title: "Send password reset",
    consequence: `${target.email ?? name} will receive an email to set a new password.`,
    body: null,
    done: `Password reset sent to ${target.email ?? name}.`,
  });

  if (!target.superAdmin && !self) {
    actions.push(
      target.isArchived
        ? {
            kind: "restore",
            label: "Restore",
            confirm: false,
            destructive: false,
            title: "Restore",
            consequence: `${name}'s Memberships are restored.`,
            body: { isArchived: false },
            done: null,
          }
        : {
            kind: "archive",
            label: "Archive",
            confirm: true,
            destructive: true,
            title: `Archive ${name}`,
            consequence: `${name}'s Memberships in every Workspace will be archived, so they reach no Workspace. Their records stay, and the User can be restored here.`,
            body: { isArchived: true },
            done: null,
          },
    );
  }
  return actions;
}

function composeRow(user: PlatformUser, input: PlatformDirectoryInput): PlatformRow {
  return {
    id: user.id,
    name: memberName(user),
    email: user.email ?? "—",
    role: user.superAdmin ? "SUPERADMIN" : user.role === "admin" ? "PLATFORM ADMIN" : "USER",
    status: user.isArchived ? "ARCHIVED" : "ACTIVE",
    archived: user.isArchived,
    superAdmin: user.superAdmin,
    self: user.id === input.currentUserId,
    selected: user.id === input.selectedId,
    lastSignIn: formatWhen(user.lastLoginAt, input.now) || "—",
    joined: formatWhen(user.createdAt, input.now) || "—",
  };
}

export function composePlatformDirectory(input: PlatformDirectoryInput): PlatformDirectoryModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const rows = input.users
    .filter((user) => !needle || `${memberName(user)} ${user.email ?? ""}`.toLowerCase().includes(needle))
    .map((user) => composeRow(user, input));

  const selected = input.users.find((user) => user.id === input.selectedId) ?? null;
  const viewer = input.users.find((user) => user.id === input.currentUserId) ?? null;
  let detail: PlatformDirectoryModel["detail"] = null;
  if (selected) {
    const row = composeRow(selected, input);
    const actions = composeActions(selected, row.self);
    detail = {
      ...row,
      actions,
      note: actions.length === 0 ? "Only the SuperAdmin can change the SuperAdmin." : null,
      readable: !selected.superAdmin || viewer?.superAdmin === true,
    };
  }

  const empty = rows.length === 0;
  return {
    title: PLATFORM_CONSOLE_LABEL,
    subhead: "Every User on the platform, across all Workspaces. Only platform admins see this console.",
    filterPlaceholder: "Filter by name or email",
    columns: ["USER", "ROLE", "STATUS"],
    rows,
    count: rows.length,
    countLabel: rows.length === 1 ? "1 USER" : `${rows.length} USERS`,
    empty,
    emptyCopy: empty ? (needle ? "No User matches this filter." : "No Users on the platform yet.") : "",
    detail,
  };
}
