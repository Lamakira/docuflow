import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeAsk, composeSearch } from "../../client/src/v2/chrome";
import {
  FILE_ZOOM_MAX,
  FILE_ZOOM_MIN,
  composeFileViewer,
  dossierFileDestination,
  fileViewerHref,
  formatFileSize,
  formatZoom,
  parseFileViewerQuery,
  previewKindFor,
  safeBackHref,
  safeLinkHref,
  wordDropsContent,
  wordTagFor,
  zoomFile,
  type FileViewerInput,
} from "../../client/src/v2/fileViewer";
import { HELP_DOC_BLOCKS, docBlockClass } from "../../client/src/v2/helpArticle";
import { composeLibrary } from "../../client/src/v2/library";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";

/**
 * Knowledge under v2 (#216): a File opens with the depth v1 had, and Help
 * article bodies stop being the discarded v1 visual system inside v2 chrome
 * (ADR-0003). Seams: the compose helpers over the existing
 * `/api/company-documents/:id/{stream,download,word-html}` routes and object
 * paths, plus the class map both Help surfaces read. HTTP stays characterized
 * elsewhere. Do not assert hex or millisecond curves.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, "../../", relative), "utf8");

const appSource = read("client/src/v2/V2AuthenticatedApp.tsx");
const documentPageSource = read("client/src/v2/V2Document.tsx");
const fileViewerSource = read("client/src/v2/V2FileViewer.tsx");
const helpPageSource = read("client/src/v2/V2Help.tsx");
const docBlocksSource = read("client/src/components/help-center/DocBlocks.tsx");
const helpScreenshotSource = read("client/src/components/help-center/HelpScreenshot.tsx");
const dossierSource = read("client/src/v2/dossier.ts");
const css = read("client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

const ARTICLE_FILES = [
  "AdministrationDoc",
  "CrmProjectsDoc",
  "DesktopAppDoc",
  "DevicesEntriesDoc",
  "FaqTroubleshootingDoc",
  "GettingStartedDoc",
  "ReleaseNotesDoc",
  "TimeTrackingDoc",
];

/** Class names from the discarded v1 system — none of them belong in v2 chrome. */
const V1_TOKENS = [
  "text-muted-foreground",
  "text-foreground",
  "bg-muted",
  "border-border",
  "rounded-xl",
  "shadow-sm",
  "ring-1",
  "dark:",
  "space-y-",
];

const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function workspaceFile(overrides: Partial<FileViewerInput> = {}): FileViewerInput {
  return {
    source: "workspace",
    documentId: "doc-1",
    name: "Kickoff deck",
    fileName: "kickoff.pdf",
    mimeType: "application/pdf",
    fileSize: 1_258_291,
    access: "workspace",
    ...overrides,
  };
}

describe("A File opens with a preview, not a dead end (#216)", () => {
  it("reads the kind of preview from the mime type, and from the file name when the type is missing", () => {
    expect(previewKindFor({ mimeType: "image/png", fileName: "shot.png" })).toBe("image");
    expect(previewKindFor({ mimeType: "application/pdf", fileName: "scope.pdf" })).toBe("pdf");
    expect(previewKindFor({ mimeType: WORD_MIME, fileName: "policy.docx" })).toBe("word");
    expect(previewKindFor({ mimeType: "application/msword", fileName: "policy.doc" })).toBe("word");
    expect(previewKindFor({ mimeType: "text/plain", fileName: "notes.txt" })).toBe("text");
    expect(previewKindFor({ mimeType: "application/json", fileName: "export.json" })).toBe("text");

    // An upload that never carried a mime type still has its name.
    expect(previewKindFor({ mimeType: null, fileName: "scope.PDF" })).toBe("pdf");
    expect(previewKindFor({ mimeType: null, fileName: "policy.docx" })).toBe("word");
    expect(previewKindFor({ mimeType: null, fileName: "diagram.webp" })).toBe("image");

    expect(previewKindFor({ mimeType: "application/zip", fileName: "bundle.zip" })).toBe("none");
    expect(previewKindFor({ mimeType: null, fileName: null })).toBe("none");
  });

  it("previews a Workspace File through the stream route it already has", () => {
    const pdf = composeFileViewer(workspaceFile());
    expect(pdf.missing).toBe(false);
    expect(pdf.preview).toBe("pdf");
    expect(pdf.streamHref).toBe("/api/company-documents/doc-1/stream");
    expect(pdf.downloadHref).toBe("/api/company-documents/doc-1/download");
    expect(pdf.zoomable).toBe(true);
    expect(pdf.backHref).toBe("/documents");
    expect(pdf.backLabel).toBe("Workspace Documents");
    expect(pdf.title).toBe("Kickoff deck");
    expect(pdf.fileName).toBe("kickoff.pdf");
    expect(pdf.meta).toContain("kickoff.pdf");
    expect(pdf.meta).toContain("1.2 MB");

    const image = composeFileViewer(workspaceFile({ mimeType: "image/png", fileName: "shot.png" }));
    expect(image.preview).toBe("image");
    expect(image.zoomable).toBe(false);
    expect(image.streamHref).toBe("/api/company-documents/doc-1/stream");

    const word = composeFileViewer(workspaceFile({ mimeType: WORD_MIME, fileName: "policy.docx" }));
    expect(word.preview).toBe("word");
    expect(word.wordHtmlHref).toBe("/api/company-documents/doc-1/word-html");
    expect(word.downloadHref).toBe("/api/company-documents/doc-1/download");
  });

  it("says so honestly when a File has no preview, and still offers the download", () => {
    const zip = composeFileViewer(workspaceFile({ mimeType: "application/zip", fileName: "bundle.zip" }));
    expect(zip.preview).toBe("none");
    expect(zip.emptyCopy).toMatch(/download/i);
    expect(zip.downloadHref).toBe("/api/company-documents/doc-1/download");
    expect(zip.missing).toBe(false);

    // No conversion route exists for an object path, so a Word attachment is a
    // download rather than a preview that would silently render nothing.
    const attachment = composeFileViewer({
      source: "object",
      name: "Policy.docx",
      fileName: "Policy.docx",
      mimeType: WORD_MIME,
      objectPath: "/public-objects/uploads/policy.docx",
      backHref: "/projects/prj-1/files",
    });
    expect(attachment.preview).toBe("none");
    expect(attachment.wordHtmlHref).toBeNull();
    expect(attachment.downloadHref).toBe("/public-objects/uploads/policy.docx");
    expect(attachment.emptyCopy).toMatch(/download/i);
  });

  it("previews a Project File from the object path the attachment carries", () => {
    const viewer = composeFileViewer({
      source: "object",
      name: "Kickoff deck.pdf",
      fileName: "Kickoff deck.pdf",
      mimeType: null,
      objectPath: "/public-objects/uploads/kickoff.pdf",
      backHref: "/projects/prj-1/files",
    });
    expect(viewer.preview).toBe("pdf");
    expect(viewer.streamHref).toBe("/public-objects/uploads/kickoff.pdf");
    expect(viewer.downloadHref).toBe("/public-objects/uploads/kickoff.pdf");
    expect(viewer.backHref).toBe("/projects/prj-1/files");
    expect(viewer.backLabel).toBe("Project");
  });

  it("refuses a File it has no object to read", () => {
    const viewer = composeFileViewer({ source: "object", name: "Orphan.pdf", objectPath: null });
    expect(viewer.missing).toBe(true);
    expect(viewer.streamHref).toBeNull();
    expect(viewer.downloadHref).toBeNull();
    expect(viewer.emptyCopy).toMatch(/not in this Workspace|cannot access/i);
  });

  it("formats a file size a person reads, not a byte count", () => {
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(null)).toBe("");
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1_258_291)).toBe("1.2 MB");
  });
});

describe("v1 File routes still land in v2 (#216)", () => {
  it("keeps /company-documents/:id/view and /company-documents/:id/edit inside v2 chrome", () => {
    expect(matchV2Route("/company-documents/doc-1/view")).toMatchObject({
      kind: "document-editor",
      documentId: "doc-1",
      source: "workspace",
    });
    expect(matchV2Route("/company-documents/doc-1/edit")).toMatchObject({
      kind: "document-editor",
      documentId: "doc-1",
    });
    expect(navIdForPath("/company-documents/doc-1/view")).toBe("documents");
    expect(appSource).toMatch(/path="\/company-documents\/:id\/view"/);

    // The v1 viewer page is not what answers that route in v2.
    expect(appSource).not.toContain("FileViewerPage");
    expect(documentPageSource).toContain("V2FileViewer");
    expect(documentPageSource).toContain("composeFileViewer");
    // Only a Workspace Document has the stream and conversion routes.
    expect(documentPageSource).toMatch(/source === "project" \? "object" : "workspace"/);
  });

  it("opens a Project File in the v2 viewer instead of a raw object tab", () => {
    expect(matchV2Route("/files")).toMatchObject({ kind: "file-viewer", href: "/files" });
    expect(matchV2Route("/files?src=%2Fobjects%2Fx")).toMatchObject({ kind: "file-viewer" });
    expect(breadcrumbFor("/files", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "FILE",
    ]);
    expect(appSource).toMatch(/path="\/files"/);
    expect(appSource).toContain("V2FilePage");

    const attachment = dossierFileDestination({
      href: "/public-objects/uploads/kickoff.pdf",
      name: "Kickoff deck.pdf",
      backHref: "/projects/prj-1/files",
    });
    expect(attachment.target).toBe("app");
    expect(attachment.href.startsWith("/files?")).toBe(true);

    const parsed = parseFileViewerQuery(attachment.href.slice(attachment.href.indexOf("?")));
    expect(parsed.src).toBe("/public-objects/uploads/kickoff.pdf");
    expect(parsed.name).toBe("Kickoff deck.pdf");
    expect(parsed.backHref).toBe("/projects/prj-1/files");

    // A link out of the app is still a link out: only object paths are ours.
    expect(
      dossierFileDestination({ href: "https://example.com/deck.pdf", name: "deck.pdf", backHref: "/projects/prj-1/files" }),
    ).toMatchObject({ target: "file", href: "https://example.com/deck.pdf" });
    expect(dossierFileDestination({ name: "Orphan.pdf", backHref: "/projects/prj-1/files" })).toMatchObject({
      target: "none",
      href: "",
    });
    expect(dossierSource).toContain("dossierFileDestination");
  });

  it("never follows a Back or source parameter off this app", () => {
    expect(safeBackHref("/projects/prj-1/files")).toBe("/projects/prj-1/files");
    expect(safeBackHref("//evil.example.com")).toBe("/documents");
    expect(safeBackHref("https://evil.example.com")).toBe("/documents");
    expect(safeBackHref(null)).toBe("/documents");

    expect(parseFileViewerQuery("?src=https%3A%2F%2Fevil.example.com%2Fx.pdf").src).toBeNull();
    expect(parseFileViewerQuery("?src=%2Fetc%2Fpasswd").src).toBeNull();
    expect(parseFileViewerQuery("?src=%2Fobjects%2Fuploads%2Fa.pdf").src).toBe("/objects/uploads/a.pdf");
    expect(parseFileViewerQuery("").src).toBeNull();
  });
});

describe("A Word preview renders the document, never what it carried (#216)", () => {
  it("keeps an allowlist of block tags and drops everything else", () => {
    expect(wordTagFor("p")).toBe("p");
    expect(wordTagFor("H1")).toBe("h2");
    expect(wordTagFor("h2")).toBe("h3");
    expect(wordTagFor("ul")).toBe("ul");
    expect(wordTagFor("li")).toBe("li");
    expect(wordTagFor("strong")).toBe("strong");
    expect(wordTagFor("a")).toBe("a");

    expect(wordTagFor("script")).toBeNull();
    expect(wordTagFor("iframe")).toBeNull();
    expect(wordTagFor("style")).toBeNull();
    expect(wordTagFor("object")).toBeNull();

    // A tag that is merely unknown keeps its text; these take theirs with them.
    expect(wordDropsContent("script")).toBe(true);
    expect(wordDropsContent("style")).toBe(true);
    expect(wordDropsContent("svg")).toBe(true);
    expect(wordDropsContent("span")).toBe(false);
  });

  it("keeps a link only when its scheme is one a document may carry", () => {
    expect(safeLinkHref("https://example.com/policy")).toBe("https://example.com/policy");
    expect(safeLinkHref("/objects/uploads/a.pdf")).toBe("/objects/uploads/a.pdf");
    expect(safeLinkHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");

    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref("JavaScript:alert(1)")).toBeNull();
    expect(safeLinkHref("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeLinkHref(null)).toBeNull();
  });

  it("builds the preview as elements, never by writing the converted HTML into the page", () => {
    expect(fileViewerSource).not.toContain("dangerouslySetInnerHTML");
    expect(fileViewerSource).toContain("wordTagFor");
    expect(fileViewerSource).toContain("safeLinkHref");
  });
});

describe("A File is read with the session that is allowed to read it (#216)", () => {
  it("never reaches a File through an element the bearer token cannot sign", () => {
    // `/api/*` takes an Authorization header, which only the wrapped `fetch`
    // attaches (client/src/lib/identitySession.ts). An `<img src>` or a plain
    // download link would reach the stream route signed out.
    expect(fileViewerSource).not.toMatch(/<img[^>]*src=\{(viewer\.)?streamHref/);
    expect(fileViewerSource).not.toMatch(/<a[^>]*href=\{viewer\.downloadHref/);
    expect(fileViewerSource).toContain("createObjectURL");
    expect(fileViewerSource).toContain("revokeObjectURL");

    const fetches = fileViewerSource.match(/fetch\(/g) ?? [];
    expect(fetches.length).toBeGreaterThanOrEqual(4);
    expect(fileViewerSource.match(/credentials: "include"/g) ?? []).toHaveLength(fetches.length);
  });
});

describe("File viewer zoom is a control, not an animation (#216)", () => {
  it("steps zoom between honest bounds", () => {
    expect(zoomFile(1, "in")).toBeCloseTo(1.25);
    expect(zoomFile(1, "out")).toBeCloseTo(0.75);
    expect(zoomFile(FILE_ZOOM_MAX, "in")).toBe(FILE_ZOOM_MAX);
    expect(zoomFile(FILE_ZOOM_MIN, "out")).toBe(FILE_ZOOM_MIN);
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(1.25)).toBe("125%");
  });

  it("does not animate the page under a zoom", () => {
    const zoom = motionForSurface("file-viewer-zoom");
    expect(zoom.enterExit).toBe("none");
    expect(zoom.movement).toBe("none");
    expect(zoom.keepOpacity).toBe(true);

    expect(rule(".df-file-page")).toMatch(/animation:\s*none/);
    expect(rule(".df-file-page")).not.toMatch(/transition/);
    expect(fileViewerSource).toContain("zoomFile");
  });
});

describe("Help article bodies render on v2 tokens (#216, ADR-0003)", () => {
  it("gives every article block a v2 class that carries no v1 visual system", () => {
    for (const block of HELP_DOC_BLOCKS) {
      const v2 = docBlockClass(block, "v2");
      expect(v2, block).toMatch(/^df-doc-/);
      for (const token of V1_TOKENS) {
        expect(v2, `${block} carries ${token}`).not.toContain(token);
      }
      for (const name of v2.split(" ")) {
        expect(() => rule(`.${name}`), `${name} has no rule`).not.toThrow();
      }
    }

    expect(docBlockClass("lead", "v2", "caution")).toContain("df-doc-lead-caution");
    expect(docBlockClass("callout", "v2", "admin")).toContain("df-doc-callout-admin");
  });

  it("leaves the flag-off Help Center on the system it already had", () => {
    expect(docBlockClass("p", "v1")).toBe("");
    expect(docBlockClass("sectionBody", "v1")).toContain("text-muted-foreground");
    expect(docBlockClass("strong", "v1")).toContain("text-foreground");
    expect(docBlockClass("code", "v1")).toContain("bg-muted");
  });

  it("reads the surface from the page that renders the article, and defaults to v1", () => {
    expect(helpPageSource).toContain("HelpSurfaceProvider");
    expect(helpPageSource).toMatch(/surface="v2"/);
    expect(docBlocksSource).toContain("useHelpSurface");
    expect(docBlocksSource).toContain("docBlockClass");
    expect(helpScreenshotSource).toContain("docBlockClass");

    // Every class an article block wears now comes from the map, so the two
    // surfaces cannot drift apart in the markup.
    expect(docBlocksSource).not.toMatch(/className="[^"{]/);
  });

  it("leaves no v1 class name in an article body", () => {
    for (const name of ARTICLE_FILES) {
      const source = read(`client/src/pages/help-center/articles/${name}.tsx`);
      expect(source, name).not.toMatch(/className=/);
      expect(source, name).not.toMatch(/<(strong|code|div)[\s>]/);
    }
  });

  it("keeps the article open on opacity, as #194 decided", () => {
    const article = motionForSurface("help-article");
    expect(article.enterExit).toBe("standard");
    expect(article.movement).toBe("none");
    expect(rule('.df-help-article[data-motion="standard"]')).toMatch(/opacity/);
    expect(rule('.df-help-article[data-motion="standard"]')).not.toMatch(/translate/);
  });
});

describe("Document Access still hides restricted Knowledge (#216)", () => {
  const restricted = {
    id: "doc-secret",
    name: "Payroll 2026",
    access: "restricted",
    storagePath: "/objects/uploads/payroll.pdf",
    fileName: "payroll.pdf",
  };

  it("hides a restricted File from the library, from search, and from Ask", () => {
    const library = composeLibrary({
      now: new Date("2026-09-15T12:00:00.000Z"),
      workspaceName: "Harbor Co",
      folders: [],
      documents: [restricted, { id: "doc-open", name: "Handbook", access: "workspace" }],
      expandedFolderIds: [],
      selectedFolderId: null,
      filterQuery: "",
      capabilityMiss: false,
      ownerName: "Sam Lee",
    });
    expect(JSON.stringify(library.rows)).not.toContain("Payroll");
    expect(library.rows).toHaveLength(1);

    const search = composeSearch({
      query: "payroll",
      searchHits: [],
      workspaceDocuments: [restricted, { id: "doc-open", name: "Handbook", access: "workspace" }],
      folders: [],
      accessFact: { filteredByAccess: true, restrictedHidden: 1 },
    });
    expect(JSON.stringify(search.rows)).not.toContain("Payroll");
    expect(search.footer).toContain("RESTRICTED");

    const ask = composeAsk({
      messages: [
        {
          role: "assistant",
          content: "The handbook covers leave.",
          citations: [
            { id: "doc-secret", title: "Payroll 2026", kind: "workspace-document", access: "restricted" },
            { id: "doc-open", title: "Handbook", kind: "workspace-document", access: "workspace" },
          ],
        },
      ],
    });
    expect(JSON.stringify(ask.messages[0].sources)).not.toContain("Payroll");
  });

  it("refuses to preview a restricted File even when its id is typed in", () => {
    const viewer = composeFileViewer(workspaceFile({ access: "restricted" }));
    expect(viewer.missing).toBe(true);
    expect(viewer.preview).toBe("none");
    expect(viewer.streamHref).toBeNull();
    expect(viewer.downloadHref).toBeNull();
  });
});

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}
