import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  workspaceSwitcher,
} from "../../client/src/v2/workspace";
import { timerChipModel } from "../../client/src/v2/presentation";

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
    expect(reducedMotionCss()).toMatch(/\.df-workspace-content[^{]*\{[^}]*transform:\s*none/);
    expect(rule(".df-ws-menu")).toMatch(/transition:\s*none/);
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
