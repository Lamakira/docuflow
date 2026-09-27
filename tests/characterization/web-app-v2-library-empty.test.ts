import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeLibrary, type LibraryDocument, type LibraryInput } from "../../client/src/v2/library";
import {
  composeProjectDocumentation,
  documentationFilterWords,
  type ProjectDocumentationFilters,
} from "../../client/src/v2/projectDocumentation";

/**
 * The library registers' empty states (#278 follow-up): nothing matching the
 * filters, nothing matching the search, and nothing there yet read as three
 * designed V2EmptyStates (#277), and a filtered foot says how much is shown.
 */

const v2 = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", name), "utf8");

const everyone: LibraryDocument = {
  id: "d1",
  name: "Handbook",
  folderId: "f1",
  access: "workspace",
  uploadedById: "u1",
  uploadedBy: { firstName: "Sam", lastName: "Lee" },
  updatedAt: new Date(2026, 8, 1),
} as LibraryDocument;

function input(overrides: Partial<LibraryInput> = {}): LibraryInput {
  return {
    now: new Date(2026, 8, 8, 12, 0, 0),
    workspaceName: "Harbor Co",
    folders: [{ id: "f1", name: "Company handbook", parentId: null, access: "workspace" } as LibraryInput["folders"][number]],
    documents: [
      everyone,
      { ...everyone, id: "d2", name: "Benefits" },
      { ...everyone, id: "d3", name: "Leave policy", folderId: null },
    ],
    expandedFolderIds: [],
    selectedFolderId: null,
    filterQuery: "",
    capabilityMiss: false,
    ownerName: "Sam Lee",
    ...overrides,
  };
}

const facets = { type: "all", owner: "all", access: "all", updated: "all" } as const;

describe("Workspace Documents empty states", () => {
  it("names the active filters in plain words and offers to clear them", () => {
    const library = composeLibrary(input({ filters: { ...facets, access: "administrators" } }));
    expect(library.empty).toBe(true);
    expect(library.filtered).toBe(true);
    expect(library.emptyState).toEqual({
      kind: "filters",
      title: "No Workspace Documents match these filters",
      copy: "Nothing here matches Access: Administrators only. Clear the filters to see everything you can open.",
    });
  });

  it("names every filter, the search among them, and the owner by name", () => {
    const library = composeLibrary(
      input({ filterQuery: "zzz", filters: { ...facets, type: "file", owner: "u1", updated: "7" } }),
    );
    expect(library.emptyState?.kind).toBe("filters");
    expect(library.emptyState?.copy).toContain(
      "Name: “zzz” · Type: File · Owner: Sam Lee · Updated: in the last 7 days",
    );
  });

  it("mentions the search text when the search alone empties it", () => {
    const library = composeLibrary(input({ filterQuery: "zzz" }));
    expect(library.emptyState).toMatchObject({ kind: "search", title: "No Workspace Documents match “zzz”" });
    expect(library.emptyState?.copy).toContain("“zzz”");
  });

  it("explains an empty Workspace instead of blaming a filter", () => {
    const library = composeLibrary(input({ folders: [], documents: [] }));
    expect(library.filtered).toBe(false);
    expect(library.emptyState).toMatchObject({ kind: "none", title: "No Workspace Documents yet" });
    expect(library.emptyState?.copy).toContain("Harbor Co");
  });

  it("says how many rows are shown of the whole while filtered, and keeps the count otherwise", () => {
    expect(composeLibrary(input()).footLabel).toBe("4 ITEMS · 1 FOLDER");
    expect(composeLibrary(input({ filters: { ...facets, access: "administrators" } })).footLabel).toBe(
      "0 OF 4 ITEMS · 0 FOLDERS SHOWN",
    );
    expect(composeLibrary(input({ filterQuery: "leave" })).footLabel).toBe("1 OF 4 ITEMS · 0 FOLDERS SHOWN");
    expect(composeLibrary(input({ filterQuery: "benefits" })).footLabel).toBe("2 OF 4 ITEMS · 1 FOLDER SHOWN");
  });
});

describe("Project Documentation empty states", () => {
  const filters: ProjectDocumentationFilters = {
    q: "",
    project: "p1",
    client: "c1",
    documentation: "disabled",
    page: 1,
    pageSize: 25,
  } as ProjectDocumentationFilters;
  const names = { projects: new Map([["p1", "Acme site"]]), clients: new Map([["c1", "Acme"]]) };

  it("names its filters in plain words", () => {
    expect(documentationFilterWords(filters, names)).toEqual([
      "Project: Acme site",
      "Client: Acme",
      "Documentation: Disabled",
    ]);
  });

  it("reads filtered, searched, and empty the same way Workspace Documents does", () => {
    const base = {
      now: new Date(2026, 8, 8),
      workspaceName: "Harbor Co",
      projects: [],
      documents: [],
      expandedProjectIds: [],
      selectedProjectId: null,
      filterQuery: "",
    };
    expect(
      composeProjectDocumentation({ ...base, filterWords: ["Client: Acme"], activeFilters: ["CLIENT Acme"] }).emptyState,
    ).toMatchObject({ kind: "filters", title: "No Project Documents match these filters" });
    expect(composeProjectDocumentation({ ...base, filterQuery: "run" }).emptyState).toMatchObject({
      kind: "search",
      title: "No Project Documents match “run”",
    });
    expect(composeProjectDocumentation(base).emptyState).toMatchObject({ kind: "none", title: "No Project Documents yet" });
  });
});

describe("the register renders the designed empty state", () => {
  const register = v2("V2Library.tsx");

  it("uses the shared V2EmptyState with a search-off, filter-off, or documents icon", () => {
    expect(register).toContain('import { V2EmptyState } from "./V2EmptyState"');
    expect(register).toMatch(/search: "search",\s*filters: "filters",\s*none: "documents"/);
    expect(register).toMatch(/action=\{library\.emptyState\.kind === "none" \? createActions : emptyAction\}/);
    const icons = v2("icons.tsx");
    expect(icons).toMatch(/search: SearchX/);
    expect(icons).toMatch(/filters: FilterX/);
  });

  it("hides the column head while empty, as the Clients and Projects registers do", () => {
    expect(register).toMatch(/library\.empty && !library\.refusal && library\.emptyState \? null : \(\s*<div className="df-library-head">/);
  });

  it("takes the foot line from the model", () => {
    expect(register).toMatch(/library\.footLabel \?\?/);
  });

  for (const page of ["V2Documents.tsx", "V2ProjectDocumentation.tsx"]) {
    it(`${page} offers the create actions when empty and names the clear action`, () => {
      const source = v2(page);
      expect(source).toMatch(/createActions=\{/);
      expect(source).toContain('library.emptyState?.kind === "search" ? "Clear search" : "Clear filters"');
    });
  }
});
