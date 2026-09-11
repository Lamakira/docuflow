import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route } from "../../client/src/v2/presentation";
import {
  adminDailyUpdatesPath,
  canViewTeamDailyUpdates,
  composeTeamDailyUpdates,
  dailyUpdateRemindRefusal,
  remindDailyUpdatesPath,
  type TeamDailyUpdatesInput,
} from "../../client/src/v2/dailyUpdate";

/**
 * Team Daily Update review and Remind from Today (#209).
 * Seams: matchV2Route, composeTeamDailyUpdates over `/api/admin/daily-updates*`,
 * and HTTP characterization of Remind. Do not assert hex.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const todaySource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Today.tsx"),
  "utf8",
);

const teamSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2DailyUpdates.tsx"),
  "utf8",
);

const personalSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2DailyUpdate.tsx"),
  "utf8",
);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function emptyTeam(overrides: Partial<TeamDailyUpdatesInput> = {}): TeamDailyUpdatesInput {
  return {
    now: new Date(2026, 8, 11, 15, 0, 0),
    workspaceName: "Harbor Co",
    ownerName: "Sam Lee",
    canView: true,
    kpis: { total: 0, waitingOnClient: 0, blocked: 0, activeUsers: 0 },
    submittedToday: [],
    missingToday: [],
    updates: [],
    filterQuery: "",
    statusFilter: "all",
    memberFilter: "all",
    ...overrides,
  };
}

describe("Team Daily Update routing (#209)", () => {
  it("shows a live team review on /daily-updates and rewrites v1 /admin/daily-updates here", () => {
    expect(matchV2Route("/daily-updates")).toMatchObject({
      kind: "daily-updates",
      href: "/daily-updates",
    });
    expect(matchV2Route("/admin/daily-updates")).toMatchObject({
      kind: "daily-updates",
      href: "/daily-updates",
    });
    expect(breadcrumbFor("/daily-updates", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "DAILY UPDATES",
    ]);
    expect(matchV2Route("/daily-update").kind).toBe("daily-update");
    expect(matchV2Route("/admin").kind).toBe("administration");
    expect(matchV2Route("/admin/analytics").kind).toBe("administration");
    expect(appSource).toContain("V2TeamDailyUpdatesPage");
    expect(appSource).toMatch(/path="\/daily-updates"/);
    expect(appSource).toMatch(/path="\/admin\/daily-updates"/);
    expect(appSource).not.toContain('data-testid="v2-placeholder"');
  });
});

describe("Team Daily Update review (#209)", () => {
  it("refuses Members without the view Daily Updates Capability, never permission denied", () => {
    const page = composeTeamDailyUpdates(emptyTeam({ canView: false }));
    expect(page.kind).toBe("refusal");
    if (page.kind !== "refusal") return;
    expect(page.refusal).toBe(
      "You do not have the View Daily Updates Capability. Sam Lee (Owner) can grant it.",
    );
    expect(page.refusal.toLowerCase()).not.toContain("permission denied");
  });

  it("empty review uses empty geometry and never shows sample names or a Timesheet", () => {
    const page = composeTeamDailyUpdates(emptyTeam());
    const blob = JSON.stringify(page);

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.empty).toBe(true);
    expect(page.groups).toEqual([]);
    expect(page.emptyCopy.toLowerCase()).toContain("daily update");
    expect(page.submitted).toEqual([]);
    expect(page.missing).toEqual([]);
    expect(page.submittedEmptyCopy.toLowerCase()).toContain("member");
    expect(page.missingEmptyCopy).toBe("");
    expect(page.pagePrimary).toBe("case-ink");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
    expect(blob.toLowerCase()).not.toContain("timesheet");
  });

  it("lists submitted and missing today, then filters team submissions", () => {
    const page = composeTeamDailyUpdates(
      emptyTeam({
        kpis: { total: 2, waitingOnClient: 1, blocked: 1, activeUsers: 2 },
        submittedToday: [{ id: "u-sub", firstName: "Pat", lastName: "Ng", email: "pat@example.com" }],
        missingToday: [{ id: "u-miss", firstName: "Jules", lastName: "Ade", email: "jules@example.com" }],
        updates: [
          {
            id: "du-1",
            userId: "u-sub",
            status: "on_track",
            updateDate: new Date(2026, 8, 11, 9, 0, 0),
            whatHappened: "Shipped the import.",
            nextSteps: "Wire the API.",
            waitingOnClient: false,
            user: { firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
            crmProject: { project: { name: "Harbour rebuild" } },
          },
          {
            id: "du-2",
            userId: "u-sub",
            status: "blocked_client",
            updateDate: new Date(2026, 8, 10, 16, 0, 0),
            whatHappened: "Waiting on drawings.",
            waitingOnClient: true,
            user: { firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
            crmProject: { project: { name: "Pier survey" } },
          },
        ],
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.submitted).toEqual([{ id: "u-sub", name: "Pat Ng" }]);
    expect(page.missing).toEqual([{ id: "u-miss", name: "Jules Ade" }]);
    expect(page.kpis.map((row) => row.value)).toEqual(["2", "1", "1", "2"]);
    expect(page.groups).toHaveLength(1);
    expect(page.groups[0].name).toBe("Pat Ng");
    expect(page.groups[0].updates[0]).toMatchObject({
      id: "du-1",
      project: "Harbour rebuild",
      status: "On Track",
      prose: "Shipped the import.",
      when: "09:00",
    });
    expect(JSON.stringify(page)).not.toContain("Keystone");

    const filtered = composeTeamDailyUpdates(
      emptyTeam({
        updates: [
          {
            id: "du-1",
            userId: "u-sub",
            status: "on_track",
            updateDate: new Date(2026, 8, 11, 9, 0, 0),
            whatHappened: "Shipped the import.",
            user: { firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
            crmProject: { project: { name: "Harbour rebuild" } },
          },
        ],
        statusFilter: "blocked_client",
      }),
    );
    expect(filtered.kind).toBe("ready");
    if (filtered.kind !== "ready") return;
    expect(filtered.empty).toBe(true);
    expect(filtered.emptyCopy.toLowerCase()).toContain("filter");
  });

  it("asks existing admin Daily Update routes, including Remind", () => {
    const path = adminDailyUpdatesPath({
      startDate: new Date(Date.UTC(2026, 8, 4, 0, 0, 0)),
      endDate: new Date(Date.UTC(2026, 8, 11, 23, 59, 59, 999)),
    });
    expect(path.startsWith("/api/admin/daily-updates?")).toBe(true);
    expect(decodeURIComponent(path)).toContain("2026-09-04T00:00:00.000Z");
    expect(remindDailyUpdatesPath()).toBe("/api/admin/daily-updates/remind");
    expect(teamSource).toContain("adminDailyUpdatesPath");
    expect(teamSource).toContain("adminDailyUpdateTodayStatusPath");
    expect(teamSource).not.toContain('missingEmptyCopy || "Everyone has submitted');
    expect(todaySource).toContain("remindDailyUpdatesPath");
    expect(personalSource).toContain("/api/daily-updates");
    expect(personalSource).toContain("POST");
    expect(personalSource).not.toContain("DailyUpdatesAdminPage");
  });

  it("gates team review on the existing View Daily Updates grant", () => {
    expect(canViewTeamDailyUpdates({ role: "admin", canViewDailyUpdates: 0 })).toBe(true);
    expect(canViewTeamDailyUpdates({ role: "user", canViewDailyUpdates: 1 })).toBe(true);
    expect(canViewTeamDailyUpdates({ role: "user", canViewDailyUpdates: 0 })).toBe(false);
    expect(teamSource).toContain("canViewTeamDailyUpdates");
    expect(todaySource).toContain("canViewTeamDailyUpdates");
  });

  it("names Capability and Read-only on Remind", () => {
    expect(
      dailyUpdateRemindRefusal({
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        readOnly: true,
      }),
    ).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");
    expect(
      dailyUpdateRemindRefusal({
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Access denied",
      }),
    ).toBe("You do not have the View Daily Updates Capability. Sam Lee (Owner) can grant it.");
    expect(
      dailyUpdateRemindRefusal({
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Workspace is read-only",
      }),
    ).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");
  });
});

describe("Daily Update Remind motion (#209)", () => {
  it("resolves the Remind row or opens a refusal from that control, without KPI or filter motion", () => {
    const remind = motionForSurface("daily-update-remind");
    expect(remind.enterExit).toBe("standard");
    expect(remind.movement).toBe("allowed");

    const reduced = motionForSurface("daily-update-remind", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-attention-row[data-state="resolved"][data-motion="standard"]')).toMatch(
      /var\(--ease-out\)/,
    );
    expect(rule('.df-attention-row[data-state="resolved"][data-motion="standard"]')).not.toMatch(
      /transition\s*:\s*all\b/,
    );
    expect(rule(".df-kpi-value")).toMatch(/transition:\s*none/);
    expect(rule(".df-filter-input input")).toMatch(/transition:\s*none/);
    expect(todaySource).toMatch(/v2-today-remind/);
    expect(todaySource).toContain("ownerName");
    expect(todaySource).toContain("v2-today-remind-refusal");
    expect(reducedMotionCss()).toMatch(
      /\.df-attention-row\[data-state="resolved"\]\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
    );
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
