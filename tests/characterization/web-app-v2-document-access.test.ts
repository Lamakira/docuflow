import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeLibrary,
  libraryOwnerOptions,
  readLibraryFilters,
  writeLibraryFilters,
  LIBRARY_FILTERS_DEFAULT,
  type LibraryInput,
} from "../../client/src/v2/library";
import {
  accessPath,
  composeManageAccess,
  toggleAccessMember,
  type AccessStateView,
} from "../../client/src/v2/manageAccess";
import { composeProjectDocumentation } from "../../client/src/v2/projectDocumentation";
import { composeFileViewer, isObjectPath, projectFileStreamHref } from "../../client/src/v2/fileViewer";
import { composeAsk, composeSearch } from "../../client/src/v2/chrome";

/**
 * Document Access, the register's filters, and Project Files in v2 (#278).
 * Seams: composeLibrary / read+writeLibraryFilters / composeManageAccess /
 * composeProjectDocumentation / composeFileViewer, and the screens' source.
 */

const v2Dir = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");
const read = (name: string) => readFileSync(join(v2Dir, name), "utf8");

const NOW = new Date(2026, 8, 27, 12, 0, 0);
const SAM = { firstName: "Sam", lastName: "Lee", email: "sam@example.com" };
const PAT = { firstName: "Pat", lastName: "Ng", email: "pat@example.com" };

function input(overrides: Partial<LibraryInput> = {}): LibraryInput {
  return {
    now: NOW,
    workspaceName: "Harbor Co",
    folders: [
      { id: "f-hr", name: "People", access: "workspace", effectiveAccess: "workspace" },
      { id: "f-pay", name: "Payroll", parentId: "f-hr", access: "restricted", effectiveAccess: "restricted", canManageAccess: true },
    ],
    documents: [
      {
        id: "d-leave",
        name: "Leave policy",
        folderId: "f-hr",
        access: "workspace",
        effectiveAccess: "workspace",
        uploadedById: "u-sam",
        uploadedBy: SAM,
        updatedAt: new Date(2026, 8, 25),
        content: { type: "doc" },
      },
      {
        id: "d-ledger",
        name: "Salary ledger",
        folderId: "f-pay",
        access: "workspace",
        effectiveAccess: "restricted",
        uploadedById: "u-pat",
        uploadedBy: PAT,
        updatedAt: new Date(2026, 5, 1),
        storagePath: "/objects/ledger.xlsx",
      },
      {
        id: "d-root",
        name: "Welcome",
        folderId: null,
        access: "workspace",
        effectiveAccess: "workspace",
        uploadedById: "u-sam",
        uploadedBy: SAM,
        updatedAt: new Date(2026, 8, 26),
        content: { type: "doc" },
      },
    ],
    expandedFolderIds: [],
    selectedFolderId: null,
    filterQuery: "",
    capabilityMiss: false,
    ownerName: null,
    ...overrides,
  };
}

describe("the register shows what the server checked (#278)", () => {
  it("shows a Restricted item the route stamped, labelled at the level that applies", () => {
    const rows = composeLibrary(input({ expandedFolderIds: ["f-hr", "f-pay"] })).rows;
    expect(rows.find((row) => row.id === "d-ledger")?.access).toBe("RESTRICTED");
    expect(rows.find((row) => row.id === "f-pay")?.access).toBe("RESTRICTED");
    expect(rows.find((row) => row.id === "f-hr")?.access).toBe("EVERYONE");
  });

  it("still hides a Restricted row no route checked", () => {
    const library = composeLibrary(
      input({
        documents: [{ id: "d-raw", name: "Unchecked", folderId: null, access: "restricted" }],
      }),
    );
    expect(library.rows.map((row) => row.id)).not.toContain("d-raw");
  });

  it("describes the Folder's own level in its preview, and offers Manage access only to who may use it", () => {
    const restricted = composeLibrary(input({ selectedFolderId: "f-pay" })).preview;
    expect(restricted?.accessCopy).toMatch(/^Restricted to the Members named on this Folder/);
    expect(restricted?.canManageAccess).toBe(true);
    const open = composeLibrary(input({ selectedFolderId: "f-hr" })).preview;
    expect(open?.accessCopy).toMatch(/^Everyone in this Workspace/);
    expect(open?.canManageAccess).toBe(false);
  });
});

describe("TYPE, OWNER, ACCESS, and UPDATED filter the register (#278)", () => {
  const ids = (overrides: Partial<LibraryInput>) =>
    composeLibrary(input(overrides)).rows.map((row) => row.id);

  it("narrows by type, opening the Folders above a match", () => {
    expect(ids({ filters: { ...LIBRARY_FILTERS_DEFAULT, type: "file" } })).toEqual(["f-hr", "f-pay", "d-ledger"]);
    expect(ids({ filters: { ...LIBRARY_FILTERS_DEFAULT, type: "document" } })).toEqual(["f-hr", "d-leave", "d-root"]);
  });

  it("narrows by owner, access, and last update", () => {
    expect(ids({ filters: { ...LIBRARY_FILTERS_DEFAULT, owner: "u-pat" } })).toEqual(["f-hr", "f-pay", "d-ledger"]);
    expect(ids({ filters: { ...LIBRARY_FILTERS_DEFAULT, access: "restricted" } })).toEqual(["f-hr", "f-pay", "d-ledger"]);
    expect(ids({ filters: { ...LIBRARY_FILTERS_DEFAULT, updated: "7" } })).toEqual(["f-hr", "d-leave", "d-root"]);
  });

  it("empties with the filter named, so the register offers to clear it", () => {
    const library = composeLibrary(input({ filters: { ...LIBRARY_FILTERS_DEFAULT, access: "administrators" } }));
    expect(library.rows).toEqual([]);
    expect(library.filtered).toBe(true);
    expect(library.emptyCopy).toBe("No Workspace Documents match this filter.");
  });

  it("offers every owner of a listed item once, by name", () => {
    expect(libraryOwnerOptions(input().documents)).toEqual([
      { value: "u-pat", label: "Pat Ng" },
      { value: "u-sam", label: "Sam Lee" },
    ]);
  });

  it("keeps the filters in the URL, leaving defaults out and the create actions alone", () => {
    expect(writeLibraryFilters("", LIBRARY_FILTERS_DEFAULT)).toBe("");
    const written = writeLibraryFilters("?upload=1", {
      q: "ledger",
      type: "file",
      owner: "u-pat",
      access: "restricted",
      updated: "30",
    });
    expect(written).toBe("?upload=1&q=ledger&type=file&owner=u-pat&access=restricted&updated=30");
    expect(readLibraryFilters(written)).toEqual({
      q: "ledger",
      type: "file",
      owner: "u-pat",
      access: "restricted",
      updated: "30",
    });
    expect(readLibraryFilters("?type=folder&access=secret&updated=5")).toEqual(LIBRARY_FILTERS_DEFAULT);
    expect(readLibraryFilters("?access=everyone").access).toBe("workspace");
  });

  it("draws every filter as a V2FilterSelect chip with an action, and no decorative control", () => {
    const page = read("V2Documents.tsx");
    for (const label of ["TYPE", "OWNER", "ACCESS", "UPDATED"]) {
      expect(page).toContain(`label="${label}"`);
    }
    expect(page).not.toMatch(/<span className="df-filter-chip"/);
    expect(page).not.toContain("df-segment");
    expect(page).toContain("setFilters(clearLibraryFilters())");
    expect(page).toContain("writeLibraryFilters(search, next)");
  });
});

describe("Manage access (#278)", () => {
  const state: AccessStateView = {
    kind: "document",
    id: "d-plan",
    name: "Exit plan",
    level: "workspace",
    memberIds: [],
    effectiveLevel: "restricted",
    inherited: { level: "restricted", from: { id: "f-vault", name: "Vault" }, memberIds: ["u-pat", "u-sam"] },
    allowedLevels: ["workspace", "restricted", "administrators"],
    ownerId: "u-sam",
    canChange: true,
  };
  const members = [
    { userId: "u-sam", ...SAM },
    { userId: "u-pat", ...PAT },
    { userId: "u-kim", firstName: "Kim", lastName: "Ode", email: "kim@example.com" },
    { userId: "u-gone", firstName: "Old", lastName: "Hand", email: "old@example.com", archived: true },
  ];

  it("names where the access is inherited from, and what Everyone means inside a closed Folder", () => {
    const model = composeManageAccess(state, members, { level: "workspace", memberIds: [] });
    expect(model.inheritedCopy).toBe(
      "Inherited from Vault: Restricted. This item can be more restricted than its Folder, never more open.",
    );
    expect(model.levelOptions).toEqual([
      { value: "workspace", label: "Same as Vault (Restricted)" },
      { value: "restricted", label: "Restricted to named Members" },
      { value: "administrators", label: "Administrators only" },
    ]);
    expect(model.showMembers).toBe(false);
    expect(model.canSave).toBe(true);
  });

  it("offers only the Members the Folder already lets in, and needs one named for Restricted", () => {
    const empty = composeManageAccess(state, members, { level: "restricted", memberIds: [] });
    expect(empty.showMembers).toBe(true);
    expect(empty.memberChoices.map((choice) => choice.userId)).toEqual(["u-sam", "u-pat"]);
    expect(empty.memberChoices.find((choice) => choice.userId === "u-sam")?.owner).toBe(true);
    expect(empty.canSave).toBe(false);

    const draft = toggleAccessMember({ level: "restricted", memberIds: [] }, "u-pat", true);
    expect(draft.memberIds).toEqual(["u-pat"]);
    const named = composeManageAccess(state, members, draft);
    expect(named.canSave).toBe(true);
    expect(named.memberChoices.find((choice) => choice.userId === "u-pat")?.checked).toBe(true);
    expect(toggleAccessMember(draft, "u-pat", false).memberIds).toEqual([]);
  });

  it("offers every active Member when nothing above restricts, and refuses a reader who may not change it", () => {
    const root = composeManageAccess(
      { ...state, inherited: { level: "workspace", from: null, memberIds: null }, canChange: false },
      members,
      { level: "restricted", memberIds: ["u-kim"] },
    );
    expect(root.inheritedCopy).toBe("No Folder above this item restricts it.");
    expect(root.memberChoices.map((choice) => choice.userId)).toEqual(["u-sam", "u-pat", "u-kim"]);
    expect(root.canSave).toBe(false);
  });

  it("reads and saves through the access routes", () => {
    expect(accessPath("document", "d-1")).toBe("/api/company-documents/d-1/access");
    expect(accessPath("folder", "f-1")).toBe("/api/company-document-folders/f-1/access");
  });

  it("replaces the dead /documents/access link with a dialog shown only to who may change access", () => {
    const documents = read("V2Documents.tsx");
    expect(documents).not.toContain("/documents/access");
    expect(documents).toMatch(/library\.preview\.canManageAccess \? \(/);
    expect(documents).toContain("<V2ManageAccessDialog");
    expect(read("V2AuthenticatedApp.tsx")).not.toContain("/documents/access");

    const documentPage = read("V2Document.tsx");
    expect(documentPage).toContain('source === "workspace" && data?.record?.canManageAccess');
    expect(documentPage).toContain("<V2ManageAccessDialog");

    const dialog = read("V2ManageAccessDialog.tsx");
    expect(dialog).toContain("<V2FormDialog");
    expect(dialog).toContain("<V2FilterSelect");
    expect(dialog).toContain('from "@/components/ui/checkbox"');
    expect(dialog).toContain('apiRequest("PUT", path, next)');
    expect(dialog).not.toMatch(/<select\b/);
  });
});

describe("search and Ask honour what the server checked (#278)", () => {
  it("lists a Restricted Document the search route stamped, and still drops an unchecked one", () => {
    const search = composeSearch({
      query: "ledger",
      searchHits: [],
      folders: [],
      workspaceDocuments: [
        { id: "checked", name: "Salary ledger", access: "restricted", effectiveAccess: "restricted" },
        { id: "raw", name: "Old ledger", access: "restricted" },
      ],
    });
    expect(search.rows.map((row) => row.id)).toEqual(["document-checked"]);
  });

  it("cites a Restricted Document only when the chat route stamped it", () => {
    const ask = composeAsk({
      messages: [
        {
          role: "assistant",
          content: "Found it.",
          citations: [
            { id: "checked", title: "Salary ledger", kind: "document", access: "restricted", effectiveAccess: "restricted" },
            { id: "raw", title: "Old ledger", kind: "document", access: "restricted" },
          ],
        },
      ],
    });
    expect(ask.messages[0].sources.map((source) => source.id)).toEqual(["checked"]);
  });
});

describe("Project Files (#278)", () => {
  it("lists a Project's Files with its Documents, opening each in the File viewer", () => {
    const library = composeProjectDocumentation({
      now: NOW,
      workspaceName: "Harbor Co",
      projects: [{ id: "p-1", documentProjectId: "p-1", name: "Harbor fit-out", visible: true, documentationEnabled: true }],
      documents: [{ id: "doc-1", title: "Scope", projectId: "p-1" }],
      files: [
        { id: "file-1", name: "Site drawing", projectId: "p-1", createdBy: SAM },
        { id: "file-x", name: "Elsewhere", projectId: "p-other" },
      ],
      expandedProjectIds: ["p-1"],
      selectedProjectId: null,
      filterQuery: "",
    });
    expect(library.rows.map((row) => [row.id, row.type])).toEqual([
      ["p-1", "PROJECT"],
      ["doc-1", "DOCUMENT"],
      ["file-1", "FILE"],
    ]);
    const file = library.rows.find((row) => row.id === "file-1")!;
    expect(file).toMatchObject({ kind: "file", editor: "Sam Lee", child: true });
    expect(file.href).toBe(
      "/files?src=%2Fapi%2Fprojects%2Fp-1%2Ffiles%2Ffile-1%2Fstream&name=Site+drawing&back=%2Fproject-documentation",
    );
    expect(library.rows[0].path).toBe("/ · 2 ITEMS");
    expect(library.itemCount).toBe(3);
  });

  it("finds a File by name like a Document", () => {
    const library = composeProjectDocumentation({
      now: NOW,
      workspaceName: "Harbor Co",
      projects: [{ id: "p-1", documentProjectId: "p-1", name: "Harbor fit-out", visible: true, documentationEnabled: true }],
      documents: [{ id: "doc-1", title: "Scope", projectId: "p-1" }],
      files: [{ id: "file-1", name: "Site drawing", projectId: "p-1" }],
      expandedProjectIds: [],
      selectedProjectId: null,
      filterQuery: "drawing",
    });
    expect(library.rows.map((row) => row.id)).toEqual(["p-1", "file-1"]);
  });

  it("streams through the Project's route and downloads from it", () => {
    const stream = projectFileStreamHref("p-1", "file-1");
    expect(isObjectPath(stream)).toBe(true);
    expect(isObjectPath("/api/projects/p-1/files/file-1/stream?x=1")).toBe(false);
    const viewer = composeFileViewer({
      source: "object",
      name: "Site drawing",
      fileName: "site.pdf",
      mimeType: "application/pdf",
      objectPath: stream,
      backHref: "/project-documentation",
    });
    expect(viewer.missing).toBe(false);
    expect(viewer.streamHref).toBe(stream);
    expect(viewer.downloadHref).toBe("/api/projects/p-1/files/file-1/download");
  });

  it("adds Files through the shared upload dialog on Project Documentation and the Dossier", () => {
    const upload = read("V2UploadDialog.tsx");
    expect(upload).toContain("<V2FormDialog");
    expect(upload).toContain('apiRequest("POST", "/api/company-documents/upload-url")');
    for (const [name, testId] of [
      ["V2Documents.tsx", "v2-documents-upload"],
      ["V2ProjectDocumentation.tsx", "v2-project-documentation-upload"],
      ["V2Dossier.tsx", "v2-dossier-upload-file"],
    ] as const) {
      const src = read(name);
      expect(src, name).toContain("<V2UploadDialog");
      expect(src, name).toContain(testId);
    }
    expect(read("V2ProjectDocumentation.tsx")).toContain("projectFilesPath(selectedDocumentProjectId)");
    expect(read("V2Dossier.tsx")).toContain("projectFilesPath(projectRecordId)");
  });
});
