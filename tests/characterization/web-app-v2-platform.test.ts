import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeAccountMenu } from "../../client/src/v2/chrome";
import {
  composePlatformDirectory,
  isPlatformAdmin,
  legacyAdminDestination,
  platformUserArchivePath,
  platformUserPath,
  platformUserResetPath,
  platformUserRolePath,
  platformUsersPath,
  toPlatformUser,
  type PlatformDirectoryInput,
  type PlatformUser,
} from "../../client/src/v2/platform";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";

/**
 * The platform console (#266, PARITY section A, decided on #261).
 * Seams: composePlatformDirectory, the path helpers, matchV2Route and
 * composeAccountMenu. The directory is a platform surface (ADR-0025): it is
 * reached on `users.role`, never on the Workspace Role, and never from the rail.
 */

const here = dirname(fileURLToPath(import.meta.url));
const v2Dir = join(here, "../../client/src/v2");
const read = (path: string) => readFileSync(join(here, "../..", path), "utf8");

function user(overrides: Partial<PlatformUser> & { id: string }): PlatformUser {
  return {
    email: `${overrides.id}@example.com`,
    firstName: "Pat",
    lastName: "Ng",
    role: "user",
    superAdmin: false,
    isArchived: false,
    lastLoginAt: null,
    createdAt: null,
    ...overrides,
  };
}

const ann = user({ id: "ann", firstName: "Ann", lastName: "Lee", role: "admin" });
const bob = user({ id: "bob", firstName: "Bob", lastName: "Ray" });
const cid = user({ id: "cid", firstName: "Cid", lastName: "Moe", isArchived: true });
const sue = user({ id: "sue", firstName: "Sue", lastName: "Kim", role: "admin", superAdmin: true });

function input(overrides: Partial<PlatformDirectoryInput> = {}): PlatformDirectoryInput {
  return {
    now: new Date(2026, 8, 23, 12, 0, 0),
    users: [ann, bob, cid, sue],
    currentUserId: "ann",
    filterQuery: "",
    selectedId: null,
    ...overrides,
  };
}

describe("the platform console reaches the five kept routes (#266)", () => {
  it("names them", () => {
    // Archived Users included, so the console can restore one.
    expect(platformUsersPath()).toBe("/api/admin/users?includeArchived=true");
    expect(platformUserPath("bob")).toBe("/api/admin/users/bob");
    expect(platformUserRolePath("bob")).toBe("/api/admin/users/bob/role");
    expect(platformUserResetPath("bob")).toBe("/api/admin/users/bob/reset-password");
    expect(platformUserArchivePath("bob")).toBe("/api/admin/users/bob/archive");
  });

  it("never calls the three dropped routes from v2", () => {
    const sources = readdirSync(v2Dir)
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => readFileSync(join(v2Dir, file), "utf8"))
      .join("\n");
    // Create is a POST to the collection; delete and profile edit hit the bare User path.
    expect(sources).not.toMatch(/"POST",\s*platformUsersPath\(/);
    expect(sources).not.toMatch(/"(DELETE|PATCH)",\s*platformUserPath\(/);
    expect(sources).not.toMatch(/"POST",\s*"\/api\/admin\/users"/);
    expect(sources).not.toMatch(/\/api\/admin\/users\/\$\{[^}]+\}`,\s*\{/);
  });
});

describe("the console is a platform surface, not a Workspace one (#266)", () => {
  it("is reached on the global role only", () => {
    expect(isPlatformAdmin({ role: "admin" })).toBe(true);
    expect(isPlatformAdmin({ role: "user" })).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });

  it("routes /platform outside the rail", () => {
    expect(matchV2Route("/platform")).toMatchObject({ kind: "platform", href: "/platform" });
    expect(navIdForPath("/platform")).toBeNull();
    expect(breadcrumbFor("/platform", "Harbor Co").map((crumb) => crumb.label)).toEqual(["PLATFORM"]);
  });

  it("sends v1's directory addresses to the console for a platform admin, and to Administration for everyone else", () => {
    expect(legacyAdminDestination(true)).toBe("/platform");
    expect(legacyAdminDestination(false)).toBe("/administration");
    const app = read("client/src/v2/V2AuthenticatedApp.tsx");
    expect(app).toContain('<Route path="/platform"');
    for (const path of ["/admin/user/:id", "/admin/:rest", "/admin"]) {
      expect(app).toMatch(new RegExp(`<Route path="${path.replace(/[/:]/g, (c) => `\\${c}`)}" component=\\{V2LegacyAdminRedirect\\}`));
    }
    // The two addresses that already have a Workspace home keep it.
    expect(app).toContain('<Route path="/admin/daily-updates">');
    expect(app).toContain('<Route path="/admin/analytics">');
  });

  it("puts its entry in the account menu for a platform admin only", () => {
    expect(composeAccountMenu({ theme: "light" }).structure).toEqual(["theme", "separator", "account", "signOut"]);
    const admin = composeAccountMenu({ theme: "light", platformAdmin: true });
    expect(admin.structure).toEqual(["theme", "separator", "platform", "account", "signOut"]);
    expect(admin.platformLabel).toBe("Platform console");
  });
});

describe("the platform directory register (#266)", () => {
  it("lists every User, archived ones included, with their global role", () => {
    const directory = composePlatformDirectory(input());
    expect(directory.rows.map((row) => [row.id, row.name, row.role, row.archived])).toEqual([
      ["ann", "Ann Lee", "PLATFORM ADMIN", false],
      ["bob", "Bob Ray", "USER", false],
      ["cid", "Cid Moe", "USER", true],
      ["sue", "Sue Kim", "SUPERADMIN", false],
    ]);
    expect(directory.rows.map((row) => row.status)).toEqual(["ACTIVE", "ACTIVE", "ARCHIVED", "ACTIVE"]);
    expect(directory.countLabel).toBe("4 USERS");
    expect(directory.title).toBe("Platform console");
    expect(directory.rows.find((row) => row.id === "sue")?.superAdmin).toBe(true);
    expect(directory.rows.find((row) => row.id === "ann")?.self).toBe(true);
    expect(directory.count).toBe(4);
  });

  it("filters by name or email, and says when nothing matches", () => {
    expect(composePlatformDirectory(input({ filterQuery: "ray" })).rows.map((row) => row.id)).toEqual(["bob"]);
    expect(composePlatformDirectory(input({ filterQuery: "cid@" })).rows.map((row) => row.id)).toEqual(["cid"]);
    const none = composePlatformDirectory(input({ filterQuery: "zzz" }));
    expect(none.empty).toBe(true);
    expect(none.emptyCopy).toBe("No User matches this filter.");
  });
});

describe("what the console offers on one User (#266)", () => {
  const actions = (selectedId: string, currentUserId = "ann") =>
    composePlatformDirectory(input({ selectedId, currentUserId })).detail?.actions.map((action) => action.kind);

  it("offers role, reset and archive on another User, confirming role and archive", () => {
    const detail = composePlatformDirectory(input({ selectedId: "bob" })).detail;
    expect(detail?.actions.map((action) => [action.kind, action.label, action.confirm])).toEqual([
      ["role", "Make platform admin", true],
      ["reset", "Send password reset", false],
      ["archive", "Archive", true],
    ]);
    const role = detail?.actions.find((action) => action.kind === "role");
    expect(role?.body).toEqual({ role: "admin" });
    // The side effect #266 removed must not come back in the copy.
    expect(role?.consequence).toContain("Their role in each Workspace does not change.");
    expect(detail?.actions.find((action) => action.kind === "archive")?.consequence).toBe(
      "Bob Ray's Memberships in every Workspace will be archived, so they reach no Workspace. Their records stay, and the User can be restored here.",
    );
    // What a platform admin reaches is wider than the console itself.
    expect(role?.consequence).toBe(
      "Bob Ray will reach this console, every User on the platform and the controls kept for platform admins. Their role in each Workspace does not change.",
    );
    expect(detail?.actions.map((action) => [action.kind, action.destructive])).toEqual([
      ["role", false],
      ["reset", false],
      ["archive", true],
    ]);
  });

  it("reads the SuperAdmin flag in one place, from the route's own column", () => {
    const { superAdmin: _flag, ...row } = bob;
    expect(toPlatformUser({ ...row, isMainAdmin: 1 }).superAdmin).toBe(true);
    expect(toPlatformUser({ ...row, isMainAdmin: 0 }).superAdmin).toBe(false);
  });

  it("does not ask the detail route for the SuperAdmin unless the SuperAdmin is asking", () => {
    // GET /api/admin/users/:id answers 403 "Cannot view SuperAdmin details" otherwise.
    expect(composePlatformDirectory(input({ selectedId: "sue" })).detail?.readable).toBe(false);
    expect(composePlatformDirectory(input({ selectedId: "sue", currentUserId: "sue" })).detail?.readable).toBe(true);
    expect(composePlatformDirectory(input({ selectedId: "bob" })).detail?.readable).toBe(true);
  });

  it("says a password reset went out, since nothing in the register shows it", () => {
    const reset = composePlatformDirectory(input({ selectedId: "bob" })).detail?.actions.find(
      (action) => action.kind === "reset",
    );
    expect(reset?.done).toBe("Password reset sent to bob@example.com.");
  });

  it("restores an archived User without asking", () => {
    const detail = composePlatformDirectory(input({ selectedId: "cid" })).detail;
    const restore = detail?.actions.find((action) => action.kind === "restore");
    expect(restore).toMatchObject({ label: "Restore", confirm: false, body: { isArchived: false } });
  });

  it("offers nothing on the SuperAdmin to anyone but the SuperAdmin, since every route refuses it", () => {
    expect(actions("sue")).toEqual([]);
    expect(composePlatformDirectory(input({ selectedId: "sue" })).detail?.note).toBe(
      "Only the SuperAdmin can change the SuperAdmin.",
    );
    // Archive refuses the SuperAdmin even for itself, and refuses anyone archiving themselves.
    expect(actions("sue", "sue")).toEqual(["role", "reset"]);
  });

  it("lets a platform admin drop their own role, saying what it costs, but never archive themselves", () => {
    const detail = composePlatformDirectory(input({ selectedId: "ann" })).detail;
    expect(detail?.actions.map((action) => action.kind)).toEqual(["role", "reset"]);
    expect(detail?.actions[0]).toMatchObject({ label: "Remove platform admin", body: { role: "user" }, destructive: true });
    expect(detail?.actions[0].consequence).toBe(
      "You will lose access to this console at once, and to every User on the platform and the controls kept for platform admins. Your role in each Workspace does not change.",
    );
  });

  it("has no detail when nothing is selected", () => {
    expect(composePlatformDirectory(input()).detail).toBeNull();
  });
});

describe("the console page (#266)", () => {
  const page = read("client/src/v2/V2Platform.tsx");

  it("reads and writes through the path helpers, and confirms in the shared modal", () => {
    for (const helper of [
      "platformUsersPath(",
      "platformUserPath(",
      "platformUserRolePath(",
      "platformUserResetPath(",
      "platformUserArchivePath(",
    ]) {
      expect(page).toContain(helper);
    }
    expect(page).toContain("@/components/ui/alert-dialog");
    expect(page).not.toContain("<select");
    // The confirm cannot fire twice, as Billing's cancel cannot.
    expect(page).toMatch(/<AlertDialogAction[\s\S]*?disabled=\{pending\}/);
    // The detail read waits on the composer's word that the route will answer.
    expect(page).toContain("readable === true");
  });

  it("sends a User without the global role away", () => {
    expect(page).toMatch(/isPlatformAdmin\(/);
    expect(page).toMatch(/<Redirect to="\/"/);
  });
});
