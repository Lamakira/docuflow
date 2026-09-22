import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeDossier,
  documentDuplicatePath,
  documentsReorderPath,
  projectClonePath,
  projectDocumentationPath,
  projectMemberPath,
  projectStageHistoryPath,
  projectTagPath,
  projectTagsPath,
  tagPath,
  tagsPath,
  type DossierInput,
} from "../../client/src/v2/dossier";
import { timezoneSuggestions } from "../../client/src/v2/administration";
import { composeLibrary, folderPath, type LibraryInput } from "../../client/src/v2/library";
import { composeProjectRegister, type ProjectRegisterInput } from "../../client/src/v2/projects";

/**
 * Project and Document depth (#260) — PARITY.md sections C, E and F.
 * Seams: composeDossier, composeProjectRegister and composeLibrary, over the
 * `/api/*` routes v1 already used. No new BFF routes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, "../..", path), "utf8");

function emptyInput(overrides: Partial<DossierInput> = {}): DossierInput {
  return {
    now: new Date(2026, 8, 23, 12, 0, 0),
    currentUserId: "user-1",
    tab: "overview",
    project: null,
    tasks: [],
    documents: [],
    dailyUpdate: null,
    dailyUpdateCapabilityMiss: false,
    ownerName: "Sam Lee",
    monthSeconds: 0,
    screenshots: [],
    users: [],
    trackingTaskId: null,
    clientActiveProjectCount: 0,
    timeEntries: [],
    dailyUpdates: [],
    files: [],
    reminders: [],
    notes: [],
    stageHistory: [],
    tags: [],
    workspaceTags: [],
    ...overrides,
  };
}

function liveProject(): NonNullable<DossierInput["project"]> {
  return {
    id: "prj-live",
    projectStatus: "active",
    projectType: "one_time",
    budgetedHours: 120,
    actualHours: 74,
    updatedAt: new Date(2026, 8, 20, 9, 0, 0),
    project: { id: "doc-1", name: "Ledger rebuild" },
    client: { id: "cli-1", name: "Harbor Co", contacts: [] },
    assignee: { id: "user-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
    members: [
      { user: { id: "user-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" } },
      { user: { id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" } },
    ],
    documentationEnabled: 1,
  };
}

const pat = { id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" };

describe("Project record depth reaches the routes v1 used (#260, C)", () => {
  it("names every Project depth route", () => {
    expect(projectClonePath("prj-1")).toBe("/api/crm/projects/prj-1/clone");
    expect(projectStageHistoryPath("prj-1")).toBe("/api/crm/projects/prj-1/stage-history");
    expect(projectTagsPath("prj-1")).toBe("/api/crm/projects/prj-1/tags");
    expect(projectTagPath("prj-1", "tag-1")).toBe("/api/crm/projects/prj-1/tags/tag-1");
    expect(projectMemberPath("prj-1", "user-2")).toBe("/api/crm/projects/prj-1/members/user-2");
    expect(projectDocumentationPath("prj-1")).toBe("/api/crm/projects/prj-1/documentation");
    expect(tagsPath()).toBe("/api/crm/tags");
    expect(tagPath("tag-1")).toBe("/api/crm/tags/tag-1");
  });
});

describe("Status history says how long each Project Status held (#260, C)", () => {
  it("lists changes newest first, with who moved it and how long it held", () => {
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        stageHistory: [
          {
            id: "h-2",
            fromStatus: "won_not_started",
            toStatus: "won_in_progress",
            changedAt: new Date(2026, 8, 20, 12, 0, 0),
            changedBy: pat,
          },
          {
            id: "h-1",
            fromStatus: null,
            toStatus: "won_not_started",
            changedAt: new Date(2026, 8, 13, 12, 0, 0),
            changedBy: null,
          },
        ],
      }),
    );

    expect(dossier.history.empty).toBe(false);
    expect(dossier.history.rows).toEqual([
      {
        id: "h-2",
        from: "WON NOT STARTED",
        to: "WON IN PROGRESS",
        when: "20 SEP",
        who: "Pat Ng",
        held: "3 d so far",
      },
      {
        id: "h-1",
        from: null,
        to: "WON NOT STARTED",
        when: "13 SEP",
        who: "—",
        held: "7 d",
      },
    ]);
  });

  it("is honestly empty when nothing moved, and takes rows in any order", () => {
    expect(composeDossier(emptyInput({ project: liveProject() })).history).toEqual({
      rows: [],
      empty: true,
      emptyCopy: "No Project Status changes recorded for this Project yet.",
    });

    const shuffled = composeDossier(
      emptyInput({
        project: liveProject(),
        stageHistory: [
          { id: "old", fromStatus: null, toStatus: "lead", changedAt: new Date(2026, 8, 23, 9, 0, 0) },
          { id: "new", fromStatus: "lead", toStatus: "won", changedAt: new Date(2026, 8, 23, 11, 30, 0) },
        ],
      }),
    );
    expect(shuffled.history.rows.map((row) => [row.id, row.held])).toEqual([
      ["new", "30 min so far"],
      ["old", "2 h 30 min"],
    ]);
  });
});

describe("Tags are a vocabulary the dossier can edit (#260, C)", () => {
  it("shows the attached Tags and offers the whole vocabulary to attach or detach", () => {
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        tags: [{ id: "t-2", name: "Priority", color: "#ef4444" }],
        workspaceTags: [
          { id: "t-1", name: "Retainer", color: "#6366f1" },
          { id: "t-2", name: "Priority", color: "#ef4444" },
        ],
      }),
    );

    expect(dossier.identity?.tags).toEqual([{ id: "t-2", name: "Priority", color: "#ef4444" }]);
    expect(dossier.tags.vocabulary.map(({ deleteConsequence: _, ...tag }) => tag)).toEqual([
      { id: "t-2", name: "Priority", color: "#ef4444", attached: true },
      { id: "t-1", name: "Retainer", color: "#6366f1", attached: false },
    ]);
    expect(dossier.tags.vocabulary[0].deleteConsequence).toBe(
      "Priority will be removed from every Project that carries it. This cannot be undone.",
    );
    expect(dossier.tags.emptyCopy).toBe("");
  });

  it("says the vocabulary is empty rather than hiding the control", () => {
    const dossier = composeDossier(emptyInput({ project: liveProject() }));
    expect(dossier.tags.vocabulary).toEqual([]);
    expect(dossier.tags.emptyCopy).toBe("No Tags in this Workspace yet.");
  });
});

describe("A named member can be taken off a Project (#260, C)", () => {
  it("lists the Project's members, not the lead unless they are one, each removable", () => {
    const project = liveProject();
    project.assignee = { id: "user-9", firstName: "Lee", lastName: "Ray", email: "lee@example.com" };
    const dossier = composeDossier(emptyInput({ project }));

    expect(dossier.settings.memberRows.map(({ id, name, self, action }) => ({ id, name, self, action }))).toEqual([
      { id: "user-1", name: "Sam Lee", self: true, action: "Leave" },
      { id: "user-2", name: "Pat Ng", self: false, action: "Remove" },
    ]);
    expect(dossier.settings.memberRows[1].consequence).toBe(
      "Pat Ng will no longer be assigned to this Project. They can be added back from Settings.",
    );
  });

  it("carries whether Documentation is on, so Settings can switch it", () => {
    const project = liveProject();
    expect(composeDossier(emptyInput({ project })).settings.documentationEnabled).toBe(true);
    project.documentationEnabled = 0;
    expect(composeDossier(emptyInput({ project })).settings.documentationEnabled).toBe(false);
  });
});

describe("A Project's Documents can be duplicated and reordered (#260, E)", () => {
  it("names the routes", () => {
    expect(documentDuplicatePath("d-1")).toBe("/api/documents/d-1/duplicate");
    expect(documentsReorderPath("doc-1")).toBe("/api/projects/doc-1/documents/reorder");
  });

  it("moves a Document among its siblings only, by the index the route expects", () => {
    const at = new Date(2026, 8, 22, 9, 0, 0);
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        documents: [
          { id: "a", title: "A", updatedAt: at, parentId: null, position: 0 },
          { id: "child", title: "Child", updatedAt: at, parentId: "a", position: 0 },
          { id: "b", title: "B", updatedAt: at, parentId: null, position: 1 },
          { id: "c", title: "C", updatedAt: at, parentId: null, position: 2 },
        ],
      }),
    );
    const byId = new Map(dossier.documents.rows.map((row) => [row.id, row]));

    expect(byId.get("a")?.order).toEqual({ parentId: null, up: null, down: 1 });
    expect(byId.get("b")?.order).toEqual({ parentId: null, up: 0, down: 2 });
    expect(byId.get("c")?.order).toEqual({ parentId: null, up: 1, down: null });
    expect(byId.get("child")?.order).toEqual({ parentId: "a", up: null, down: null });
  });
});

describe("Register reads and filters by Tag (#260, C)", () => {
  function registerInput(overrides: Partial<ProjectRegisterInput> = {}): ProjectRegisterInput {
    return {
      workspaceName: "Harbor Co",
      filterQuery: "",
      statusFilter: "all",
      selectedId: null,
      tagFilter: "all",
      projects: [
        {
          id: "p-1",
          name: "Ledger",
          clientName: "Northwind",
          projectType: "one_time",
          projectStatus: "active",
          leadName: null,
          budgetPercent: null,
          trackedMtd: "0.0 h",
          visible: true,
          tags: [{ id: "t-1", name: "Retainer" }],
        },
        {
          id: "p-2",
          name: "Audit",
          clientName: null,
          projectType: "internal",
          projectStatus: "active",
          leadName: null,
          budgetPercent: null,
          trackedMtd: "0.0 h",
          visible: true,
          tags: [],
        },
      ],
      ...overrides,
    };
  }

  it("puts each Project's Tags on its row", () => {
    const register = composeProjectRegister(registerInput());
    expect(register.rows.map((row) => row.tags)).toEqual([["Retainer"], []]);
  });

  it("keeps only the Projects carrying the chosen Tag", () => {
    const register = composeProjectRegister(registerInput({ tagFilter: "t-1" }));
    expect(register.rows.map((row) => row.id)).toEqual(["p-1"]);

    const none = composeProjectRegister(registerInput({ tagFilter: "t-9" }));
    expect(none.empty).toBe(true);
    expect(none.emptyCopy).toBe("No Projects match this filter.");
  });
});

describe("A folder can be tidied, not only created (#260, E)", () => {
  function libraryInput(overrides: Partial<LibraryInput> = {}): LibraryInput {
    return {
      now: new Date(2026, 8, 23, 12, 0, 0),
      workspaceName: "Harbor Co",
      folders: [{ id: "f-1", name: "Policies" }],
      documents: [{ id: "d-1", name: "Leave", folderId: "f-1" }],
      expandedFolderIds: [],
      selectedFolderId: "f-1",
      filterQuery: "",
      capabilityMiss: false,
      ownerName: null,
      ...overrides,
    };
  }

  it("names the folder route", () => {
    expect(folderPath("f-1")).toBe("/api/company-document-folders/f-1");
  });

  it("gives the preview the folder it amends, and never counts what the delete cascades to", () => {
    // The route deletes Restricted Documents and Files the register never
    // lists, so a count taken from visible rows would undercount.
    const library = composeLibrary(
      libraryInput({
        documents: [
          { id: "d-1", name: "Leave", folderId: "f-1" },
          { id: "d-2", name: "Payroll", folderId: "f-1", access: "restricted" },
        ],
      }),
    );
    expect(library.preview?.folderId).toBe("f-1");
    expect(library.preview?.name).toBe("Policies");
    expect(library.preview?.deleteConsequence).toBe(
      "Policies and everything filed in it will be deleted, including items you may not be able to see. This cannot be undone.",
    );
    expect(library.preview?.deleteConsequence).not.toMatch(/\d/);
  });
});

describe("an allowed timezone is chosen from a list, not only typed (#260, F)", () => {
  it("suggests the runtime's IANA zones the Workspace does not allow yet", () => {
    const suggestions = timezoneSuggestions(["Europe/Paris"]);
    expect(suggestions).toContain("America/New_York");
    expect(suggestions).not.toContain("Europe/Paris");
    expect([...suggestions].sort()).toEqual(suggestions);
  });

  it("offers the list beside the free-text input it keeps, as the shadcn combobox", () => {
    const page = read("client/src/v2/V2Administration.tsx");
    expect(page).toContain('from "@/components/ui/command"');
    expect(page).toContain("<TimezonePicker");
    expect(page).toContain("timezoneSuggestions(");
  });
});

describe("the v2 screens call what they now offer (#260)", () => {
  const dossierPage = read("client/src/v2/V2Dossier.tsx");
  const documentsPage = read("client/src/v2/V2Documents.tsx");
  const documentPage = read("client/src/v2/V2Document.tsx");
  const blockEditor = read("client/src/components/editor/BlockEditor.tsx");

  it("reads stage history and Tags, and clones, tags, removes and toggles through their routes", () => {
    for (const helper of [
      "projectStageHistoryPath",
      "projectTagsPath",
      "projectTagPath",
      "tagsPath",
      "tagPath",
      "projectClonePath",
      "projectMemberPath",
      "projectDocumentationPath",
      "documentDuplicatePath",
      "documentsReorderPath",
    ]) {
      expect(dossierPage).toContain(`${helper}(`);
    }
  });

  it("confirms a member removal in the shared modal", () => {
    expect(dossierPage).toMatch(/member\.consequence/);
    expect(dossierPage).toContain("Status history");
    expect(dossierPage).not.toContain("Stage history");
  });

  it("edits a Tag's colour as well as its name", () => {
    expect(dossierPage).toMatch(/"PATCH", tagPath\([^)]*\), \{ name, color \}/);
    expect(dossierPage).toContain('type="color"');
  });

  it("attaches a File to a Project note through public object upload", () => {
    expect(dossierPage).toContain("/api/objects/upload-public");
    expect(dossierPage).toMatch(/attachments/);
  });

  it("renames and deletes a folder, confirming the delete in the shared modal", () => {
    expect(documentsPage).toMatch(/"PATCH", folderPath\(/);
    expect(documentsPage).toMatch(/"DELETE", folderPath\(/);
    expect(documentsPage).toContain("@/components/ui/alert-dialog");
  });

  it("attaches a File to a Document, and the editor offers attach only when it works", () => {
    expect(documentPage).toContain("/api/document-attachments");
    expect(documentPage).toContain("onDocumentUpload=");
    expect(blockEditor).toMatch(/\{onDocumentUpload \? \(\s*<Button/);
  });

  it("renders Help Center screenshots in v2 through the shared article components", () => {
    const articles = [
      "TimeTrackingDoc",
      "GettingStartedDoc",
      "FaqTroubleshootingDoc",
      "DesktopAppDoc",
      "AdministrationDoc",
    ];
    for (const article of articles) {
      expect(read(`client/src/pages/help-center/articles/${article}.tsx`)).toContain("HelpScreenshot");
    }
    const helpPage = read("client/src/v2/V2Help.tsx");
    expect(helpPage).toContain("HELP_ARTICLE_COMPONENTS");
    expect(helpPage).toContain('surface="v2"');
    const screenshot = read("client/src/components/help-center/HelpScreenshot.tsx");
    expect(screenshot).toContain("/api/help-center/screenshot-map");
    expect(read("client/src/lib/helpCenterPublicImageUpload.ts")).toContain("/api/objects/upload-public");
  });
});
