import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeTwoFactorSetting,
  grantExpiryLabel,
  grantHours,
  supportAccessNotice,
  workspaceNeedsSecondFactor,
} from "../../client/src/v2/supportAccess";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, path), "utf8");

describe("Support access in the Workspace (#300)", () => {
  it("tells the Workspace about an active grant, and stays quiet when there is none", () => {
    expect(supportAccessNotice([])).toBeNull();
    expect(
      supportAccessNotice([
        { id: "g1", platformStaffId: "s1", email: "ada@example.com", expiresAt: "2026-10-02T12:00:00.000Z" },
      ]),
    ).toMatch(/ada@example.com has read-only access to this Workspace until /);
    expect(
      supportAccessNotice([
        { id: "g1", platformStaffId: "s1", email: null, expiresAt: "2026-10-02T12:00:00.000Z" },
        { id: "g2", platformStaffId: "s2", email: "bea@example.com", expiresAt: "2026-10-03T12:00:00.000Z" },
      ]),
    ).toBe("2 Platform Staff have read-only access to this Workspace.");
  });

  it("names the expiry as a calendar day", () => {
    expect(grantExpiryLabel(new Date(2026, 9, 2, 15, 0, 0))).toBe("2 OCT 2026");
    expect(grantExpiryLabel("not-a-date")).toBe("");
  });

  it("offers 24 hours by default and 7 days when asked", () => {
    expect(grantHours("24")).toBeUndefined();
    expect(grantHours("168")).toBe(168);
  });

  it("closes the Workspace only when a second factor is required and this session has none", () => {
    expect(workspaceNeedsSecondFactor(undefined)).toBe(false);
    expect(workspaceNeedsSecondFactor({ required: false, secondFactorVerified: false })).toBe(false);
    expect(workspaceNeedsSecondFactor({ required: true, secondFactorVerified: true })).toBe(false);
    expect(workspaceNeedsSecondFactor({ required: true, secondFactorVerified: false })).toBe(true);
  });

  it("lets only the Owner change the requirement", () => {
    const owner = composeTwoFactorSetting({ required: false, workspaceRole: "OWNER", secondFactorVerified: true });
    expect(owner.canChange).toBe(true);
    expect(owner.action).toBe("Require a second factor");
    const admin = composeTwoFactorSetting({ required: true, workspaceRole: "ADMINISTRATOR", secondFactorVerified: true });
    expect(admin.canChange).toBe(false);
    expect(admin.action).toBe("Stop requiring a second factor");
  });

  it("keeps an Owner without a second factor from requiring one", () => {
    const blocked = composeTwoFactorSetting({ required: false, workspaceRole: "OWNER", secondFactorVerified: false });
    expect(blocked.canChange).toBe(true);
    expect(blocked.blocked).toBe(
      "Set up a second factor on your own account first. Requiring one now would lock you out of this Workspace too.",
    );
    expect(
      composeTwoFactorSetting({ required: false, workspaceRole: "OWNER", secondFactorVerified: true }).blocked,
    ).toBeNull();
    expect(
      composeTwoFactorSetting({ required: true, workspaceRole: "OWNER", secondFactorVerified: false }).blocked,
    ).toBeNull();
    expect(
      composeTwoFactorSetting({ required: false, workspaceRole: "ADMINISTRATOR", secondFactorVerified: false }).blocked,
    ).toBeNull();
  });

  it("shows the grant in the shell and the section in Administration", () => {
    const shell = read("../../client/src/v2/V2Shell.tsx");
    const admin = read("../../client/src/v2/V2Administration.tsx");
    expect(shell).toContain('data-testid="v2-support-access-banner"');
    expect(shell).toContain("<WorkspaceSecondFactor />");
    expect(admin).toContain('<TabsContent value="support-access"');
    expect(admin).toContain("<V2SupportAccess");
  });

  it("draws no active grant as the designed empty state", () => {
    const screen = read("../../client/src/v2/V2SupportAccess.tsx");
    expect(screen).toContain("<V2EmptyState");
    expect(screen).toContain('icon="access"');
    expect(screen).toContain('testId="v2-support-access-empty"');
  });
});
