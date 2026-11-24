import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeDocumentEditor,
  documentOwnerKey,
  isSaleDocumentOwner,
  loadDocumentOwner,
  mergeDocumentRecord,
  projectDocumentDossierHref,
  projectDocumentMetaLine,
  toDocumentRecord,
} from "../../client/src/v2/documentEditor";
import { composeDossier, dossierRedirect, type DossierInput } from "../../client/src/v2/dossier";
import { composeFileViewer } from "../../client/src/v2/fileViewer";
import { composeOpportunityDocuments } from "../../client/src/v2/opportunities";
import { breadcrumbFor, navIdForPath } from "../../client/src/v2/presentation";

/**
 * Opening a Project Document (F60, F61, F63, 2026-11-24). Seams: the owner
 * rules and composers, the Dossier's, and the source shape of the pages.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const page = read("client/src/v2/V2Document.tsx");
const dossierSource = read("client/src/v2/V2Dossier.tsx");
const opportunitiesSource = read("client/src/v2/V2Opportunities.tsx");
const commandBar = read("client/src/v2/V2CommandBar.tsx");

const delivery = { id: "crm-won", projectType: "one_time", status: "won_in_progress", isDocumentationOnly: 0 };
const documentationOnly = { id: "crm-doc", projectType: "one_time", status: "lead", isDocumentationOnly: 1 };
const sales = ["lead", "follow_up", "lost"].map((status) => ({ id: "crm-sale", projectType: "one_time", status }));

afterEach(() => vi.unstubAllGlobals());

describe("F60: the server decides who opens a Project Document", () => {
  it("opens delivery work and documentation-only Projects in the Dossier, a sale or an unknown owner on its own page", () => {
    expect(projectDocumentDossierHref({ id: "p" }, delivery)).toBe("/projects/crm-won/documents/p");
    expect(projectDocumentDossierHref({ id: "p" }, documentationOnly)).toBe("/projects/crm-doc/documents/p");
    for (const sale of sales) {
      expect(projectDocumentDossierHref({ id: "p" }, sale)).toBeNull();
      expect(isSaleDocumentOwner(sale)).toBe(true);
    }
    expect(projectDocumentDossierHref({ id: "p" }, null)).toBeNull();
    expect(isSaleDocumentOwner(null)).toBe(false);
    expect(isSaleDocumentOwner(undefined)).toBe(false);
    expect(isSaleDocumentOwner(documentationOnly)).toBe(false);
  });

  it("reads the owner from its own route: 404 is no owner, any other failure throws", async () => {
    const fetched = vi.fn(async () => new Response(JSON.stringify(delivery)));
    vi.stubGlobal("fetch", fetched);
    expect(await loadDocumentOwner("prj")).toEqual(delivery);
    expect(fetched).toHaveBeenCalledWith("/api/crm/projects/by-project/prj", { credentials: "include" });
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    expect(await loadDocumentOwner("prj")).toBeNull();
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    await expect(loadDocumentOwner("prj")).rejects.toThrow();
    // Any CRM Project write stales it.
    expect(documentOwnerKey("prj")[0]).toBe("/api/crm/projects");
  });

  it("has no access check of its own, and offers Try again when the owner cannot be read", () => {
    expect(page).not.toContain("pageSize=500");
    expect(page).not.toContain("projectVisibleTo");
    expect(page).not.toContain("assigned");
    expect(page).toContain("(ownerFailed && owner === undefined)");
    expect(page).toContain("onRetry={() => (isError ? refetch() : refetchOwner())}");
  });
});

describe("F61: a sale's Documents", () => {
  const base = { source: "project" as const, missing: false, forbidden: false, ownerName: null, saveState: "idle" as const };
  const document = { id: "p", name: "Scope", projectId: "prj" };

  it("open editable, with the way back to the Opportunity", () => {
    const opportunity = { id: "crm-sale", name: "Fleet telemetry audit" };
    const model = composeDocumentEditor({ ...base, document, opportunity });
    expect(model).toMatchObject({
      mode: "editor",
      title: "Scope",
      backHref: "/opportunities/crm-sale",
      backLabel: "Fleet telemetry audit",
    });
    expect(composeDocumentEditor({ ...base, document, opportunity: { id: "crm-sale", name: null } }).backLabel).toBe("Opportunity");
    expect(composeDocumentEditor({ ...base, document }).backHref).toBe("/project-documentation");
  });

  it("say their Opportunity, who added them and when they changed", () => {
    const record = toDocumentRecord("project", {
      id: "p",
      title: "Scope",
      projectId: "prj",
      createdBy: { firstName: "Ada", lastName: "King" },
      updatedAt: new Date(2026, 10, 3, 12),
    });
    const now = new Date(2026, 10, 24, 12);
    expect(projectDocumentMetaLine(record, { id: "o", name: "Fleet" }, now)).toBe("Fleet · Added by Ada King · Updated 3 Nov");
    expect(projectDocumentMetaLine({ ...record, uploadedBy: null }, null, now)).toBe("Updated 3 Nov");
    // A save answers without its creator.
    const saved = mergeDocumentRecord(record, toDocumentRecord("project", { id: "p", title: "Scope 2", projectId: "prj" }));
    expect(saved).toMatchObject({ name: "Scope 2", uploadedBy: { firstName: "Ada" } });
  });

  it("file under Opportunities in the breadcrumb", () => {
    expect(breadcrumbFor("/document/p", "DocuFlow", "Scope", "opportunities")).toEqual([
      { label: "DocuFlow", href: "/" },
      { label: "Opportunities", href: "/opportunities" },
      { label: "Scope" },
    ]);
    expect(breadcrumbFor("/document/p", "DocuFlow").map((crumb) => crumb.label)).toEqual([
      "DocuFlow",
      "Project Documentation",
      "Document",
    ]);
    expect(navIdForPath("/document/p", "opportunities")).toBe("opportunities");
    expect(navIdForPath("/document/p")).toBe("project-documentation");
    expect(navIdForPath("/people", "opportunities")).toBe("people");
    expect(commandBar).toContain("breadcrumbFor(location, workspaceName, recordLabel, useRecordRoot(location))");
  });

  it("are reached from a Dossier address that names one", () => {
    expect(dossierRedirect(sales[0], { tab: "documents", documentId: "p" })).toBe("/document/p");
    expect(dossierRedirect(sales[0], { tab: "documents", documentId: null })).toBe("/opportunities/crm-sale");
    expect(dossierRedirect(delivery, { tab: "documents", documentId: "p" })).toBeNull();
  });

  it("are listed on the Opportunity record, pages under their parent, then Files", () => {
    const rows = composeOpportunityDocuments({
      opportunityId: "crm-sale",
      projectId: "prj",
      documents: [
        { id: "b", title: "Notes", parentId: null, position: 1, updatedAt: new Date(2026, 8, 29, 12) },
        { id: "a1", title: "In scope", parentId: "a", position: 0 },
        { id: "a", title: "Scope", parentId: null, position: 0 },
      ],
      files: [{ id: "f", name: "Contract", createdAt: new Date(2025, 5, 9, 12) }],
    });
    expect(rows.map((row) => [row.kind, row.title, row.depth, row.date])).toEqual([
      ["document", "Scope", 0, "-"],
      ["document", "In scope", 1, "-"],
      ["document", "Notes", 0, "29 Sep 2026"],
      ["file", "Contract", 0, "9 Jun 2025"],
    ]);
    expect(rows[0].href).toBe("/document/a");
    expect(new URLSearchParams(rows[3].href.split("?")[1]).get("back")).toBe("/opportunities/crm-sale");
    expect(composeFileViewer({ source: "object", name: "Contract", backHref: "/opportunities/crm-sale" }).backLabel).toBe(
      "Opportunity",
    );
    expect(composeOpportunityDocuments({ opportunityId: "o", projectId: "p", documents: [], files: [] })).toEqual([]);
  });

  it("show no card while there is none, a failure only over what was listed, and nothing to create", () => {
    const card = opportunitiesSource.slice(
      opportunitiesSource.indexOf("function OpportunityDocumentsCard("),
      opportunitiesSource.indexOf("type NoteComposer ="),
    );
    expect(card).toContain("if (rows.length === 0) return null;");
    expect(card.indexOf("return null;")).toBeLessThan(card.indexOf("documents.isError || files.isError"));
    expect(card).toContain("Try again");
    expect(card).not.toMatch(/New |Upload/);
    expect(opportunitiesSource).toContain("row.project?.id && !isDeliveryProject(row)");
  });
});

describe("F60: the Dossier of a documentation-only Project", () => {
  function input(overrides: Partial<DossierInput> = {}): DossierInput {
    return {
      now: new Date(2026, 10, 24, 12),
      currentUserId: "user-1",
      tab: "documents",
      project: {
        id: "crm-doc",
        projectStatus: "planned",
        status: "lead",
        projectType: "one_time",
        budgetedHours: null,
        isDocumentationOnly: 1,
        documentationEnabled: 1,
        project: { id: "prj", name: "Handbook" },
      },
      tasks: [],
      documents: [{ id: "p", title: "Scope", updatedAt: null }],
      dailyUpdate: null,
      dailyUpdateCapabilityMiss: false,
      ownerName: null,
      monthSeconds: 0,
      screenshots: [],
      users: [],
      trackingTaskId: null,
      clientActiveProjectCount: 0,
      timeEntries: [],
      dailyUpdates: [],
      files: [],
      projectFileCount: 2,
      reminders: [],
      notes: [],
      stageHistory: [],
      tags: [],
      workspaceTags: [],
      ...overrides,
    };
  }

  it("says what it is, on three tabs with their counts", () => {
    const dossier = composeDossier(input());
    expect(dossier.documentationOnly).toBe(true);
    expect(dossier.identity?.kindLabel).toBe("DOCUMENTATION");
    expect(dossier.tabs.map((tab) => [tab.label, tab.count])).toEqual([
      ["Documentation", "1"],
      ["Files", "2"],
      ["Settings", null],
    ]);
    const base = input();
    const usual = composeDossier({ ...base, project: { ...base.project!, isDocumentationOnly: 0 } });
    expect(usual.documentationOnly).toBe(false);
    expect(usual.tabs).toHaveLength(10);
  });

  it("opens on Documentation whatever the tab asked for", () => {
    for (const tab of ["overview", "tasks", "time", "notes"] as const) {
      expect(dossierRedirect(documentationOnly, { tab })).toBe("/projects/crm-doc/documents");
    }
    for (const tab of ["documents", "files", "settings"] as const) {
      expect(dossierRedirect(documentationOnly, { tab })).toBeNull();
    }
    expect(dossierRedirect(delivery, { tab: "overview" })).toBeNull();
  });

  it("never points at the Notes tab it does not have", () => {
    const base = input({ tab: "files" });
    const off = composeDossier({ ...base, project: { ...base.project!, documentationEnabled: 0 } });
    expect(off.files.emptyState.action).toMatchObject({ href: "/projects/crm-doc/settings" });
    expect(composeDossier(base).files.emptyState.action).toEqual({ kind: "compose", label: "Upload File" });
  });

  it("draws no status, budget, Timer or Task, and offers Link to a Project to an Owner or Administrator", () => {
    expect(dossierSource).toContain("{dossier.documentationOnly ? null : dossier.identity.statusMovable ? (");
    expect(dossierSource).toContain("{dossier.identity && !dossier.documentationOnly ? (");
    const linked = dossierSource.slice(
      dossierSource.indexOf(") : dossier.documentationOnly && dossier.settings.canDelete ? ("),
      dossierSource.indexOf('<nav className="df-tabs"'),
    );
    expect(linked).toContain("Link to a Project");
    expect(linked).not.toContain("Start Timer");
    expect(dossierSource).toContain("navigate(`${projectHref(targetCrmId)}/documents`, { replace: true })");
  });

  it("files under Project Documentation in the breadcrumb", () => {
    expect(breadcrumbFor("/projects/crm-doc/documents", "DocuFlow", "Handbook", "project-documentation")).toEqual([
      { label: "DocuFlow", href: "/" },
      { label: "Project Documentation", href: "/project-documentation" },
      { label: "Handbook" },
    ]);
    expect(navIdForPath("/projects/crm-doc", "project-documentation")).toBe("project-documentation");
  });
});

describe("F63: Project Documentation reads what changed", () => {
  it("goes stale after a save, a rename, and every write of the page tree", () => {
    expect(page).toContain('staleDocumentation(renamed ? "active" : "none")');
    expect(page).toContain('["/api/projects/documentable"], refetchType');
    expect(dossierSource).toContain("if (data.projectName !== undefined) staleDocumentation();");
    expect(dossierSource).toMatch(/success: \(message\) => \{\s*staleDocumentation\(\);/);
  });

  it("keeps a new Document's name within 500 characters", () => {
    expect(dossierSource).toMatch(/value=\{documentName\}\s*maxLength=\{500\}/);
  });
});
