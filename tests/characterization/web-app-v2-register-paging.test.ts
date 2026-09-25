import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composePaging, DEFAULT_REGISTER_PAGE_SIZE } from "../../client/src/v2/paging";
import {
  clearProjectFilters,
  composeProjectRegister,
  projectDueRange,
  projectFilterLabels,
  projectRegisterPath,
  readProjectFilters,
  writeProjectFilters,
} from "../../client/src/v2/projects";

/**
 * Register filters and paging (#275): the server narrows and pages, the URL
 * carries both, and an emptied register says which filter emptied it.
 */

const v2Dir = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");
const NOW = new Date(2026, 8, 25, 15, 0, 0);

describe("register paging", () => {
  it("labels the rows on show, and the bare count when one page holds them", () => {
    const noun = { one: "PROJECT", many: "PROJECTS" };
    expect(composePaging({ page: 2, pageSize: 50, total: 132, noun })).toMatchObject({
      page: 2,
      pageCount: 3,
      label: "51–100 OF 132 PROJECTS",
      hasPrevious: true,
      hasNext: true,
      showControls: true,
    });
    expect(composePaging({ page: 1, pageSize: 50, total: 1, noun })).toMatchObject({
      label: "1 PROJECT",
      hasNext: false,
      showControls: false,
    });
  });

  it("clamps a page past the end to the last one", () => {
    const paging = composePaging({ page: 9, pageSize: 25, total: 30, noun: { one: "X", many: "XS" } });
    expect(paging.page).toBe(2);
    expect(paging.label).toBe("26–30 OF 30 XS");
  });
});

describe("Projects filters in the URL", () => {
  it("reads defaults from a bare URL and writes nothing back for them", () => {
    const filters = readProjectFilters("");
    expect(filters).toMatchObject({ q: "", status: "all", client: "all", page: 1, pageSize: DEFAULT_REGISTER_PAGE_SIZE });
    expect(writeProjectFilters("", filters)).toBe("");
  });

  it("round-trips every filter and the page, keeping the view", () => {
    const search = "?view=board&status=active&client=c1&lead=u1&tag=t1&type=monthly&due=overdue&q=pier&page=3&size=25";
    const filters = readProjectFilters(search);
    expect(filters).toEqual({
      q: "pier",
      status: "active",
      client: "c1",
      lead: "u1",
      tag: "t1",
      type: "monthly",
      due: "overdue",
      page: 3,
      pageSize: 25,
    });
    const written = new URLSearchParams(writeProjectFilters(search, filters));
    expect(written.get("view")).toBe("board");
    expect(readProjectFilters(`?${written.toString()}`)).toEqual(filters);
  });

  it("ignores a page size it does not offer", () => {
    expect(readProjectFilters("?size=7").pageSize).toBe(DEFAULT_REGISTER_PAGE_SIZE);
  });

  it("clearing keeps the page size and goes back to page one", () => {
    const cleared = clearProjectFilters(readProjectFilters("?status=active&q=x&page=4&size=100"));
    expect(cleared).toMatchObject({ q: "", status: "all", page: 1, pageSize: 100 });
  });
});

describe("the server page the register asks for", () => {
  it("scopes to what the reader may see and maps each filter onto the route", () => {
    const path = projectRegisterPath(
      readProjectFilters("?status=active&client=c1&lead=u1&tag=t1&type=internal&due=none&q=%20pier%20&page=2"),
      NOW,
    );
    const params = new URL(path, "http://x").searchParams;
    expect(path.startsWith("/api/crm/projects?")).toBe(true);
    expect(Object.fromEntries(params)).toEqual({
      scope: "visible",
      page: "2",
      pageSize: "50",
      search: "pier",
      projectStatus: "active",
      clientId: "c1",
      leadId: "u1",
      tagId: "t1",
      projectType: "internal",
      due: "none",
    });
  });

  it("turns due presets into local-day bounds", () => {
    expect(projectDueRange("overdue", NOW)).toEqual({ to: new Date(2026, 8, 24, 23, 59, 59, 999) });
    expect(projectDueRange("next_7", NOW)).toEqual({
      from: new Date(2026, 8, 25),
      to: new Date(2026, 9, 1, 23, 59, 59, 999),
    });
    expect(projectDueRange("this_month", NOW)).toEqual({
      from: new Date(2026, 8, 1),
      to: new Date(2026, 8, 30, 23, 59, 59, 999),
    });
    expect(projectDueRange("next_month", NOW)).toEqual({
      from: new Date(2026, 9, 1),
      to: new Date(2026, 9, 31, 23, 59, 59, 999),
    });
    expect(projectDueRange("none", NOW)).toEqual({ none: true });
    expect(projectDueRange("all", NOW)).toBeNull();
  });
});

describe("an emptied register says why", () => {
  it("names each filter in force and offers to clear them", () => {
    const filters = readProjectFilters("?status=on_hold&client=c1&q=pier");
    const activeFilters = projectFilterLabels(filters, {
      clients: new Map([["c1", "Acme"]]),
      leads: new Map(),
      tags: new Map(),
    });
    const register = composeProjectRegister({
      workspaceName: "Harbor Co",
      projects: [],
      filterQuery: "",
      statusFilter: "all",
      tagFilter: "all",
      activeFilters,
      selectedId: null,
    });
    expect(register.emptyCopy).toBe("No Projects match “pier” · STATUS ON HOLD · CLIENT Acme.");
    expect(register.filtered).toBe(true);
  });

  it("does not offer to clear a Workspace that simply has no Projects", () => {
    const register = composeProjectRegister({
      workspaceName: "Harbor Co",
      projects: [],
      filterQuery: "",
      statusFilter: "all",
      tagFilter: "all",
      activeFilters: [],
      selectedId: null,
    });
    expect(register.emptyCopy).toBe("No Projects in this Workspace yet.");
    expect(register.filtered).toBe(false);
  });
});

describe("the Projects screen", () => {
  const src = readFileSync(join(v2Dir, "V2Projects.tsx"), "utf8");

  it("pages the register from the server rather than loading every Project", () => {
    expect(src).toContain("projectRegisterPath(filters, now)");
    expect(src).not.toContain("loadProjectList(projectsAllPath())");
    expect(src).toContain("<V2RegisterPager");
  });

  it("draws every filter as a V2FilterSelect chip", () => {
    for (const label of ["STATUS", "CLIENT", "LEAD", "TAG", "TYPE", "DUE"]) {
      expect(src).toContain(`label="${label}"`);
    }
  });
});
