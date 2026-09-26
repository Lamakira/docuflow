import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeLibrary,
  folderChoices,
  groupLibraryRows,
  type LibraryFolder,
  type LibraryInput,
} from "../../client/src/v2/library";

/**
 * Every "New …" action opens a dialog (#273), and a Folder can sit inside a
 * Folder at any depth.
 * Seams: V2FormDialog / composeLibrary / folderChoices / groupLibraryRows.
 */

const v2Dir = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");
const read = (name: string) => readFileSync(join(v2Dir, name), "utf8");

describe("create actions open a dialog", () => {
  const SCREENS: Record<string, string[]> = {
    "V2Opportunities.tsx": ["v2-opportunities-new"],
    "V2Projects.tsx": ["v2-projects-new"],
    "V2Clients.tsx": ["v2-clients-new", "v2-client-add-contact", "v2-client-edit"],
    "V2Administration.tsx": ["v2-administration-new-service-account", "v2-administration-new-webhook-endpoint"],
    "V2Documents.tsx": ["v2-documents-new-folder", "v2-documents-new-document", "v2-documents-upload"],
    "V2ProjectDocumentation.tsx": ["v2-project-documentation-new-project", "v2-project-documentation-new-document"],
    "V2People.tsx": ["v2-people-invite-dialog", "v2-people-settings-dialog"],
    "V2Dossier.tsx": ["v2-dossier-new-document"],
  };

  it("renders each one in V2FormDialog, and no inline create form is left", () => {
    for (const [name, testIds] of Object.entries(SCREENS)) {
      const src = read(name);
      expect(src, name).toContain("<V2FormDialog");
      for (const testId of testIds) expect(src, `${name} ${testId}`).toContain(testId);
      expect(src, name).not.toMatch(/set(?:Creating\w*|Inviting|AddingContact)\(\(open\) => !open\)/);
      expect(src, name).not.toMatch(/<form className="df-filter-bar[^"]*" onSubmit=\{on(?:Create|Invite)\}/);
    }
  });

  it("builds the dialog on the shadcn Dialog, carrying the v2 class through the portal", () => {
    const dialog = read("V2FormDialog.tsx");
    expect(dialog).toContain('from "@/components/ui/dialog"');
    expect(dialog).toMatch(/<DialogContent className="df-v2 /);
    expect(dialog).toContain("<DialogClose asChild>");
    expect(dialog).toContain('{refusal ? <p className="df-refusal">{refusal}</p> : null}');
  });

  it("draws no bare file input outside a dialog", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(v2Dir).filter((file) => file.endsWith(".tsx"))) {
      const src = read(name);
      for (const match of src.matchAll(/<input[^>]*type="file"[^>]*>/g)) {
        const at = match.index ?? 0;
        const opened = src.lastIndexOf("<V2FormDialog", at);
        const closed = src.lastIndexOf("</V2FormDialog>", at);
        const inDialog = opened !== -1 && opened > closed;
        if (!inDialog && !/\bhidden\b/.test(match[0])) offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("creates a Folder under the parent the reader chose, defaulting to the selected Folder", () => {
    const src = read("V2Documents.tsx");
    expect(src).toContain('apiRequest("POST", "/api/company-document-folders", { name: folderName, parentId: target })');
    expect(src).toContain("setTargetFolderId(selectedFolderId ?? V2_SELECT_NONE)");
    expect(src).toContain("folderChoices(input.folders)");
  });
});

const NOW = new Date("2026-09-25T12:00:00Z");

function folder(id: string, name: string, parentId: string | null = null): LibraryFolder {
  return { id, name, parentId, updatedAt: "2026-09-20T10:00:00Z" };
}

function library(overrides: Partial<LibraryInput> = {}): LibraryInput {
  return {
    now: NOW,
    workspaceName: "Harbor Co",
    folders: [
      folder("f-hand", "Handbook"),
      folder("f-people", "People", "f-hand"),
      folder("f-leave", "Leave", "f-people"),
      folder("f-legal", "Legal"),
      folder("f-orphan", "Orphan", "f-gone"),
    ],
    documents: [
      { id: "d-leave", name: "Parental leave", folderId: "f-leave", access: "workspace" },
      { id: "d-root", name: "Welcome", folderId: null, access: "workspace" },
    ],
    expandedFolderIds: [],
    selectedFolderId: null,
    filterQuery: "",
    capabilityMiss: false,
    ownerName: null,
    ...overrides,
  };
}

describe("Folders inside Folders", () => {
  it("lists each Folder under its parent, a level deeper, named by its path", () => {
    const rows = composeLibrary(library()).rows;
    expect(rows.map((row) => [row.id, row.depth, row.path])).toEqual([
      ["f-hand", 0, "/ · 1 ITEM"],
      ["f-people", 1, "Handbook / · 1 ITEM"],
      ["f-leave", 2, "Handbook / People / · 1 ITEM"],
      ["d-leave", 3, "Handbook / People / Leave /"],
      ["f-legal", 0, "/ · 0 ITEMS"],
      ["f-orphan", 0, "/ · 0 ITEMS"],
      ["d-root", 0, "/"],
    ]);
  });

  it("nests the rows back into groups, so a closed Folder hides everything under it", () => {
    const groups = groupLibraryRows(composeLibrary(library()).rows);
    expect(groups.map((group) => (group.kind === "folder" ? group.folder.id : group.row.id))).toEqual([
      "f-hand",
      "f-legal",
      "f-orphan",
      "d-root",
    ]);
    const hand = groups[0];
    if (hand.kind !== "folder") throw new Error("expected a folder");
    const people = hand.children[0];
    if (people.kind !== "folder") throw new Error("expected a folder");
    const leave = people.children[0];
    if (leave.kind !== "folder") throw new Error("expected a folder");
    expect(leave.children.map((child) => (child.kind === "item" ? child.row.id : child.folder.id))).toEqual(["d-leave"]);
  });

  it("opens every Folder above a deep match while filtering", () => {
    const rows = composeLibrary(library({ filterQuery: "parental" })).rows;
    expect(rows.map((row) => [row.id, row.expanded ?? null])).toEqual([
      ["f-hand", true],
      ["f-people", true],
      ["f-leave", true],
      ["d-leave", null],
    ]);
  });

  it("counts the Folders inside one in its preview, and says the delete takes them too", () => {
    const preview = composeLibrary(library({ selectedFolderId: "f-hand" })).preview;
    expect(preview?.meta).toBe("1 ITEM · FOLDER");
    expect(preview?.deleteConsequence).toContain("Folders inside it included");
  });

  it("offers every Folder as a destination, parents first, by full path", () => {
    expect(folderChoices(library().folders)).toEqual([
      { value: "f-hand", label: "Handbook" },
      { value: "f-people", label: "Handbook / People" },
      { value: "f-leave", label: "Handbook / People / Leave" },
      { value: "f-legal", label: "Legal" },
      { value: "f-orphan", label: "Orphan" },
    ]);
  });
});
