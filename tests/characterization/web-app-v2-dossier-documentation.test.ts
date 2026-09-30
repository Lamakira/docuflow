import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPageTree, pageAncestorIds, type PageTreeNode } from "../../client/src/lib/pageTree";
import { projectDocumentDossierHref } from "../../client/src/v2/documentEditor";
import {
  breadcrumbFor,
  dossierDocumentHref,
  matchV2Route,
  parseDossierPath,
} from "../../client/src/v2/presentation";

/**
 * The Project Dossier's Documentation tab (#307): v1's page tree beside the
 * editor, one URL per page. Seams: the page tree the tab draws, the Dossier
 * routes, and the tab's compose function.
 */

type Shape = Array<[string, Shape]>;

function shape(nodes: PageTreeNode<{ title: string }>[]): Shape {
  return nodes.map((node) => [node.title, shape(node.children)]);
}

describe("Project Dossier Documentation (#307)", () => {
  it("nests pages under their parent and orders siblings by position", () => {
    const tree = buildPageTree([
      { id: "handover", title: "Handover", parentId: null, position: 2 },
      { id: "scope", title: "Scope", parentId: null, position: 0 },
      { id: "out", title: "Out of scope", parentId: "scope", position: 1 },
      { id: "in", title: "In scope", parentId: "scope", position: 0 },
      // A page whose parent is gone stays reachable at the top level.
      { id: "stray", title: "Stray page", parentId: "deleted", position: 1 },
    ]);

    expect(shape(tree)).toEqual([
      ["Scope", [["In scope", []], ["Out of scope", []]]],
      ["Stray page", []],
      ["Handover", []],
    ]);
  });

  it("names the pages to open, top first, so the open page shows in the tree", () => {
    const pages = [
      { id: "scope", parentId: null },
      { id: "in", parentId: "scope" },
      { id: "detail", parentId: "in" },
      { id: "loop-a", parentId: "loop-b" },
      { id: "loop-b", parentId: "loop-a" },
    ];

    expect(pageAncestorIds(pages, "detail")).toEqual(["scope", "in"]);
    expect(pageAncestorIds(pages, "scope")).toEqual([]);
    expect(pageAncestorIds(pages, "unknown")).toEqual([]);
    expect(pageAncestorIds(pages, "loop-a")).toEqual(["loop-b"]);
  });

  it("gives each page its own URL in the Project Dossier, under the Documentation tab", () => {
    const href = dossierDocumentHref("crm-1", "page-9");
    expect(href).toBe("/projects/crm-1/documents/page-9");
    expect(parseDossierPath(href)).toEqual({ projectId: "crm-1", tab: "documents", documentId: "page-9" });
    expect(parseDossierPath("/projects/crm-1/documents")).toEqual({
      projectId: "crm-1",
      tab: "documents",
      documentId: null,
    });
    // Only the Documentation tab holds pages.
    expect(parseDossierPath("/projects/crm-1/tasks/page-9")).toBeNull();

    expect(matchV2Route(href)).toMatchObject({
      kind: "dossier",
      title: "Documentation",
      projectId: "crm-1",
      tab: "documents",
      documentId: "page-9",
    });
    expect(breadcrumbFor(href, "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "PROJECTS",
      "DOCUMENTATION",
    ]);
  });

  it("sends an old /document link to the page's place in its Project Dossier", () => {
    const projects = [
      { id: "crm-1", project: { id: "doc-project-1" } },
      { id: "crm-2", project: { id: "doc-project-2" } },
    ];

    expect(projectDocumentDossierHref({ id: "page-9", projectId: "doc-project-2" }, projects)).toBe(
      "/projects/crm-2/documents/page-9",
    );
    expect(projectDocumentDossierHref({ id: "page-9", projectId: "doc-project-3" }, projects)).toBeNull();
  });

  it("hides the page tree, as v1's sidebar did, so the open page takes the whole width", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dossier = readFileSync(join(here, "../../client/src/v2/V2Dossier.tsx"), "utf8");
    const tab = dossier.slice(dossier.indexOf("function DossierDocumentation("), dossier.indexOf("function DossierFiles("));
    expect(tab).toContain('data-pages={pagesShown ? "shown" : "hidden"}');
    expect(tab).toContain("aria-expanded={pagesShown}");
    expect(tab).toMatch(/pagesShown \? "Hide pages" : "Show pages"/);
    expect(tab).toMatch(/\{pagesShown \? \(\s*<aside className="df-documentation-tree no-print"/);
    const css = readFileSync(join(here, "../../client/src/v2/tokens.css"), "utf8");
    expect(css).toMatch(/\.df-documentation\[data-pages="hidden"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});
