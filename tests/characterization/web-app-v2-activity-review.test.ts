import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_FILTERS_DEFAULT,
  activityEvidencePath,
  activityPaging,
  batchFailureCopy,
  captureCountCopy,
  clearActivityFacets,
  composeActivity,
  composeActivityGallery,
  evidenceRangeProblem,
  hasActivityFacets,
  readActivityFilters,
  writeActivityFilters,
  type ActivityEvidenceInput,
  type ActivityFilters,
} from "../../client/src/v2/activity";
import { DEFAULT_SCREENSHOT_POLICY } from "../../shared/schema";

/**
 * The Activity review, client half (F76 to F79, F81).
 * Seams: the pure helpers of activity.ts, and the source shape of V2Activity /
 * V2DateField / V2CaptureImage / tokens.css.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const source = read("client/src/v2/V2Activity.tsx");
const model = read("client/src/v2/activity.ts");
const timeSource = read("client/src/v2/V2Time.tsx");
const dateField = read("client/src/v2/V2DateField.tsx");
const image = read("client/src/v2/V2CaptureImage.tsx");
const css = read("client/src/v2/tokens.css");

const NOW = new Date(2026, 10, 24, 15, 0, 0);

function shot(id: string, overrides: Partial<ActivityEvidenceInput> = {}): ActivityEvidenceInput {
  return {
    id,
    capturedAt: new Date(2026, 10, 24, 14, 52, 0),
    userId: "me",
    crmProjectId: "prj-1",
    timeEntryId: "te-1",
    source: "device",
    user: null,
    projectName: null,
    clientName: null,
    taskName: null,
    ...overrides,
  };
}

function whenOf(capturedAt: Date): string {
  const page = composeActivity({
    now: NOW,
    currentUserId: "me",
    canReview: false,
    ownerName: null,
    requestedUserId: null,
    expandedId: null,
    policy: DEFAULT_SCREENSHOT_POLICY,
    evidence: [shot("a", { capturedAt })],
  });
  return page.rows[0].when;
}

describe("a capture always says when (F78)", () => {
  it.each([
    ["today", new Date(2026, 10, 24, 14, 52), "14:52"],
    ["yesterday", new Date(2026, 10, 23, 14, 52), "Yesterday, 14:52"],
    ["this year", new Date(2026, 10, 17, 14, 52), "17 Nov, 14:52"],
    ["another year", new Date(2025, 10, 17, 14, 52), "17 Nov 2025, 14:52"],
  ])("%s", (_name, capturedAt, expected) => {
    expect(whenOf(capturedAt)).toBe(expected);
  });

  it("takes the Task, Project and Member from the capture, and has no second lookup", () => {
    const page = composeActivity({
      now: NOW,
      currentUserId: "me",
      canReview: true,
      ownerName: null,
      requestedUserId: null,
      expandedId: null,
      policy: null,
      evidence: [
        shot("a", {
          user: { id: "me", firstName: "Sam", lastName: "Lee" },
          projectName: "Rebuild",
          clientName: "Harbour",
          taskName: "Reconcile",
        }),
        shot("b", { source: "web" }),
      ],
    });
    expect(page.rows[0]).toMatchObject({ who: "Sam Lee", project: "Harbour · Rebuild", task: "Reconcile", source: "Desktop Device" });
    expect(page.rows[1]).toMatchObject({ who: "Member", project: "Untitled Project", task: "-", source: "Web session" });
    expect(source).not.toContain("/api/time-tracking/entries");
    expect(source).not.toContain("timeEntriesPath");
  });
});

describe("the whole set is counted, with its word (F76)", () => {
  it("says the total, not the page", () => {
    expect(captureCountCopy(107)).toBe("107 captures");
    expect(captureCountCopy(1)).toBe("1 capture");
    expect(captureCountCopy(0)).toBe("0 captures");
    expect(composeActivityGallery({ ...galleryInput(), total: 107 }).countCopy).toBe("107 captures");
    expect(source).toContain("captureCountCopy(total)");
  });

  it("pages both tabs with the registers' pager, a hyphen in its range", () => {
    expect(activityPaging({ page: 2, pageSize: 50, total: 107 }).label).toBe("51-100 of 107 captures");
    expect(activityPaging({ page: 1, pageSize: 50, total: 1 }).label).toBe("1 capture");
    expect(source).toContain("<V2RegisterPager");
    expect(source).toContain("pager={showPager ? pager : null}");
    expect(source).toContain("{showPager ? pager : null}");
    expect(source).toContain("limit: filters.pageSize");
    expect(source).toContain("offset: (filters.page - 1) * filters.pageSize");
  });

  it("offers the batch only once something is selected, and selects the page", () => {
    const some = composeActivityGallery({ ...galleryInput(), evidence: [shot("a"), shot("b")], selectedIds: ["a"] });
    expect(some.canBatch).toBe(true);
    expect(composeActivityGallery({ ...galleryInput(), evidence: [shot("a")] }).canBatch).toBe(false);
    expect(source).toContain('"Select this page"');
    expect(source).toContain('"Clear selection"');
    expect(source).not.toContain('"Select all"');
    expect(source).toMatch(/\{gallery\.canBatch \? \(\s*<Button variant="default"/);
  });

  it("reads an image when its row first opens, and keeps it lazy", () => {
    expect(source).toContain("openedRows.has(row.id) ? <V2CaptureImage");
    expect(source).toContain("lazy />");
    expect(image).toContain('loading={lazy ? "lazy" : undefined}');
    expect(source).not.toMatch(/<img/);
  });
});

function galleryInput() {
  return {
    now: NOW,
    currentUserId: "me",
    canReview: true,
    lowActivityOnly: false,
    similarOnly: false,
    selectedIds: [],
    expandedId: null,
    total: 0,
    offset: 0,
    evidence: [] as ActivityEvidenceInput[],
  };
}

describe("filters in the address (F77)", () => {
  const filters: ActivityFilters = {
    range: "custom",
    day: "",
    from: "2026-11-01",
    to: "2026-11-20",
    project: "p1",
    member: "u1",
    low: true,
    similar: true,
    archived: true,
    page: 3,
    pageSize: 25,
  };

  it("round-trips the filters and leaves the defaults out", () => {
    expect(readActivityFilters(writeActivityFilters("", filters))).toEqual(filters);
    const day = { ...ACTIVITY_FILTERS_DEFAULT, range: "day" as const, day: "2026-11-17" };
    expect(readActivityFilters(writeActivityFilters("", day))).toEqual(day);
    expect(writeActivityFilters("?range=week&page=2&low=1&x=1", ACTIVITY_FILTERS_DEFAULT)).toBe("?x=1");
  });

  it("reads an unknown value as its default", () => {
    expect(readActivityFilters("?range=year&day=soon&from=2026-13-40&low=yes&page=-2&size=7")).toEqual(
      ACTIVITY_FILTERS_DEFAULT,
    );
  });

  it("keeps the dates of the range in use only", () => {
    expect(writeActivityFilters("", { ...filters, range: "week" })).not.toMatch(/from=|to=|day=/);
  });

  it("reads an old crmProjectId link as the Project over All time, and rewrites it", () => {
    expect(readActivityFilters("?crmProjectId=prj-9")).toMatchObject({ project: "prj-9", range: "all" });
    expect(readActivityFilters("?crmProjectId=prj-9&range=week")).toMatchObject({ project: "prj-9", range: "week" });
    expect(writeActivityFilters("?crmProjectId=prj-9", { ...ACTIVITY_FILTERS_DEFAULT, project: "prj-9", range: "all" })).toBe(
      "?range=all&project=prj-9",
    );
    expect(source).toContain('has("crmProjectId")');
  });

  it("changes the address by navigating, so Back works, and keeps it across the tabs", () => {
    expect(source).toContain("navigate(`${activityTabHref(tab)}${writeActivityFilters(search, next)}`, { replace });");
    expect(source).toContain("href={`${item.href}${carried}`}");
    expect(source).not.toMatch(/useState\(\(\) =>\s*new URLSearchParams/);
  });

  it("goes back to page 1 whenever a filter changes", () => {
    for (const name of ["range", "project", "member", "low", "similar"]) {
      expect(source).toMatch(new RegExp(`setFilters\\(\\{ \\.\\.\\.filters, ${name}[^}]*page: 1 \\}\\)`));
    }
  });

  it("moves a page past the end to the last page, once the page itself has arrived", () => {
    expect(source).toContain("if (!data || isPlaceholderData || total === 0 || filters.page <= paging.pageCount) return;");
    expect(source).toContain("setFilters({ ...filters, page: paging.pageCount }, true)");
  });

  it("asks for nothing while a day or span is not chosen", () => {
    expect(evidenceRangeProblem("day", {})).toBe("Choose a day");
    expect(evidenceRangeProblem("day", { day: "2026-11-17" })).toBeNull();
    expect(evidenceRangeProblem("custom", { from: "2026-11-01" })).toBe("Choose both dates");
    expect(evidenceRangeProblem("custom", { to: "2026-11-01" })).toBe("Choose both dates");
    expect(evidenceRangeProblem("custom", { from: "2026-11-20", to: "2026-11-01" })).toBe(
      "The end date is before the start date",
    );
    expect(evidenceRangeProblem("custom", { from: "2026-11-01", to: "2026-11-01" })).toBeNull();
    expect(evidenceRangeProblem("today", {})).toBeNull();
    expect(source).toContain("enabled: ready && !rangeProblem");
    expect(source).toContain("const data = rangeProblem ? undefined : response;");
  });

  it("clears Project, Member, Low activity, Similar and archived, and keeps the range", () => {
    const cleared = clearActivityFacets(filters);
    expect(cleared).toMatchObject({ project: "all", member: "all", low: false, similar: false, archived: false, page: 1 });
    expect(cleared).toMatchObject({ range: "custom", from: "2026-11-01", to: "2026-11-20" });
    expect(hasActivityFacets(ACTIVITY_FILTERS_DEFAULT)).toBe(false);
    expect(hasActivityFacets({ ...ACTIVITY_FILTERS_DEFAULT, range: "all" })).toBe(false);
    for (const name of ["project", "member", "low", "similar", "archived"] as const) {
      expect(hasActivityFacets({ ...ACTIVITY_FILTERS_DEFAULT, [name]: name === "project" || name === "member" ? "x" : true })).toBe(true);
    }
    expect(source).toContain("{hasActivityFacets(filters) ? (");
    expect(source).not.toContain('setRange("today")');
  });

  it("filters Projects on the one picker, like the Time register", () => {
    expect(source).toContain("<V2ProjectPicker");
    expect(source).toContain("filterProjectOptions(activityProjects.list ?? [])");
    expect(source).toContain('active={filters.project !== "all"}');
  });

  it("asks the server for the same page on both tabs, lenses included", () => {
    const path = activityEvidencePath({ limit: 50, offset: 50, lowActivity: true, similar: true });
    expect(path).toBe("/api/time-tracking/screenshots?limit=50&offset=50&lowActivity=1&similar=1");
  });
});

describe("a failed or slow load keeps the screen (F79)", () => {
  it("keeps the previous page while the next loads, and re-reads on each visit", () => {
    expect(source).toContain("placeholderData: keepPreviousData");
    expect(source.match(/staleTime: 0/g)).toHaveLength(2);
    expect(source).toContain("aria-busy={isPlaceholderData && !rangeProblem}");
    expect(source).toContain("busy={isPlaceholderData && !rangeProblem}");
    expect(source).toContain("aria-busy={busy}");
    // The skeleton is for the first load only.
    expect(source).toContain("if (!ready || isLoading) {");
  });

  it("shows the same failed state as Time, inside the card, and says a failed refresh once", () => {
    expect(source).toContain('testId="v2-activity-load-failed"');
    expect(source).toContain("<V2LoadFailed");
    expect(source).toContain("const loadFailed = isError && !data && !rangeProblem;");
    expect(source).toContain('useRefreshFailure(isError && Boolean(data), "Activity Evidence could not be refreshed.", "v2-activity-refresh-failed")');
  });

  it("says a failed download, and counts a batch's failures once", () => {
    expect(source).toContain('fallback: "Could not download the capture"');
    expect(batchFailureCopy(2, 5)).toBe("2 of 5 captures could not be downloaded");
    expect(batchFailureCopy(0, 5)).toBeNull();
    expect(source).toContain("if (!(await saveCapture(tile))) failed += 1;");
  });

  it("puts a quiet placeholder in the frame of an image that cannot be read", () => {
    expect(image).toContain("onError={() => setFailedSrc(src)}");
    expect(image).toContain("Image unavailable");
    expect(source.match(/<V2CaptureImage/g)).toHaveLength(3);
    expect(css).toMatch(/\.df-capture-missing \{[^}]*aspect-ratio: 16 \/ 10/);
  });

  it("rolls Today over at midnight, from the one shared hook", () => {
    expect(read("client/src/v2/useToday.ts")).toContain("export function useToday");
    expect(source).toContain('import { useToday } from "./useToday";');
    expect(timeSource).toContain('import { useToday } from "./useToday";');
    expect(timeSource).not.toContain("function useToday");
  });
});

describe("the page, polished (F81)", () => {
  it("draws a filter active only when it differs from its default", () => {
    expect(source).toContain("active={filters.range !== ACTIVITY_FILTERS_DEFAULT.range}");
    expect(source).not.toContain('active={range === "today"}');
  });

  it("lines the Tracking Policy up in one compact row, and notes Members only", () => {
    expect(source).toContain('<dl className="df-policy-lineup">');
    expect(source).not.toMatch(/df-activity-policy">\s*\{page\.policyLines\.map\(\(line\) => \(\s*<div key=\{line\.label\} className="df-kv"/);
    expect(css).toMatch(/\.df-policy-lineup \{[^}]*flex-wrap: wrap/);
    expect(source).toContain("{page.policyFootnote ? (");
  });

  it("puts each label directly above its value in a row's detail and the viewer", () => {
    expect(source).not.toContain('className="df-kv"');
    expect(source.match(/className="df-detail-pair"/g)?.length).toBeGreaterThanOrEqual(9);
    expect(css).toMatch(/\.df-detail-pair \{[^}]*flex-direction: column/);
  });

  it("writes To and ranges the way the other screens do", () => {
    expect(source).toContain('<span className="df-meta">To</span>');
    expect(source).not.toContain(">TO<");
    const shown = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(shown(model)).not.toMatch(/[–—]/);
    expect(shown(source)).not.toMatch(/[–—]/);
    expect(model).toContain("`Every ${policy.captureIntervalMinMin}-${policy.captureIntervalMaxMin} min`");
  });

  it("builds the checkboxes on the shadcn Checkbox and the dates on Popover and Calendar", () => {
    expect(source).toContain('from "@/components/ui/checkbox"');
    expect(source).not.toContain('type="checkbox"');
    expect(source).not.toContain("<input");
    expect(source.match(/<Checkbox/g)).toHaveLength(2);
    expect(source).toContain("<label htmlFor={id}>{label}</label>");
    expect(source.match(/<V2DateField/g)).toHaveLength(3);
    expect(source).toContain("max={filters.to || undefined}");
    expect(source).toContain("min={filters.from || undefined}");
    expect(source.match(/placeholder="Choose a day"/g)).toHaveLength(3);
    expect(dateField).toContain("disabled={[...(earliest");
    expect(dateField).toContain('placeholder = "Not set"');
  });

  it("gives the rows the other registers' text and separators", () => {
    expect(source).toContain('<span className="df-time-task">{row.task}</span>');
    expect(source).toContain('<span className="df-time-person">{row.who}</span>');
    expect(source).toContain('className="df-activity-item"');
    expect(css).toMatch(/\.df-activity-item \{[^}]*border-bottom: 1px solid var\(--df-divider-light\)/);
  });

  it("offers Delete to whoever may review, with no address in the code", () => {
    expect(model).toContain("return input.canReview;");
    expect(source).not.toMatch(/@[a-z]+\.[a-z]+/);
  });

  it("takes every colour of the new rules from the tokens, so dark mode follows", () => {
    for (const selector of [".df-capture-missing", ".df-detail-pair", ".df-row-chevron", ".df-activity-item"]) {
      const block = css.match(new RegExp(`${selector.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
      expect(block, selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
    }
  });
});
