import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FLAG_DEFS,
  flagEnvKey,
  resolveFlagValue,
} from "../../client/src/lib/featureFlags";
import {
  RAIL_COLLAPSED_STORAGE_KEY,
  authenticatedPresentation,
  formatElapsedClock,
  matchV2Route,
  navIdForPath,
  readRailCollapsed,
  timerChipModel,
  workspaceInitials,
  workspaceRoleLabel,
  writeRailCollapsed,
} from "../../client/src/v2/presentation";
import { workspaceRoleInCopy } from "../../client/src/v2/workspace";

const railSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Rail.tsx"),
  "utf8",
);

/**
 * Flagged authenticated app (#171). HTTP `/api/*` stays characterized elsewhere.
 * Do not assert hex values or the prototype DOM.
 */
describe("v2 chrome behind the client flag (#171)", () => {
  it("gates v2 on the existing VITE_FLAG port, on in development and off in production", () => {
    expect(FLAG_DEFS.webAppV2.dev).toBe(true);
    expect(FLAG_DEFS.webAppV2.prod).toBe(false);
    expect(flagEnvKey("webAppV2")).toBe("VITE_FLAG_WEB_APP_V2");
    expect(resolveFlagValue(FLAG_DEFS.webAppV2, "dev", undefined)).toBe(true);
    expect(resolveFlagValue(FLAG_DEFS.webAppV2, "prod", undefined)).toBe(false);
    expect(resolveFlagValue(FLAG_DEFS.webAppV2, "prod", "true")).toBe(true);
    expect(resolveFlagValue(FLAG_DEFS.webAppV2, "dev", "false")).toBe(false);
  });

  it("keeps signed-in / on the current Home with v1 chrome when the flag is off", () => {
    expect(authenticatedPresentation(false)).toEqual({
      chrome: "v1",
      signedInHome: "home",
    });
  });

  it("lands signed-in / on Today inside v2 chrome when the flag is on", () => {
    expect(authenticatedPresentation(true)).toEqual({
      chrome: "v2",
      signedInHome: "today",
    });
    expect(matchV2Route("/").kind).toBe("today");
  });

  it("treats unimplemented destinations as v2 placeholders, never v1 screens", () => {
    expect(matchV2Route("/not-in-this-batch").kind).toBe("placeholder");

    expect(matchV2Route("/help").kind).toBe("help");
    expect(matchV2Route("/help-center").kind).toBe("help");
    expect(matchV2Route("/help-center/getting-started").kind).toBe("help");
    expect(matchV2Route("/devices").kind).toBe("devices");

    expect(matchV2Route("/projects").kind).toBe("projects");
    expect(matchV2Route("/crm").kind).toBe("projects");
    expect(matchV2Route("/project/abc").kind).not.toBe("placeholder");
    expect(matchV2Route("/clients").kind).toBe("clients");
    expect(matchV2Route("/crm/client/1").kind).toBe("client-record");
    expect(matchV2Route("/opportunities").kind).toBe("opportunities");
    expect(matchV2Route("/project-documentation").kind).toBe("project-documentation");
    expect(matchV2Route("/documentation").kind).toBe("project-documentation");
    expect(matchV2Route("/company-documents").kind).toBe("documents");
    expect(matchV2Route("/people").kind).toBe("people");
    expect(matchV2Route("/administration").kind).toBe("administration");
    expect(matchV2Route("/admin").kind).toBe("administration");
    expect(matchV2Route("/time").kind).toBe("time");
    expect(matchV2Route("/time-tracking").kind).toBe("time");
    expect(matchV2Route("/daily-update").kind).toBe("daily-update");

    expect(navIdForPath("/help")).toBe("help");
    expect(navIdForPath("/devices")).toBe("devices");
  });

  it("leaves signed-out routing independent of the v2 flag", () => {
    expect(authenticatedPresentation(true).chrome).toBe("v2");
    expect(authenticatedPresentation(false).chrome).toBe("v1");
    expect(matchV2Route("/auth").kind).toBe("auth-redirect");
  });

  it("binds the Timer chip to running, paused, and idle states with one amber while it runs", () => {
    const running = timerChipModel({
      isRunning: true,
      isPaused: false,
      hasActiveEntry: true,
      displayDuration: 5076,
      projectLabel: "Northwind · Ledger rebuild",
      taskLabel: "Reconcile import totals",
    });
    expect(running.appearance).toBe("running");
    expect(running.holdsAmber).toBe(true);
    expect(running.pagePrimary).toBe("case-ink");
    expect(running.clock).toBe("01:24:36");

    const paused = timerChipModel({
      isRunning: false,
      isPaused: true,
      hasActiveEntry: true,
      displayDuration: 90,
      projectLabel: "Northwind · Ledger rebuild",
      taskLabel: "Reconcile import totals",
    });
    expect(paused.appearance).toBe("paused");
    expect(paused.holdsAmber).toBe(false);
    expect(paused.pagePrimary).toBe("case-ink");

    const idle = timerChipModel({
      isRunning: false,
      isPaused: false,
      hasActiveEntry: false,
      displayDuration: 0,
      projectLabel: null,
      taskLabel: null,
    });
    expect(idle.appearance).toBe("idle");
    expect(idle.holdsAmber).toBe(false);
  });

  it("shows Workspace initials and Workspace Role labels", () => {
    expect(workspaceInitials("Keystone Studio")).toBe("KS");
    expect(workspaceInitials("DocuFlow")).toBe("DO");
    // A self-service Owner keeps users.role = user; the rail reads the Membership.
    expect(workspaceRoleLabel("OWNER")).toBe("OWNER");
    expect(workspaceRoleLabel("ADMINISTRATOR")).toBe("ADMINISTRATOR");
    expect(workspaceRoleLabel("MEMBER")).toBe("MEMBER");
    // A Workspace may add its own Roles; the rail shouts the Role it was given
    // rather than demoting an unrecognised one to MEMBER (#250).
    expect(workspaceRoleLabel("Auditor")).toBe("AUDITOR");
    expect(workspaceRoleInCopy("Auditor")).toBe("Auditor");
    expect(workspaceRoleInCopy("OWNER")).toBe("Owner");
    expect(workspaceRoleLabel("")).toBe("MEMBER");
    expect(railSource).toContain("workspaceRoleLabel");
    expect(railSource).toMatch(/workspaceRoleLabel\([\s\S]*workspaceRole/);
    expect(railSource).not.toContain("isMainAdmin");
    expect(railSource).not.toMatch(/user\.role/);
  });

  it("persists rail collapse across destinations", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    expect(readRailCollapsed(storage)).toBe(false);
    writeRailCollapsed(storage, true);
    expect(store.get(RAIL_COLLAPSED_STORAGE_KEY)).toBe("true");
    expect(readRailCollapsed(storage)).toBe(true);
  });

  it("renders recorded elapsed time as a stable clock", () => {
    expect(formatElapsedClock(0)).toBe("00:00:00");
    expect(formatElapsedClock(65)).toBe("00:01:05");
  });
});
