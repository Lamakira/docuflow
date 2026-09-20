import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  activityEvidencePath,
  composeActivity,
  trackingPolicyPath,
  type ActivityInput,
} from "../../client/src/v2/activity";
import { DEFAULT_SCREENSHOT_POLICY } from "../../shared/schema";

/**
 * Activity from Activity Evidence (#191).
 * Seams: matchV2Route (flagged app chrome) and composeActivity over existing `/api/*`.
 * New BFF only for member-readable Tracking Policy. Do not assert hex or prototype DOM.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Activity.tsx"),
  "utf8",
);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function emptyActivity(overrides: Partial<ActivityInput> = {}): ActivityInput {
  return {
    now: new Date(2026, 8, 10, 15, 0, 0),
    workspaceName: "Harbor Co",
    currentUserId: "me",
    canReview: false,
    ownerName: "Sam Lee",
    requestedUserId: null,
    expandedId: null,
    policy: DEFAULT_SCREENSHOT_POLICY,
    projects: [],
    entries: [],
    users: [],
    evidence: [],
    ...overrides,
  };
}

describe("Activity routing (#191)", () => {
  it("shows a live Activity destination on /activity, not a placeholder", () => {
    const match = matchV2Route("/activity");
    expect(match.kind).toBe("activity");
    expect(navIdForPath("/activity")).toBe("activity");
    expect(breadcrumbFor("/activity", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "ACTIVITY",
    ]);
    expect(appSource).toContain("V2ActivityPage");
    expect(appSource).toMatch(/path="\/activity\/:tab\?"/);
    expect(appSource).not.toContain('data-testid="v2-placeholder"');
  });

  it("rewrites v1 screencasts URLs here and leaves Time Tracking on /time", () => {
    expect(matchV2Route("/time-tracking/screencasts")).toMatchObject({ kind: "activity", href: "/activity" });
    expect(matchV2Route("/time-tracking/screencasts/today")).toMatchObject({ kind: "activity", href: "/activity" });
    expect(matchV2Route("/time-tracking")).toMatchObject({ kind: "time", href: "/time" });
    expect(appSource).toMatch(/path="\/time-tracking\/screencasts"/);
  });
});

describe("Activity from Activity Evidence (#191)", () => {
  it("empty Workspace uses empty geometry and never shows sample names or productivity copy", () => {
    const page = composeActivity(emptyActivity());
    const blob = JSON.stringify(page);

    expect(page.empty).toBe(true);
    expect(page.rows).toEqual([]);
    expect(page.emptyCopy.toLowerCase()).toContain("activity evidence");
    expect(page.pagePrimary).toBe("case-ink");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
    expect(blob.toLowerCase()).not.toContain("productivity");
    expect(blob.toLowerCase()).not.toContain("score");
    expect(blob.toLowerCase()).not.toContain("ranking");
  });

  it("lists allowed Activity Evidence with Project, Task, and capture source provenance", () => {
    const page = composeActivity(
      emptyActivity({
        expandedId: "ev-1",
        projects: [
          {
            id: "prj-1",
            project: { name: "Harbour rebuild" },
            client: { name: "Harbour Shipping" },
          },
        ],
        entries: [{ id: "te-1", task: { name: "Reconcile import" } }],
        users: [{ id: "me", firstName: "Sam", lastName: "Lee", email: "sam@example.com" }],
        evidence: [
          {
            id: "ev-1",
            capturedAt: new Date(2026, 8, 10, 9, 12, 0),
            userId: "me",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "agent-screenshots/ev-1.webp",
          },
          {
            id: "ev-2",
            capturedAt: new Date(2026, 8, 9, 14, 30, 0),
            userId: "me",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "/objects/web-capture.png",
          },
        ],
      }),
    );

    expect(page.empty).toBe(false);
    expect(page.rows[0]).toMatchObject({
      id: "ev-1",
      when: "09:12",
      who: "Sam Lee",
      project: "Harbour Shipping · Harbour rebuild",
      task: "Reconcile import",
      source: "Desktop Device",
      expanded: true,
      imageSrc: "/api/time-tracking/screenshots/ev-1/image",
    });
    expect(page.rows[1]).toMatchObject({
      id: "ev-2",
      when: "YDA",
      source: "Web session",
      expanded: false,
    });
    expect(JSON.stringify(page)).not.toContain("Keystone");
  });

  it("shows Tracking Policy capture rules without scores", () => {
    const page = composeActivity(emptyActivity());
    expect(page.policyLines).toEqual([
      { label: "CAPTURE", value: "Every 3–5 min" },
      { label: "HOURS", value: "Any hours" },
      { label: "IDLE", value: "Prompt after 10 min" },
    ]);
    expect(page.policyFootnote.toLowerCase()).toContain("tracking policy");
    expect(JSON.stringify(page.policyLines).toLowerCase()).not.toContain("productivity");
  });

  it("an Owner reviewing the Workspace sees every Member's evidence", () => {
    const page = composeActivity(
      emptyActivity({
        canReview: true,
        users: [
          { id: "me", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          { id: "other", firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
        ],
        evidence: [
          {
            id: "mine",
            capturedAt: new Date(2026, 8, 10, 10, 0, 0),
            userId: "me",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "shot-me",
          },
          {
            id: "theirs",
            capturedAt: new Date(2026, 8, 10, 11, 0, 0),
            userId: "other",
            crmProjectId: "prj-1",
            timeEntryId: "te-2",
            storageKey: "shot-them",
          },
        ],
      }),
    );
    expect(page.rows.map((row) => row.id)).toEqual(["mine", "theirs"]);
    expect(page.refusal).toBeNull();
  });

  it("Members without review Capability see only their own evidence and refusals name the Capability", () => {
    const page = composeActivity(
      emptyActivity({
        canReview: false,
        requestedUserId: "other",
        users: [
          { id: "me", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          { id: "other", firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
        ],
        evidence: [
          {
            id: "mine",
            capturedAt: new Date(2026, 8, 10, 10, 0, 0),
            userId: "me",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "shot-me",
          },
          {
            id: "theirs",
            capturedAt: new Date(2026, 8, 10, 11, 0, 0),
            userId: "other",
            crmProjectId: "prj-1",
            timeEntryId: "te-2",
            storageKey: "shot-them",
          },
        ],
      }),
    );

    expect(page.rows.map((row) => row.id)).toEqual(["mine"]);
    expect(page.refusal).toBe(
      "You do not have the Review Activity Evidence Capability. Sam Lee (Owner) can grant it.",
    );
    expect(page.refusal?.toLowerCase()).not.toContain("permission denied");
  });

  it("asks the BFF for screenshots and Tracking Policy it already supports", () => {
    const path = activityEvidencePath({
      startDate: new Date(Date.UTC(2026, 8, 10, 0, 0, 0)),
      endDate: new Date(Date.UTC(2026, 8, 10, 23, 59, 59, 999)),
      crmProjectId: "prj-live",
      userId: "user-2",
    });
    const decoded = decodeURIComponent(path);
    expect(path.startsWith("/api/time-tracking/screenshots?")).toBe(true);
    expect(decoded).toContain("2026-09-10T00:00:00.000Z");
    expect(decoded).toContain("crmProjectId=prj-live");
    expect(decoded).toContain("userId=user-2");
    expect(trackingPolicyPath()).toBe("/api/time-tracking/tracking-policy");
    expect(pageSource).toContain("/api/time-tracking/screenshots");
    expect(pageSource).toContain("/api/time-tracking/tracking-policy");
    expect(pageSource).toContain("canManageAdministration");
    expect(pageSource).not.toMatch(/user\?\.role === ["']admin["']/);
    expect(pageSource).not.toMatch(/productivity/i);
    expect(pageSource).toContain("Open");
  });

  it("keeps Open on the stacked Activity Evidence row", () => {
    const stacked = pageSource.match(/layout\.stackedRegister \? \(([\s\S]*?)\) : \(/)?.[1] ?? "";
    expect(stacked).toContain("df-project-mobile");
    expect(stacked).toContain("Open");
  });
});

describe("Activity Evidence row expand motion (#191)", () => {
  it("grows detail from the row and keeps reduced motion on opacity", () => {
    const expand = motionForSurface("activity-evidence-expand");
    expect(expand.enterExit).toBe("standard");
    expect(expand.movement).toBe("allowed");

    const reduced = motionForSurface("activity-evidence-expand", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-activity-expand[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-activity-expand[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule('.df-activity-stream')).toMatch(/animation:\s*none/);
    expect(pageSource).not.toMatch(/autoplay/i);
    expect(reducedMotionCss()).toMatch(
      /\.df-activity-expand\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
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
