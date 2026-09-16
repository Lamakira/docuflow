import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import { motionForSurface } from "../../client/src/v2/motion";
import { workspaceEntry } from "../../client/src/v2/workspace";
import {
  accountDeletionPath,
  composeAccountDeletion,
  composeFirstWorkspace,
  suggestedWorkspaceName,
  workspaceNameError,
  workspaceOwnerPath,
  workspacePath,
  workspacesPath,
  type AccountDeletionState,
} from "../../client/src/v2/lifecycle";

/**
 * Workspace lifecycle presentation (#217, Flows 1, 5, 10).
 * Seams: lifecycle.ts composition, matchV2Route for the account destination,
 * and the signed-out router in App.tsx. HTTP is characterized separately in
 * workspace-lifecycle.test.ts. Do not assert hex or millisecond curves.
 */

const here = dirname(fileURLToPath(import.meta.url));

function source(path: string): string {
  return readFileSync(join(here, "../..", path), "utf8");
}

const appSource = source("client/src/App.tsx");
const shellSource = source("client/src/v2/V2Shell.tsx");
const railSource = source("client/src/v2/V2Rail.tsx");
const firstWorkspaceSource = source("client/src/v2/V2FirstWorkspace.tsx");
const accountSource = source("client/src/v2/V2Account.tsx");
const v2AppSource = source("client/src/v2/V2AuthenticatedApp.tsx");
const css = source("client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

function state(overrides: Partial<AccountDeletionState> = {}): AccountDeletionState {
  return {
    ownedWorkspaces: [],
    scheduled: null,
    gracePeriodDays: 30,
    ...overrides,
  };
}

describe("the first Workspace is named, not configured (#217, Flow 1)", () => {
  it("offers a default derived from the person, and falls back to the address", () => {
    expect(suggestedWorkspaceName({ firstName: "Sam", lastName: "Reyes", email: "sam@keystone.test" })).toBe(
      "Sam's Workspace",
    );
    expect(suggestedWorkspaceName({ firstName: null, lastName: null, email: "dana.lee@keystone.test" })).toBe(
      "Dana's Workspace",
    );
    expect(suggestedWorkspaceName(null)).toBe("My Workspace");
  });

  it("refuses an empty name and one longer than the column", () => {
    expect(workspaceNameError("")).toBe("empty");
    expect(workspaceNameError("   ")).toBe("empty");
    expect(workspaceNameError("Keystone Studio")).toBeNull();
    expect(workspaceNameError("x".repeat(256))).toBe("too-long");
  });

  it("is one field and one action — no wizard, no tour, no role question", () => {
    const page = composeFirstWorkspace({ name: "Keystone Studio", status: "ready" });

    expect(page.title).toMatch(/Workspace/);
    expect(page.action).toBe("Create Workspace");
    expect(page.canSubmit).toBe(true);
    expect(page.error).toBeNull();
    // Flow 5 begins here: the Trial is stated, never chosen, and carries no card.
    expect(page.trialNote).toMatch(/Trial/);
    expect(page.trialNote.toLowerCase()).toContain("no card");
    // Flow 2's other way out — an archived Member's account is fine, and an
    // Invitation gets them back in without creating anything.
    expect(page.invitationNote).toMatch(/Invitation/);
    expect(JSON.stringify(page).toLowerCase()).not.toMatch(/step 1|tour|choose your role|team size/);
  });

  it("cannot be submitted empty or while the create is in flight", () => {
    expect(composeFirstWorkspace({ name: " ", status: "ready" }).canSubmit).toBe(false);
    expect(composeFirstWorkspace({ name: "Keystone", status: "creating" }).canSubmit).toBe(false);
    expect(composeFirstWorkspace({ name: "Keystone", status: "creating" }).action).toBe("Creating…");
  });

  it("carries the server's refusal instead of a generic failure", () => {
    const page = composeFirstWorkspace({
      name: "Keystone",
      status: "error",
      message: "Workspace name is required",
    });
    expect(page.error).toBe("Workspace name is required");
  });

  it("marks the created Workspace as rare state, and reduced motion keeps opacity", () => {
    expect(composeFirstWorkspace({ name: "Keystone", status: "created" }).motion).toBe("standard");
    expect(composeFirstWorkspace({ name: "Keystone", status: "ready" }).motion).toBe("none");

    const recipe = motionForSurface("first-workspace-created");
    expect(recipe.keepOpacity).toBe(true);
    expect(motionForSurface("first-workspace-created", { reducedMotion: true }).movement).toBe("none");
    // Confirmation keystrokes are on the do-not-animate list.
    expect(motionForSurface("account-confirm-typing").enterExit).toBe("instant");
    expect(motionForSurface("account-confirm-typing").movement).toBe("none");
  });

  it("asks the Workspace BFF, not a Clerk surface", () => {
    expect(workspacesPath()).toBe("/api/workspaces");
    expect(workspacePath("ws-1")).toBe("/api/workspaces/ws-1");
    expect(workspaceOwnerPath("ws-1")).toBe("/api/workspaces/ws-1/owner");
    expect(firstWorkspaceSource).toContain("workspacesPath");
    expect(firstWorkspaceSource).not.toMatch(/password|SignUp/i);
  });

  it("stands in for the shell when the User holds no Membership", () => {
    expect(shellSource).toContain("V2FirstWorkspace");
    expect(shellSource).toMatch(/first-run/);

    expect(workspaceEntry({ memberships: [], lastActiveWorkspaceId: null })).toEqual({
      kind: "first-run",
    });
    // An Invitation takes precedence — the invitee accepts, they do not create.
    expect(
      workspaceEntry({
        memberships: [],
        lastActiveWorkspaceId: null,
        invitations: [{ id: "inv-1" }],
      }),
    ).toMatchObject({ kind: "chooser" });
    // And a sole Membership still enters directly (Flow 4).
    expect(
      workspaceEntry({
        memberships: [
          { workspaceId: "ws-1", workspaceName: "Keystone", workspaceRole: "OWNER", condition: "Trial" },
        ],
        lastActiveWorkspaceId: null,
      }),
    ).toEqual({ kind: "enter", workspaceId: "ws-1" });
  });
});

describe("account deletion states its precondition (#217, Flow 10)", () => {
  it("blocks while an owned Workspace remains, and names each one with its choice", () => {
    const page = composeAccountDeletion({
      state: state({
        ownedWorkspaces: [
          { workspaceId: "ws-1", workspaceName: "Keystone Studio", otherActiveMembers: 3 },
          { workspaceId: "ws-2", workspaceName: "Harbour View", otherActiveMembers: 0 },
        ],
      }),
      confirmation: "",
    });

    expect(page.precondition.met).toBe(false);
    expect(page.action).toBe("blocked");
    expect(page.precondition.rows.map((row) => row.workspaceName)).toEqual([
      "Keystone Studio",
      "Harbour View",
    ]);
    expect(page.precondition.rows[0].choice).toBe("transfer");
    expect(page.precondition.rows[1].choice).toBe("delete");
    expect(page.precondition.copy).toMatch(/transferred or deleted/i);
  });

  it("says plainly what survives and why, and never offers to purge what is not theirs", () => {
    const page = composeAccountDeletion({ state: state(), confirmation: "" });

    expect(page.survives).toMatch(/recorded time/i);
    expect(page.survives).toMatch(/Daily Update/i);
    expect(page.survives).toMatch(/Workspace/);
    expect(JSON.stringify(page).toLowerCase()).not.toContain("purge");
  });

  it("needs the typed confirmation before it will start the window", () => {
    const blocked = composeAccountDeletion({ state: state(), confirmation: "" });
    expect(blocked.action).toBe("start");
    expect(blocked.canSubmit).toBe(false);
    expect(blocked.confirmPhrase).toBe("delete my account");

    const ready = composeAccountDeletion({ state: state(), confirmation: "Delete My Account" });
    expect(ready.canSubmit).toBe(true);
  });

  it("states the completion date and how to cancel once the window runs", () => {
    const page = composeAccountDeletion({
      state: state({
        scheduled: { requestedAt: "2026-09-16T09:00:00.000Z", completesAt: "2026-10-16T09:00:00.000Z" },
      }),
      confirmation: "",
    });

    expect(page.grace.active).toBe(true);
    expect(page.grace.completesOn).toBe("16 October 2026");
    expect(page.grace.copy).toMatch(/cancel/i);
    expect(page.action).toBe("cancel");
    expect(page.actionLabel).toBe("Cancel deletion");
    expect(page.canSubmit).toBe(true);
    // Explanation, not delight.
    expect(page.motion).toBe("none");
  });

  it("is reached from the account menu and asks the account BFF", () => {
    expect(accountDeletionPath()).toBe("/api/account/deletion");
    expect(railSource).toContain("/account");
    expect(railSource).toMatch(/Account/);
    expect(accountSource).toContain("accountDeletionPath");
  });

  it("is a v2 destination, not a placeholder, and owns no rail entry", () => {
    expect(matchV2Route("/account")).toMatchObject({ kind: "account", href: "/account" });
    expect(navIdForPath("/account")).toBeNull();
    expect(v2AppSource).toMatch(/path="\/account" component=\{V2AccountPage\}/);
  });

  it("holds the confirmation inputs still and fades the rest on opacity alone", () => {
    const confirm = ruleFor(".df-account-workspace-action input");
    expect(confirm).toContain("transition: none");
    expect(confirm).toContain("animation: none");

    const grace = ruleFor('.df-account-grace[data-motion="standard"]');
    expect(grace).toContain("opacity");
    expect(grace).toContain("transform: none");

    const created = ruleFor('.df-first-workspace-card[data-motion="standard"]');
    expect(created).toContain("opacity");
    expect(created).toContain("transform: none");
  });
});

describe("signed-out / presents authentication (#217)", () => {
  it("routes / to Auth and retires the in-app Landing", () => {
    expect(appSource).not.toContain("pages/Landing");
    expect(appSource).not.toContain("component={Landing}");
    expect(appSource).toMatch(/function SignedOutSwitch[\s\S]*?component=\{AuthPage\}/);
  });

  it("does not ship the marketing site into the app", () => {
    expect(appSource).not.toMatch(/docuflow-marketing|astro/i);
  });
});
