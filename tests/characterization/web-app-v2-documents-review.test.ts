import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeLibrary,
  libraryFilterLabels,
  type LibraryDocument,
  type LibraryFolder,
  type LibraryInput,
} from "../../client/src/v2/library";

/**
 * The Workspace Documents review, register half (F53, F54, F55, F59).
 * Seams: composeLibrary and the source shape of V2Documents / V2Library.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const documentsSource = read("client/src/v2/V2Documents.tsx");
const registerSource = read("client/src/v2/V2Library.tsx");

function input(overrides: Partial<LibraryInput> = {}): LibraryInput {
  return {
    now: new Date(2026, 10, 24, 12, 0, 0),
    workspaceName: "Harbor Co",
    folders: [],
    documents: [],
    expandedFolderIds: [],
    selectedFolderId: null,
    filterQuery: "",
    capabilityMiss: false,
    ownerName: "Sam Lee",
    ...overrides,
  };
}

const folder = (overrides: Partial<LibraryFolder> = {}): LibraryFolder => ({
  id: "f1",
  name: "Policies",
  createdBy: { firstName: "Ada", lastName: "Lovelace" },
  effectiveAccess: "workspace",
  access: "workspace",
  ...overrides,
});

const document = (overrides: Partial<LibraryDocument> = {}): LibraryDocument => ({
  id: "d1",
  name: "Handbook",
  folderId: "f1",
  effectiveAccess: "workspace",
  access: "workspace",
  uploadedById: "u2",
  uploadedBy: { firstName: "Grace", lastName: "Hopper" },
  updatedAt: new Date(2026, 10, 20, 9, 0, 0),
  ...overrides,
});

describe("register dates and people (F59)", () => {
  it("adds the year to a date outside the current year, and only then", () => {
    const library = composeLibrary(
      input({
        documents: [
          document({ id: "old", name: "Old", folderId: null, updatedAt: new Date(2025, 11, 3, 9, 0, 0) }),
          document({ id: "new", name: "New", folderId: null, updatedAt: new Date(2026, 10, 3, 9, 0, 0) }),
        ],
      }),
    );
    expect(library.rows.find((row) => row.id === "old")?.updated).toBe("3 Dec 2025");
    expect(library.rows.find((row) => row.id === "new")?.updated).toBe("3 Nov");
  });

  it("shows a Folder's creator in the person column, not the latest child's uploader", () => {
    const library = composeLibrary(input({ folders: [folder()], documents: [document()] }));
    expect(library.rows.find((row) => row.id === "f1")?.editor).toBe("Ada Lovelace");
    expect(library.rows.find((row) => row.id === "d1")?.editor).toBe("Grace Hopper");
  });

  it("names the filter Added by", () => {
    expect(libraryFilterLabels({ type: "all", owner: "u2", access: "all", updated: "all" }, [{ value: "u2", label: "Grace Hopper" }])).toEqual([
      "Added by: Grace Hopper",
    ]);
    expect(documentsSource).toContain('label="Added by"');
    expect(documentsSource).toContain('ariaLabel="Filter by who added it"');
    expect(documentsSource).toContain("readLibraryFilters");
    expect(registerSource).toContain("<span>Added by</span>");
    expect(registerSource).not.toContain("Last editor");
  });
});

describe("Folder preview (F54, F59)", () => {
  it("offers Delete only where the route said the reader may", () => {
    const withIt = composeLibrary(input({ folders: [folder({ canDelete: true })], selectedFolderId: "f1" }));
    const without = composeLibrary(input({ folders: [folder()], selectedFolderId: "f1" }));
    const denied = composeLibrary(input({ folders: [folder({ canDelete: false })], selectedFolderId: "f1" }));
    expect(withIt.preview?.canDelete).toBe(true);
    expect(without.preview?.canDelete).toBe(false);
    expect(denied.preview?.canDelete).toBe(false);
    expect(documentsSource).toMatch(/library\.preview\.canDelete \? \(\s*<AlertDialog /);
  });

  it("carries the Folder's description, and none when it has none", () => {
    const described = composeLibrary(input({ folders: [folder({ description: "  Rules we live by " })], selectedFolderId: "f1" }));
    const bare = composeLibrary(input({ folders: [folder({ description: "  " })], selectedFolderId: "f1" }));
    expect(described.preview?.description).toBe("Rules we live by");
    expect(bare.preview?.description).toBeNull();
    expect(documentsSource).toContain("library.preview.description");
  });
});

describe("the register page source (F53, F55, F59)", () => {
  it("reads the whole register in one request", () => {
    expect(documentsSource).toContain('"/api/company-documents/register"');
    expect(documentsSource).not.toContain("/api/company-documents?folderId");
    expect(documentsSource.match(/\bfetch\(/g)).toHaveLength(1);
  });

  it("re-reads on every visit under the same key", () => {
    expect(documentsSource).toMatch(
      /queryKey: \["\/api\/company-document-folders", "workspace-library"\],\s*queryFn: loadWorkspaceLibrary,\s*staleTime: 0/,
    );
  });

  it("shows the failed-load state with Try again, not an empty library", () => {
    expect(documentsSource).toMatch(/if \(isError && !data\) \{[\s\S]*?<V2LoadFailed[\s\S]*?v2-documents-load-failed/);
    expect(documentsSource).toContain("onRetry={() => refetch()}");
    expect(documentsSource).toMatch(/isError && data[\s\S]*?notify\.error/);
  });

  it("drops the create param when the dialog closes, and reopens when the address asks again", () => {
    expect(documentsSource).toMatch(/for \(const param of CREATE_PARAMS\) params\.delete\(param\)/);
    expect(documentsSource).toMatch(/navigate\(`\/documents\$\{query \? `\?\$\{query\}` : ""\}`, \{ replace: true \}\)/);
    expect(documentsSource).toMatch(/actionFromSearch\(search\)[\s\S]*?\[search\]/);
    expect(documentsSource).not.toMatch(/setCreateMode\(null\)(?![\s\S]{0,0})[\s\S]{0,0}onOpenChange/);
    expect(documentsSource.match(/if \(!open\) closeCreate\(\)/g)).toHaveLength(2);
  });

  it("limits names to what the server stores", () => {
    expect(documentsSource).toContain("MAX_FOLDER_NAME = 255");
    expect(documentsSource).toContain("MAX_DOCUMENT_NAME = 500");
    expect(documentsSource).toMatch(/maxLength=\{createMode === "folder" \? MAX_FOLDER_NAME : MAX_DOCUMENT_NAME\}/);
    expect(documentsSource).toMatch(/maxLength=\{MAX_FOLDER_NAME\}/);
  });

  it("puts the page header above the split so New Document does not move", () => {
    expect(documentsSource).toMatch(
      /className="df-library-page" data-testid="v2-documents" onKeyDown=\{onLibraryKeyDown\}>\s*<header[\s\S]*?<\/header>[\s\S]*?<div className="df-library">\s*<div className="df-library-main">/,
    );
    const split = documentsSource.slice(documentsSource.indexOf('<div className="df-library">'));
    expect(split.indexOf("df-filter-bar")).toBeLessThan(split.indexOf("df-folder-preview"));
    expect(documentsSource.slice(0, documentsSource.indexOf('<div className="df-library">'))).toContain('<header className="df-today-head">');
  });

  it("does not map a Document's full text into the register", () => {
    expect(documentsSource).not.toContain("content: document.content");
  });
});
