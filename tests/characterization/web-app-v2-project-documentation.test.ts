import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeSearch } from "../../client/src/v2/chrome";
import { composeDocumentEditor, type DocumentEditorInput } from "../../client/src/v2/documentEditor";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  composeProjectDocumentation,
  type ProjectDocumentationInput,
} from "../../client/src/v2/projectDocumentation";

/**
 * Project Documentation library and Workspace Document editor (#189).
 * Seams: matchV2Route (flagged app chrome) and compose helpers over existing `/api/*`.
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function emptyLibrary(overrides: Partial<ProjectDocumentationInput> = {}): ProjectDocumentationInput {
  return {
    now: new Date(2026, 8, 8, 12, 0, 0),
    workspaceName: "Harbor Co",
    projects: [],
    documents: [],
    expandedProjectIds: [],
    selectedProjectId: null,
    filterQuery: "",
    ...overrides,
  };
}

function emptyEditor(overrides: Partial<DocumentEditorInput> = {}): DocumentEditorInput {
  return {
    source: "workspace",
    document: null,
    missing: true,
    forbidden: false,
    ownerName: "Sam Lee",
    saveState: "idle",
    ...overrides,
  };
}

describe("Project Documentation and Document editor routing (#189)", () => {
  it("shows a live Project Documentation library on the rail destination", () => {
    const match = matchV2Route("/project-documentation");
    expect(match.kind).toBe("project-documentation");
    expect(navIdForPath("/project-documentation")).toBe("project-documentation");
    expect(breadcrumbFor("/project-documentation", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "PROJECT DOCUMENTATION",
    ]);
    expect(appSource).toContain("V2ProjectDocumentationPage");
    expect(appSource).toMatch(/path="\/project-documentation"/);
  });

  it("rewrites v1 documentation URLs into this destination, not a placeholder", () => {
    expect(matchV2Route("/documentation")).toMatchObject({
      kind: "project-documentation",
      href: "/project-documentation",
    });
    expect(matchV2Route("/documentation/anything")).toMatchObject({
      kind: "project-documentation",
      href: "/project-documentation",
    });
    expect(appSource).toMatch(/path="\/documentation"/);
  });

  it("opens a Workspace Document from the library in the v2 editor, not a placeholder", () => {
    const match = matchV2Route("/documents/doc-live");
    expect(match.kind).toBe("document-editor");
    if (match.kind !== "document-editor") return;
    expect(match.documentId).toBe("doc-live");
    expect(match.source).toBe("workspace");
    expect(navIdForPath("/documents/doc-live")).toBe("documents");
    expect(breadcrumbFor("/documents/doc-live", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "WORKSPACE DOCUMENTS",
      "DOCUMENT",
    ]);
    expect(appSource).toContain("V2DocumentPage");
    expect(appSource).toMatch(/path="\/documents\/:id"/);
  });

  it("opens v1 company-document and Project Document URLs under v2 chrome", () => {
    expect(matchV2Route("/company-documents")).toMatchObject({ kind: "documents", href: "/documents" });
    expect(matchV2Route("/company-documents/doc-live/edit")).toMatchObject({
      kind: "document-editor",
      documentId: "doc-live",
      source: "workspace",
    });
    expect(matchV2Route("/company-documents/doc-live/view")).toMatchObject({
      kind: "document-editor",
      documentId: "doc-live",
      source: "workspace",
    });
    expect(matchV2Route("/document/doc-project")).toMatchObject({
      kind: "document-editor",
      documentId: "doc-project",
      source: "project",
    });
    expect(navIdForPath("/document/doc-project")).toBe("project-documentation");
    expect(breadcrumbFor("/document/doc-project", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "PROJECT DOCUMENTATION",
      "DOCUMENT",
    ]);
    expect(appSource).toMatch(/path="\/company-documents\/:id\/edit"/);
    expect(appSource).toMatch(/path="\/company-documents\/:id\/view"/);
    expect(appSource).toMatch(/path="\/document\/:id"/);
  });

  it("keeps create and folder actions on the Workspace Documents library, not placeholders", () => {
    expect(matchV2Route("/documents/new").kind).toBe("documents");
    expect(matchV2Route("/documents/new-folder").kind).toBe("documents");
    expect(matchV2Route("/documents/upload").kind).toBe("documents");
  });
});

describe("Project Documentation library from live Project Documents (#189)", () => {
  it("empty library uses empty geometry and never shows another Workspace's sample names", () => {
    const library = composeProjectDocumentation(emptyLibrary());
    const blob = JSON.stringify(library);

    expect(library.empty).toBe(true);
    expect(library.rows).toEqual([]);
    expect(library.emptyCopy.toLowerCase()).toContain("project document");
    expect(library.refusal).toBeNull();
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("lists Project Documents the Member can access, grouped under assigned Projects", () => {
    const library = composeProjectDocumentation(
      emptyLibrary({
        projects: [
          {
            id: "crm-1",
            documentProjectId: "doc-prj-1",
            name: "Ledger rebuild",
            visible: true,
            documentationEnabled: true,
          },
          {
            id: "crm-hidden",
            documentProjectId: "doc-prj-hidden",
            name: "Payroll overhaul",
            visible: false,
            documentationEnabled: true,
          },
        ],
        documents: [
          {
            id: "d1",
            title: "Scope notes",
            projectId: "doc-prj-1",
            updatedAt: new Date(2026, 8, 8, 12, 41, 0),
            createdBy: { firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          },
          {
            id: "d-hidden",
            title: "Salary bands",
            projectId: "doc-prj-hidden",
            updatedAt: new Date(2026, 8, 8, 11, 0, 0),
          },
        ],
        expandedProjectIds: ["crm-1"],
      }),
    );

    expect(library.empty).toBe(false);
    expect(library.rows.filter((row) => row.kind === "folder")).toHaveLength(1);
    expect(library.rows.find((row) => row.id === "crm-1")).toMatchObject({
      kind: "folder",
      name: "Ledger rebuild",
      type: "FOLDER",
      expanded: true,
    });
    const child = library.rows.find((row) => row.id === "d1");
    expect(child).toMatchObject({
      kind: "document",
      name: "Scope notes",
      type: "DOCUMENT",
      child: true,
      href: "/document/d1",
    });
    expect(matchV2Route(child!.href!).kind).toBe("document-editor");
    const blob = JSON.stringify(library);
    expect(blob).not.toContain("Payroll");
    expect(blob).not.toContain("Salary bands");
    expect(blob).not.toContain("Keystone");
  });

  it("hides Restricted Project Documents inside a visible Project", () => {
    const library = composeProjectDocumentation(
      emptyLibrary({
        projects: [
          {
            id: "crm-1",
            documentProjectId: "doc-prj-1",
            name: "Ledger rebuild",
            visible: true,
            documentationEnabled: true,
          },
        ],
        documents: [
          { id: "open", title: "Kickoff notes", projectId: "doc-prj-1" },
          { id: "hidden", title: "Payroll ledger", projectId: "doc-prj-1", access: "restricted" },
        ],
        expandedProjectIds: ["crm-1"],
      }),
    );

    expect(library.rows.map((row) => row.id)).toEqual(["crm-1", "open"]);
    expect(JSON.stringify(library)).not.toContain("Payroll");
  });

  it("empty filter results stay empty without sample data", () => {
    const library = composeProjectDocumentation(
      emptyLibrary({
        projects: [
          {
            id: "crm-1",
            documentProjectId: "doc-prj-1",
            name: "Ledger rebuild",
            visible: true,
            documentationEnabled: true,
          },
        ],
        filterQuery: "zzz-missing",
      }),
    );
    expect(library.empty).toBe(true);
    expect(library.rows).toEqual([]);
    expect(library.emptyCopy.toLowerCase()).toContain("filter");
    expect(JSON.stringify(library)).not.toContain("Keystone");
  });
});

describe("Workspace Document editor from live knowledge writes (#189)", () => {
  it("missing Document uses empty geometry and never shows sample names", () => {
    const editor = composeDocumentEditor(emptyEditor());
    const blob = JSON.stringify(editor);
    expect(editor.missing).toBe(true);
    expect(editor.mode).toBe("missing");
    expect(editor.emptyCopy.toLowerCase()).toContain("document");
    expect(editor.title).toBeNull();
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("opens a native Workspace Document as an editor and a File as a viewer", () => {
    const page = composeDocumentEditor(
      emptyEditor({
        missing: false,
        document: {
          id: "doc-1",
          name: "Remote work policy",
          content: { type: "doc" },
          access: "workspace",
        },
        saveState: "saved",
      }),
    );
    expect(page.missing).toBe(false);
    expect(page.mode).toBe("editor");
    expect(page.title).toBe("Remote work policy");
    expect(page.saveLabel).toBe("Saved");
    expect(page.backHref).toBe("/documents");

    const file = composeDocumentEditor(
      emptyEditor({
        missing: false,
        document: {
          id: "file-1",
          name: "brand-kit.zip",
          storagePath: "/objects/kit.zip",
          fileName: "brand-kit.zip",
          access: "workspace",
        },
      }),
    );
    expect(file.mode).toBe("viewer");
    expect(file.title).toBe("brand-kit.zip");
    expect(file.saveLabel).toBe("");
  });

  it("hides a Restricted Document instead of showing its contents", () => {
    const editor = composeDocumentEditor(
      emptyEditor({
        missing: false,
        document: {
          id: "hidden",
          name: "Payroll ledger",
          content: { type: "doc" },
          access: "restricted",
        },
      }),
    );
    expect(editor.mode).toBe("missing");
    expect(editor.title).toBeNull();
    expect(JSON.stringify(editor)).not.toContain("Payroll");
  });

  it("names the Capability when a Member cannot open the Document", () => {
    const editor = composeDocumentEditor(
      emptyEditor({
        missing: false,
        forbidden: true,
        ownerName: "Sam Lee",
      }),
    );
    expect(editor.refusal).toContain("View Workspace Documents");
    expect(editor.refusal?.toLowerCase()).not.toContain("permission denied");
    expect(editor.refusal).toContain("Sam Lee");
    expect(editor.mode).toBe("missing");
  });

  it("morphs save state without celebration copy", () => {
    const unsaved = composeDocumentEditor(
      emptyEditor({ missing: false, document: { id: "d", name: "A" }, saveState: "unsaved" }),
    );
    const saving = composeDocumentEditor(
      emptyEditor({ missing: false, document: { id: "d", name: "A" }, saveState: "saving" }),
    );
    const saved = composeDocumentEditor(
      emptyEditor({ missing: false, document: { id: "d", name: "A" }, saveState: "saved" }),
    );
    expect(unsaved.saveLabel).toBe("Unsaved");
    expect(saving.saveLabel).toBe("Saving");
    expect(saved.saveLabel).toBe("Saved");
    expect(saved.saveLabel).not.toMatch(/success|celebrat|woo/i);
  });

  it("hides a Project Document the Member is not assigned to", () => {
    const editor = composeDocumentEditor(
      emptyEditor({
        source: "project",
        missing: false,
        assigned: false,
        document: {
          id: "hidden",
          name: "Salary bands",
          content: { type: "doc" },
        },
      }),
    );
    expect(editor.mode).toBe("missing");
    expect(editor.title).toBeNull();
    expect(JSON.stringify(editor)).not.toContain("Salary");
  });

  it("opens a Project Document in the editor and sends the Member back to Project Documentation", () => {
    const editor = composeDocumentEditor(
      emptyEditor({
        source: "project",
        missing: false,
        document: { id: "d1", name: "Scope notes", content: { type: "doc" } },
      }),
    );
    expect(editor.mode).toBe("editor");
    expect(editor.backHref).toBe("/project-documentation");
    expect(editor.title).toBe("Scope notes");
  });
});

describe("Search citations honor Document Access (#189)", () => {
  it("opens a Project Document hit in the editor and still hides Restricted Workspace Documents", () => {
    const model = composeSearch({
      query: "notes",
      searchHits: [
        { type: "document", id: "d1", title: "Scope notes", projectName: "Ledger rebuild" },
        { type: "document", id: "hidden", title: "Salary bands", projectName: "Payroll overhaul" },
      ],
      workspaceDocuments: [
        { id: "open", name: "Leave policy", access: "workspace" },
        { id: "hidden", name: "Payroll bands", access: "restricted" },
      ],
      folders: [],
      assignedProjectNames: ["Ledger rebuild"],
    });
    expect(model.rows.find((row) => row.title === "Scope notes")?.href).toBe("/document/d1");
    expect(matchV2Route("/document/d1").kind).toBe("document-editor");
    expect(model.rows.map((row) => row.title)).not.toContain("Payroll bands");
    expect(model.rows.map((row) => row.title)).not.toContain("Salary bands");
    expect(JSON.stringify(model)).not.toContain("Payroll");
  });
});

describe("Folder expand motion (#189)", () => {
  it("animates folder expand as an accordion and keeps typing, filter, and tree-load instant", () => {
    const expand = motionForSurface("folder-expand");
    expect(expand.enterExit).toBe("standard");
    expect(expand.movement).toBe("allowed");

    const reduced = motionForSurface("folder-expand", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(motionForSurface("library-filter").enterExit).toBe("instant");
    expect(motionForSurface("editor-typing").enterExit).toBe("instant");
    expect(motionForSurface("editor-save").movement).toBe("none");

    expect(rule(".df-accordion")).toMatch(/grid-template-rows/);
    expect(rule(".df-accordion")).toMatch(/var\(--ease-out\)/);
    expect(rule(".df-accordion")).not.toMatch(/transition\s*:\s*all\b/);
    expect(css).not.toMatch(/\.df-accordion[^{]*\{[^}]*@starting-style/);
    expect(rule(".df-filter-input input")).toMatch(/transition:\s*none/);
    expect(rule(".df-editor")).toMatch(/transition:\s*none/);
    expect(reducedMotionCss()).toMatch(/\.df-accordion[^{]*\{[^}]*transition:\s*none/);
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
