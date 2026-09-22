import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { motionForSurface } from "../../client/src/v2/motion";
import {
  chooserInvitationRows,
  membershipRoleLabel,
  notificationOrigin,
  timerChipOnSwitch,
  workspaceCondition,
  workspaceEntry,
  workspaceOwnerName,
  workspaceSwitcher,
} from "../../client/src/v2/workspace";
import { timerChipModel } from "../../client/src/v2/presentation";
import { chromeRefusal } from "../../client/src/v2/chrome";

/**
 * Active Workspace switcher, chooser, Timer label, and switch motion (#183).
 * Seam: presentation helpers + motionForSurface + tokens.css.
 * Do not assert cubic-beziers, millisecond durations, or hex.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const seeded = {
  workspaceId: "seeded",
  workspaceName: "DocuFlow",
  workspaceRole: "MEMBER",
  condition: null as const,
};
const harbour = {
  workspaceId: "parallel",
  workspaceName: "Harbour View",
  workspaceRole: "ADMINISTRATOR",
  condition: "Trial" as const,
};

const v2Dir = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");

/**
 * The Owner a refusal names (#250). The Owner is a Membership of the Workspace
 * the reader is standing in, never the platform SuperAdmin flag on a User.
 */
describe("v2 Workspace Owner (#250)", () => {
  it("names the Owner from the Memberships of the active Workspace", () => {
    expect(
      workspaceOwnerName([
        { firstName: "Pat", lastName: "Ng", email: "pat@example.com", workspaceRole: "MEMBER" },
        { firstName: "Sam", lastName: "Lee", email: "sam@example.com", workspaceRole: "OWNER" },
      ]),
    ).toBe("Sam Lee");
  });

  it("falls back to the Owner's email when the Membership carries no name", () => {
    expect(
      workspaceOwnerName([{ firstName: null, lastName: null, email: "sam@example.com", workspaceRole: "owner" }]),
    ).toBe("sam@example.com");
  });

  it("returns null rather than a wrong name when no Membership holds the Owner Role", () => {
    expect(workspaceOwnerName([])).toBeNull();
    expect(
      workspaceOwnerName([
        { firstName: "Pat", lastName: "Ng", email: "pat@example.com", workspaceRole: "ADMINISTRATOR" },
      ]),
    ).toBeNull();
  });

  it("reads no Owner from the platform SuperAdmin flag anywhere in v2", () => {
    const offenders = readdirSync(v2Dir)
      .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
      .filter((name) => readFileSync(join(v2Dir, name), "utf8").includes("isMainAdmin"));
    expect(offenders).toEqual([]);
  });

  it("has every screen that names the Owner take it from the Workspace Memberships", () => {
    const bindings = readdirSync(v2Dir)
      .filter((name) => name.endsWith(".tsx"))
      .flatMap((name) => {
        const source = readFileSync(join(v2Dir, name), "utf8");
        return [...source.matchAll(/const ownerName = (.*);/g)].map((match) => `${name}: ${match[1]}`);
      });
    // Every screen that ends a refusal with the Owner reads the same Membership,
    // through the hook or the lookup it wraps.
    for (const binding of bindings) {
      expect(binding).toMatch(/useWorkspaceOwnerName\(\)|workspaceOwnerName\(/);
    }
    // The seven that read the SuperAdmin flag before #250, by name.
    for (const screen of [
      "V2Activity.tsx",
      "V2Clients.tsx",
      "V2Document.tsx",
      "V2Documents.tsx",
      "V2Dossier.tsx",
      "V2Opportunities.tsx",
      "V2ProjectDocumentation.tsx",
    ]) {
      expect(bindings).toContain(`${screen}: useWorkspaceOwnerName()`);
    }
  });

  it("names the Owner of a self-service Workspace, which has no SuperAdmin to find", () => {
    const memberships = [
      { firstName: "Sam", lastName: "Lee", email: "sam@example.com", workspaceRole: "OWNER" },
      { firstName: "Pat", lastName: "Ng", email: "pat@example.com", workspaceRole: "MEMBER" },
    ];
    expect(
      chromeRefusal({
        kind: "capability",
        capability: "Manage Clients",
        ownerName: workspaceOwnerName(memberships),
      }),
    ).toBe("You do not have the Manage Clients Capability. Sam Lee (Owner) can grant it.");
  });
});

describe("v2 Active Workspace (#183)", () => {
  it("enters the only active Membership with no chooser", () => {
    expect(workspaceEntry({ memberships: [seeded], lastActiveWorkspaceId: null })).toEqual({
      kind: "enter",
      workspaceId: "seeded",
    });
  });

  it("shows a chooser naming Workspace, Workspace Role, and condition when there are several and none remembered", () => {
    const entry = workspaceEntry({
      memberships: [harbour, seeded],
      lastActiveWorkspaceId: null,
    });
    expect(entry.kind).toBe("chooser");
    if (entry.kind !== "chooser") return;
    expect(entry.rows.map((row) => row.workspaceName)).toEqual(["DocuFlow", "Harbour View"]);
    expect(entry.rows[1]).toMatchObject({
      workspaceName: "Harbour View",
      workspaceRole: "ADMINISTRATOR",
      condition: "Trial",
    });
  });

  it("shows the chooser when a pending Invitation must surface as an accept action", () => {
    expect(
      workspaceEntry({
        memberships: [seeded],
        lastActiveWorkspaceId: "seeded",
        invitations: [{ id: "inv-1" }],
      }).kind,
    ).toBe("chooser");
  });

  it("offers the last Active Workspace first and enters it on the next sign-in", () => {
    const entry = workspaceEntry({
      memberships: [seeded, harbour],
      lastActiveWorkspaceId: "parallel",
    });
    expect(entry).toEqual({ kind: "enter", workspaceId: "parallel" });

    const switcher = workspaceSwitcher({
      memberships: [seeded, harbour],
      activeWorkspaceId: "parallel",
      timerWorkspaceId: "seeded",
    });
    expect(switcher.rows[0].workspaceId).toBe("parallel");
    expect(switcher.rows[0].active).toBe(true);
    expect(switcher.rows.find((row) => row.workspaceId === "seeded")?.timer).toBe(true);
  });

  it("omits Archived Memberships from the switcher", () => {
    const switcher = workspaceSwitcher({
      memberships: [seeded, { ...harbour, archived: true }],
      activeWorkspaceId: "seeded",
      timerWorkspaceId: null,
    });
    expect(switcher.rows.map((row) => row.workspaceId)).toEqual(["seeded"]);
  });

  it("lists other Workspaces in the menu, not the Active Workspace a second time (#249)", () => {
    const switcher = workspaceSwitcher({
      memberships: [seeded, harbour],
      activeWorkspaceId: "parallel",
      timerWorkspaceId: "seeded",
    });
    expect(switcher.current?.workspaceId).toBe("parallel");
    expect(switcher.others.map((row) => row.workspaceId)).toEqual(["seeded"]);
    expect(switcher.others.some((row) => row.active)).toBe(false);

    const alone = workspaceSwitcher({
      memberships: [seeded],
      activeWorkspaceId: "seeded",
      timerWorkspaceId: null,
    });
    expect(alone.current?.workspaceId).toBe("seeded");
    expect(alone.others).toEqual([]);
  });

  it("labels a Timer with the Workspace it belongs to and does not steal the entered Workspace's amber identity", () => {
    const running = timerChipModel({
      isRunning: true,
      isPaused: false,
      hasActiveEntry: true,
      displayDuration: 5076,
      projectLabel: "Northwind · Ledger rebuild",
      taskLabel: "Reconcile import totals",
      workspaceLabel: "DocuFlow",
    });
    expect(running.appearance).toBe("running");
    expect(running.holdsAmber).toBe(true);
    expect(running.subtitle).toBe("DocuFlow");

    const onSwitch = timerChipOnSwitch({
      timerWorkspaceId: "seeded",
      activeWorkspaceId: "parallel",
      holdsAmber: true,
    });
    expect(onSwitch.holdsAmber).toBe(true);
    expect(onSwitch.belongsToActiveWorkspace).toBe(false);
    expect(onSwitch.welcomeMotion).toBe("none");
  });

  it("always names the originating Workspace on a Notification", () => {
    expect(
      notificationOrigin({
        workspace: { id: "seeded", name: "DocuFlow" },
      }),
    ).toBe("DocuFlow");
  });

  it("maps billing state to Trial / Read-only / Past due and Workspace Role slugs to labels", () => {
    expect(workspaceCondition("Trialing")).toBe("Trial");
    expect(workspaceCondition("ReadOnly")).toBe("Read-only");
    expect(workspaceCondition("PastDue")).toBe("Past due");
    expect(workspaceCondition("Active")).toBeNull();
    expect(membershipRoleLabel("owner")).toBe("OWNER");
    expect(membershipRoleLabel("administrator")).toBe("ADMINISTRATOR");
    expect(membershipRoleLabel("member")).toBe("MEMBER");
  });

  it("crossfades operational content on switch, keeps opacity under reduced motion, and does not animate the Timer chip or chooser pointer/keyboard", () => {
    const switchMotion = motionForSurface("workspace-switch");
    expect(switchMotion.enterExit).toBe("standard");
    expect(switchMotion.movement).toBe("allowed");

    const reduced = motionForSurface("workspace-switch", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);
    expect(reduced.enterExit).toBe("standard");

    expect(motionForSurface("workspace-chooser-pointer").enterExit).toBe("instant");
    expect(motionForSurface("workspace-chooser-keyboard").enterExit).toBe("instant");
    expect(motionForSurface("timer-chip").enterExit).toBe("instant");

    expect(rule(".df-workspace-content")).toMatch(/opacity/);
    expect(rule('.df-workspace-content[data-motion="standard"]')).toMatch(/transform/);
    // At rest it must be `none`. `translateY(0)` still makes this element the
    // containing block for every fixed descendant, and a dragged board card was
    // drawn a rail's width away from the pointer.
    expect(rule('.df-workspace-content[data-motion="standard"]')).toMatch(/transform:\s*none/);
    expect(rule('.df-workspace-content[data-motion="standard"]')).not.toMatch(/translateY\(0\)/);
    expect(reducedMotionCss()).toMatch(/\.df-workspace-content[^{]*\{[^}]*transform:\s*none/);
    expect(rule(".df-v2.df-menu")).toMatch(/transition:\s*none/);
    expect(rule(".df-chooser")).toMatch(/transition:\s*none/);
  });

  it("surfaces a pending Invitation as an accept action, not as a Membership", () => {
    const invitations = chooserInvitationRows([
      {
        id: "inv-1",
        workspaceId: "parallel",
        workspaceName: "Harbour View",
        workspaceRole: "MEMBER",
        token: "ab".padEnd(64, "c"),
      },
    ]);
    expect(invitations).toEqual([
      {
        kind: "invitation",
        action: "accept",
        id: "inv-1",
        workspaceId: "parallel",
        workspaceName: "Harbour View",
        workspaceRole: "MEMBER",
        token: "ab".padEnd(64, "c"),
      },
    ]);
    expect(invitations[0]).not.toHaveProperty("archived");

    const chooserSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2WorkspaceChooser.tsx"),
      "utf8",
    );
    expect(chooserSource).toContain("Invitation");
    expect(chooserSource).toContain("Accept");

    const shellSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Shell.tsx"),
      "utf8",
    );
    expect(shellSource).toContain("myInvitationsPath");
  });
});

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function reducedMotionCss(): string {
  return [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n");
}
