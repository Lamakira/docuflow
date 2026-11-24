import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupLibraryRows } from "../../client/src/v2/library";
import {
  composeProjectDocumentation,
  linkConsequence,
  offeredProject,
  type ProjectDocumentationDocument,
  type ProjectDocumentationInput,
  type ProjectDocumentationProject,
} from "../../client/src/v2/projectDocumentation";

/**
 * The Project Documentation review, register half (F62, F63, F64, F65).
 * Seams: composeProjectDocumentation and its helpers, and the source shape of
 * V2ProjectDocumentation / V2Library / V2LinkDocumentationDialog / tokens.css.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const pageSource = read("client/src/v2/V2ProjectDocumentation.tsx");
const composeSource = read("client/src/v2/projectDocumentation.ts");
const registerSource = read("client/src/v2/V2Library.tsx");
const documentsSource = read("client/src/v2/V2Documents.tsx");
const dialogSource = read("client/src/v2/V2LinkDocumentationDialog.tsx");
const css = read("client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

const project = (overrides: Partial<ProjectDocumentationProject> = {}): ProjectDocumentationProject => ({
  id: "p1",
  documentProjectId: "p1",
  name: "Atlas warehouse rollout",
  visible: true,
  documentationEnabled: true,
  ...overrides,
});

const page = (id: string, title: string, parentId: string | null = null): ProjectDocumentationDocument => ({
  id,
  title,
  projectId: "p1",
  parentId,
});

function compose(overrides: Partial<ProjectDocumentationInput> = {}) {
  return composeProjectDocumentation({
    now: new Date(2026, 10, 24, 12, 0, 0),
    workspaceName: "Harbor Co",
    projects: [project()],
    documents: [],
    expandedProjectIds: [],
    selectedProjectId: null,
    filterQuery: "",
    ...overrides,
  });
}

const placed = (model: ReturnType<typeof compose>) => model.rows.map((row) => [row.id, row.depth]);

describe("search (F62)", () => {
  const documents = [page("d1", "WMS notes"), page("d2", "Runbook")];
  const files = [{ id: "file-1", name: "Site plan", projectId: "p1" }];

  it("lists everything a Project holds when its own name matches", () => {
    const model = compose({ documents, files, filterQuery: "ATLAS", expandedProjectIds: ["p1"] });
    expect(model.rows.map((row) => row.id)).toEqual(["p1", "d1", "d2", "file-1"]);
  });

  it("lists only the matches when the name does not match, Files among them", () => {
    expect(compose({ documents, files, filterQuery: "runbook" }).rows.map((row) => row.id)).toEqual(["p1", "d2"]);
    expect(compose({ documents, files, filterQuery: "plan" }).rows.map((row) => row.id)).toEqual(["p1", "file-1"]);
    expect(compose({ documents, files, filterQuery: "runbook" }).rows[0].expanded).toBe(true);
  });

  it("shows everything, opened, when both the Project and a child match", () => {
    const model = compose({ documents: [page("d1", "Atlas notes"), page("d2", "Runbook")], filterQuery: "atlas" });
    expect(model.rows.map((row) => row.id)).toEqual(["p1", "d1", "d2"]);
    expect(model.rows[0].expanded).toBe(true);
  });
});

describe("pages under pages (F65)", () => {
  it("lists a page under its parent, siblings in the order received", () => {
    const model = compose({
      documents: [page("b", "B"), page("a2", "A2", "a"), page("a", "A"), page("a1", "A1", "a"), page("a2x", "A2x", "a2")],
      expandedProjectIds: ["p1"],
    });
    expect(placed(model)).toEqual([["p1", 0], ["b", 1], ["a", 1], ["a2", 2], ["a2x", 3], ["a1", 2]]);
    expect(model.rows.find((row) => row.id === "a2x")?.path).toBe("Atlas warehouse rollout / A / A2 /");
    const [group] = groupLibraryRows(model.rows);
    expect(group.kind === "folder" && group.children).toHaveLength(5);
  });

  it("puts a page whose parent is missing at the Project's root", () => {
    expect(placed(compose({ documents: [page("a", "A", "gone"), page("b", "B", "b")] }))).toEqual([["p1", 0], ["a", 1], ["b", 1]]);
  });

  it("neither hangs on a cycle nor loses its pages", () => {
    const model = compose({ documents: [page("ok", "OK"), page("a", "A", "b"), page("b", "B", "a")] });
    expect(placed(model)).toEqual([["p1", 0], ["ok", 1], ["a", 1], ["b", 2]]);
  });

  it("keeps a match's ancestors while searching, and drops the rest", () => {
    const model = compose({
      documents: [page("a", "A"), page("a1", "Middle", "a"), page("a2", "Needle", "a1"), page("c", "C")],
      filterQuery: "needle",
    });
    expect(placed(model)).toEqual([["p1", 0], ["a", 1], ["a1", 2], ["a2", 3]]);
  });
});

describe("the columns (F65)", () => {
  it("shows who added a page or File, and the Project's owner on its row", () => {
    const model = compose({
      projects: [project({ owner: { firstName: "Ada", lastName: "Lovelace" } })],
      documents: [{ ...page("d1", "Notes"), createdBy: { firstName: "Grace", lastName: "Hopper" } }, page("d2", "Plan")],
    });
    expect(model.rows.map((row) => row.editor)).toEqual(["Ada Lovelace", "Grace Hopper", "-"]);
    expect(compose().rows[0].editor).toBe("-");
    expect(pageSource).not.toContain("/api/users");
    expect(registerSource).toContain("<span>Added by</span>");
    expect(registerSource + pageSource).not.toContain("personHeading");
  });

  it("names the Client in plain text on Project rows, and nothing on the rows under them", () => {
    const access = (overrides: Partial<ProjectDocumentationProject>) =>
      compose({ projects: [project(overrides)], documents: [page("d1", "Notes")] }).rows.map((row) => row.access);
    expect(access({ clientName: "Atlas Ltd" })).toEqual(["Atlas Ltd", ""]);
    expect(access({ clientName: null })).toEqual(["Internal", ""]);
    expect(access({ clientName: null, isDocumentationOnly: true })).toEqual(["Documentation only", ""]);
    expect(pageSource).toMatch(/accessHeading="Client"\s*plainAccess/);
    expect(documentsSource).not.toMatch(/accessHeading|plainAccess|folderActions/);
    expect(registerSource).toContain('accessHeading = "Access"');
  });

  it("adds the year to a date outside the current year, from the one formatWhen", () => {
    const model = compose({
      documents: [
        { ...page("old", "Old"), updatedAt: new Date(2025, 11, 3, 9) },
        { ...page("new", "New"), updatedAt: new Date(2026, 10, 3, 9) },
      ],
    });
    expect(model.rows.map((row) => row.updated)).toEqual(["3 Nov", "3 Dec 2025", "3 Nov"]);
    expect(composeSource).not.toContain("function formatWhen");
  });
});

describe("only the selected row looks selected (F65)", () => {
  it("draws the look from data-selected alone", () => {
    expect(css).toMatch(/\.df-library-row\[data-selected="true"\]\s*\{[^}]*box-shadow:\s*inset 2px 0 0/);
    expect(css).not.toContain('.df-library-row[data-expanded="true"]');
    expect(registerSource).toContain('data-selected={group.folder.selected ? "true" : "false"}');
  });
});

describe("a failed load (F63)", () => {
  it("re-reads on every visit", () => {
    expect(pageSource).toMatch(/queryFn: \(\) => loadDocumentationPage\(registerPath\),\s*staleTime: 0/);
  });

  it("says so, with Try again, no create action, and no count", () => {
    const start = pageSource.indexOf("if (isError && !data) {");
    const failed = pageSource.slice(start, pageSource.indexOf('<div className="df-library" data-testid', start));
    expect(failed).toContain("Project Documentation could not be loaded.");
    expect(failed).toContain("onClick={() => refetch()}");
    expect(failed).not.toMatch(/openCreate|V2RegisterPager|library\./);
  });

  it("keeps the list when a refresh fails, and notifies", () => {
    expect(pageSource).toMatch(/if \(isError && data\) \{\s*notify\.error\(null, \{[\s\S]*?id: "v2-project-documentation-refresh-failed"/);
    expect(pageSource).toContain("[isError, data]);");
  });
});

describe("creating (F64, F65)", () => {
  it("takes a Project only where the list offers it", () => {
    const options = [{ value: "p1" }];
    expect(offeredProject(options, "p1")).toBe("p1");
    expect(offeredProject(options, "p2")).toBeNull();
    expect(offeredProject(options, null)).toBeNull();
    expect(pageSource).toContain("setTargetProjectId(offeredProject(offeredProjects, projectId) ?? V2_SELECT_NONE)");
    expect(pageSource).toContain("const selectedDocumentProjectId = offeredProject(offeredProjects, targetProjectId)");
  });

  it("describes a documentation-only Project without implementation talk, and opens the one created", () => {
    expect(pageSource).toContain("Holds Project Documents on their own, outside Projects. You can link it to a Project later.");
    expect(pageSource).toContain('"New documentation Project"');
    expect(pageSource).not.toMatch(/row in Projects|never enters the pipeline/);
    expect(pageSource).toMatch(/created\?\.project\?\.id;[\s\S]*?setExpandedProjectIds[\s\S]*?setSelectedProjectId\(createdId\)/);
  });

  it("limits names to what the server stores", () => {
    expect(pageSource).toContain("MAX_PROJECT_NAME = 255");
    expect(pageSource).toContain("MAX_DOCUMENT_NAME = 500");
    expect(pageSource).toContain('maxLength={createMode === "project" ? MAX_PROJECT_NAME : MAX_DOCUMENT_NAME}');
  });
});

describe("the actions on an open Project (F65)", () => {
  it("sit in the expanded area, outside the row's button", () => {
    expect(registerSource).toMatch(/<\/button>\s*<div\s*className="df-accordion"[\s\S]*?\{open \? folderActions\?\.\(group\.folder\) : null\}/);
    const button = registerSource.slice(registerSource.indexOf("<button"), registerSource.indexOf("</button>"));
    expect(button).not.toContain("folderActions");
  });

  it("lead to the Project, add a Document to it, and link a documentation-only one", () => {
    const actions = pageSource.slice(pageSource.indexOf("function projectActions"), pageSource.indexOf("const filterBar"));
    expect(actions).toContain("projectHref(entry.crmProjectId)");
    expect(actions).toContain("`${href}/documents`");
    expect(actions).toMatch(/entry\.documentationEnabled \? \(\s*<Button[^>]*onClick=\{\(\) => openCreate\("document", row\.id\)\}/);
    expect(actions).toContain("entry.isDocumentationOnly && canManage ? (");
    expect(actions).toContain("No Project Documents yet.");
  });
});

describe("Link to a Project (F65)", () => {
  it("says what moves, who will see it, and that it cannot be undone", () => {
    expect(linkConsequence({ name: "Wiki", documents: 2, files: 1, target: "Atlas" })).toBe(
      "The 3 Documents and Files in Wiki move to Atlas's Documentation. Everyone who can see Atlas will see them. Wiki is then left with documentation off. You can't undo this.",
    );
    expect(linkConsequence({ name: "Wiki", documents: 0, files: 1, target: "Atlas" })).toContain("The File in Wiki moves to");
    expect(linkConsequence({ name: "Wiki", documents: 0, files: 0, target: "Atlas" })).toContain("no Documents or Files to move");
    expect(dialogSource).toMatch(/\{target \? \(\s*<p /);
  });

  it("offers delivery Projects only, in a searchable shadcn list", () => {
    expect(dialogSource).toContain('kind: "delivery"');
    expect(dialogSource).toContain('from "@/components/ui/command"');
    expect(dialogSource).toContain("<Popover modal");
    expect(dialogSource).toContain("project.id !== source.crmProjectId");
  });

  it("posts the target and re-reads both Projects' lists, Files included", () => {
    expect(dialogSource).toContain("/link-documentation`");
    for (const key of ["/api/projects/documentable", "/api/crm/projects", "/api/projects", "/api/documents"]) {
      expect(dialogSource).toContain(`invalidateQueries({ queryKey: ["${key}"] })`);
    }
    expect(dialogSource).toContain('path.startsWith("/api/projects/")');
    expect(dialogSource).toContain("notify.success(`Documents moved to ${chosen.name}`)");
    expect(dialogSource).toMatch(/if \(readOnlyRefusal\) \{\s*setRefusal\(readOnlyRefusal\);\s*return;/);
  });
});
