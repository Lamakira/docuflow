import { describe, expect, it } from "vitest";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import { composeLibrary, type LibraryInput } from "../../client/src/v2/library";

/**
 * Workspace Documents live register (#174).
 * Seams: matchV2Route (flagged app chrome) and composeLibrary (existing `/api/*`).
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function emptyInput(overrides: Partial<LibraryInput> = {}): LibraryInput {
  return {
    now: new Date(2026, 8, 8, 12, 0, 0),
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

describe("Workspace Documents routing (#174)", () => {
  it("shows the Artifact 04 register on the rail Documents destination", () => {
    const match = matchV2Route("/documents");
    expect(match.kind).toBe("documents");
    expect(navIdForPath("/documents")).toBe("documents");
    expect(breadcrumbFor("/documents", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "WORKSPACE DOCUMENTS",
    ]);
  });

  it("opens a Document that this batch does not implement as a v2 placeholder, not the v1 editor", () => {
    expect(matchV2Route("/documents/doc-live").kind).toBe("placeholder");
    expect(matchV2Route("/documents/new").kind).toBe("placeholder");
    expect(matchV2Route("/company-documents").kind).toBe("placeholder");
    expect(matchV2Route("/company-documents/doc-live/edit").kind).toBe("placeholder");
    expect(matchV2Route("/company-documents/doc-live/view").kind).toBe("placeholder");
  });
});

describe("Workspace Documents register from live Workspace records (#174)", () => {
  it("empty library uses empty geometry and never shows another Workspace's sample names", () => {
    const library = composeLibrary(emptyInput());
    const blob = JSON.stringify(library);

    expect(library.empty).toBe(true);
    expect(library.rows).toEqual([]);
    expect(library.preview).toBeNull();
    expect(library.emptyCopy.toLowerCase()).toContain("workspace document");
    expect(library.refusal).toBeNull();
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("fills the register from Workspace Document reads, with access visible, and scales past four folders", () => {
    const library = composeLibrary(
      emptyInput({
        folders: [
          { id: "fld-1", name: "Policies", updatedAt: new Date(2026, 8, 8, 9, 0, 0) },
          { id: "fld-2", name: "Profiles", updatedAt: new Date(2026, 8, 7, 16, 20, 0) },
          { id: "fld-3", name: "Benefits" },
          { id: "fld-4", name: "Templates" },
          { id: "fld-5", name: "Playbooks" },
        ],
        documents: [
          {
            id: "doc-1",
            name: "Remote work policy",
            folderId: "fld-1",
            access: "workspace",
            uploadedBy: { firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
            updatedAt: new Date(2026, 8, 8, 12, 41, 0),
            content: { type: "doc" },
          },
          {
            id: "file-1",
            name: "brand-kit.zip",
            folderId: "fld-4",
            access: "workspace",
            storagePath: "/objects/kit.zip",
            fileName: "brand-kit.zip",
            uploadedBy: { firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
            updatedAt: new Date(2026, 8, 1, 10, 0, 0),
          },
          {
            id: "doc-root",
            name: "Onboarding checklist",
            folderId: null,
            access: "workspace",
            uploadedBy: { firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
            updatedAt: new Date(2026, 8, 8, 11, 0, 0),
            content: { type: "doc" },
          },
        ],
        expandedFolderIds: ["fld-1"],
        selectedFolderId: "fld-1",
      }),
    );

    expect(library.empty).toBe(false);
    expect(library.folderCount).toBe(5);
    expect(library.rows.filter((row) => row.kind === "folder")).toHaveLength(5);
    const policies = library.rows.find((row) => row.id === "fld-1");
    expect(policies).toMatchObject({
      kind: "folder",
      name: "Policies",
      type: "FOLDER",
      access: "EVERYONE",
      expanded: true,
      selected: true,
    });
    expect(policies?.path).toMatch(/1 ITEM/);
    const child = library.rows.find((row) => row.id === "doc-1");
    expect(child).toMatchObject({
      kind: "document",
      name: "Remote work policy",
      type: "DOCUMENT",
      access: "EVERYONE",
      editor: "Sam Lee",
      child: true,
      href: "/documents/doc-1",
    });
    expect(child?.path).toContain("Policies");
    expect(matchV2Route(child!.href!).kind).toBe("placeholder");
    const root = library.rows.find((row) => row.id === "doc-root");
    expect(root).toMatchObject({
      kind: "document",
      name: "Onboarding checklist",
      type: "DOCUMENT",
      access: "EVERYONE",
      child: false,
      href: "/documents/doc-root",
    });
    const file = library.rows.find((row) => row.id === "file-1");
    expect(file).toBeUndefined();
    const templates = library.rows.find((row) => row.id === "fld-4");
    expect(templates?.type).toBe("FOLDER");
    expect(library.preview).toMatchObject({
      title: "Policies",
    });
    expect(JSON.stringify(library)).not.toContain("Keystone");
  });

  it("hides Restricted Documents and still shows access on visible rows", () => {
    const library = composeLibrary(
      emptyInput({
        folders: [{ id: "fld-1", name: "Profiles" }],
        documents: [
          {
            id: "visible",
            name: "Job profile — senior analyst",
            folderId: "fld-1",
            access: "workspace",
            content: { type: "doc" },
          },
          {
            id: "hidden",
            name: "Payroll ledger",
            folderId: "fld-1",
            access: "restricted",
            content: { type: "doc" },
          },
        ],
        expandedFolderIds: ["fld-1"],
      }),
    );

    expect(library.rows.map((row) => row.id)).toEqual(["fld-1", "visible"]);
    expect(library.rows.find((row) => row.id === "visible")?.access).toBe("EVERYONE");
    const blob = JSON.stringify(library);
    expect(blob).not.toContain("Payroll");
    expect(blob).not.toContain("Keystone");
    expect(blob).not.toMatch(/3 restricted/i);
  });

  it("names the Capability when a Member cannot read Workspace Documents", () => {
    const library = composeLibrary(
      emptyInput({
        capabilityMiss: true,
        ownerName: "Sam Lee",
        folders: [{ id: "fld-1", name: "Handbooks" }],
      }),
    );
    expect(library.refusal).toContain("View Workspace Documents");
    expect(library.refusal?.toLowerCase()).not.toContain("permission denied");
    expect(library.refusal).toContain("Sam Lee");
    expect(library.refusal).toContain("Owner");
    expect(library.rows).toEqual([]);
    expect(JSON.stringify(library)).not.toContain("Handbooks");
  });

  it("empty filter results stay empty without Keystone sample data", () => {
    const library = composeLibrary(
      emptyInput({
        folders: [{ id: "fld-1", name: "Handbooks" }],
        filterQuery: "zzz-missing",
      }),
    );
    expect(library.empty).toBe(true);
    expect(library.rows).toEqual([]);
    expect(library.emptyCopy.toLowerCase()).toContain("filter");
    expect(JSON.stringify(library)).not.toContain("Keystone");
  });
});
