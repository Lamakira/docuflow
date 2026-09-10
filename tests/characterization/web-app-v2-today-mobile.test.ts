import { describe, expect, it } from "vitest";
import {
  chromeLayoutForViewport,
  contextSurface,
  matchV2Route,
  timerChipModel,
} from "../../client/src/v2/presentation";
import { composeToday, mobileProjectMeta, type TodayInput } from "../../client/src/v2/today";

/**
 * Today at phone width (#175). Artifact 05: app bar, Timer strip, stacked register,
 * context panel as a full-height sheet on the same route.
 * Seam: chromeLayoutForViewport + composeToday. No new BFF. Do not assert hex or prototype DOM.
 */

function emptyInput(overrides: Partial<TodayInput> = {}): TodayInput {
  return {
    now: new Date(2026, 8, 8, 12, 0, 0),
    currentUserId: "user-1",
    projects: [],
    notifications: [],
    recentDocuments: [],
    users: [],
    todaySecondsByUser: [],
    monthSecondsByProject: [],
    missingDailyUpdates: null,
    trackingUserId: null,
    ...overrides,
  };
}

describe("Today mobile pattern (#175)", () => {
  it("below ~640px uses Artifact 05 chrome: app bar, Timer strip, stacked register", () => {
    const phone = chromeLayoutForViewport(390);
    expect(phone.mode).toBe("mobile");
    expect(phone.chrome).toBe("app-bar");
    expect(phone.timer).toBe("strip");
    expect(phone.context).toBe("sheet");
    expect(phone.rail).toBe("drawer");
    expect(phone.contentMinWidth).toBeNull();
    expect(phone.stackedRegister).toBe(true);
    expect(phone.actionBar).toBe(true);

    const justBelow = chromeLayoutForViewport(639);
    expect(justBelow.mode).toBe("mobile");
  });

  it("keeps desktop Today unchanged at 640px and above", () => {
    const desktop = chromeLayoutForViewport(640);
    expect(desktop.mode).toBe("desktop");
    expect(desktop.chrome).toBe("command-bar");
    expect(desktop.timer).toBe("chip");
    expect(desktop.context).toBe("side-panel");
    expect(desktop.rail).toBe("fixed");
    expect(desktop.contentMinWidth).toBe(1060);
    expect(desktop.stackedRegister).toBe(false);
    expect(desktop.actionBar).toBe(false);
    expect(chromeLayoutForViewport(1440).mode).toBe("desktop");
  });

  it("opens the desktop context panel as a full-height sheet on the same Today route", () => {
    const layout = chromeLayoutForViewport(390);
    const open = contextSurface("approvals", layout, "/");
    expect(open.kind).toBe("sheet");
    expect(open.route).toBe("/");
    expect(matchV2Route(open.route).kind).toBe("today");

    const closed = contextSurface(null, layout, "/");
    expect(closed.kind).toBe("none");
    expect(closed.route).toBe("/");

    const desktopOpen = contextSurface("approvals", chromeLayoutForViewport(1440), "/");
    expect(desktopOpen.kind).toBe("side-panel");
    expect(desktopOpen.route).toBe("/");
  });

  it("uses the same live Today records and honest empty Timesheet copy", () => {
    const today = composeToday(
      emptyInput({
        projects: [
          {
            id: "prj-live",
            projectStatus: "active",
            projectType: "one_time",
            budgetedHours: 50,
            actualHours: 31,
            project: { id: "doc-1", name: "Ledger rebuild" },
            client: { name: "Harbor Co" },
            assignee: null,
          },
        ],
        monthSecondsByProject: [{ crmProjectId: "prj-live", totalDuration: 258120 }],
        missingDailyUpdates: [{ id: "u2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" }],
      }),
    );

    expect(today.projects[0].href).toBe("/projects/prj-live");
    expect(mobileProjectMeta(today.projects[0])).toBe("Harbor Co · ACTIVE · 71.7 h");
    expect(today.attention.some((row) => /Pat Ng/.test(row.title))).toBe(true);
    expect(today.attention.some((row) => row.kind === "APPROVAL")).toBe(false);
    expect(today.approvals.empty).toBe(true);
    expect(today.approvals.copy.toLowerCase()).toContain("timesheet");
    expect(JSON.stringify(today)).not.toContain("Keystone");
    expect(matchV2Route("/opportunities").kind).toBe("opportunities");
  });

  it("gives the running Timer strip the viewport's only amber", () => {
    const running = timerChipModel({
      isRunning: true,
      isPaused: false,
      hasActiveEntry: true,
      displayDuration: 5076,
      projectLabel: "Harbor Co · Ledger rebuild",
      taskLabel: "Reconcile import totals",
    });
    expect(running.holdsAmber).toBe(true);
    expect(running.pagePrimary).toBe("case-ink");
    expect(chromeLayoutForViewport(390).timer).toBe("strip");
  });
});
