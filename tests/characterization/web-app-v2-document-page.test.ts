import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeDocumentEditor,
  documentMetaLine,
  documentNameMissing,
  documentVersion,
  DocumentSaveQueue,
  loadDocument,
  mergeDocumentRecord,
  moveDestinations,
  moveRequest,
  trackDocumentSave,
  type DocumentSaveAnswer,
  type DocumentSaveRequest,
  type DocumentVersion,
} from "../../client/src/v2/documentEditor";
import { composeFileViewer } from "../../client/src/v2/fileViewer";
import { breadcrumbFor } from "../../client/src/v2/presentation";

/**
 * The Document page review (F52, F54-F56, F58, 2026-11-24). Seams:
 * DocumentSaveQueue and the pure helpers beside it, the breadcrumb and File
 * viewer composers, and the source and CSS shape of the page.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const page = read("client/src/v2/V2Document.tsx");
const dialog = read("client/src/v2/V2MoveDocumentDialog.tsx");
const recordLabelSource = read("client/src/v2/useRecordLabel.ts");
const css = read("client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const at = (minute: number) => `2026-11-24T10:${String(minute).padStart(2, "0")}:00.000Z`;
const version = (text: string, minute: number, name = "Policy"): DocumentVersion => ({
  name,
  content: doc(text),
  updatedAt: at(minute),
});

function open(start: DocumentVersion = version("one", 0)) {
  const sent: DocumentSaveRequest[] = [];
  const answers: Array<{ resolve: (answer: DocumentSaveAnswer) => void; reject: (error: Error) => void }> = [];
  const hooks = { onChange: vi.fn(), onSaved: vi.fn(), onConflict: vi.fn(), onError: vi.fn() };
  const queue = new DocumentSaveQueue(start, {
    ...hooks,
    send: (request) => {
      sent.push(request);
      return new Promise((resolve, reject) => answers.push({ resolve, reject }));
    },
  });
  const saved = (index: number, next: DocumentVersion) => answers[index].resolve({ kind: "saved", version: next });
  const refused = (index: number, current: DocumentVersion) => answers[index].resolve({ kind: "conflict", current });
  return { queue, sent, answers, hooks, saved, refused };
}

/** Lets the queue's own promises run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.unstubAllGlobals());

describe("F52: saves are serialized on the version they were typed over", () => {
  it("never has two in flight, and sends the newest text on the answer's updatedAt", async () => {
    const { queue, sent, saved } = open();
    queue.edit({ content: doc("two") });
    queue.save();
    queue.edit({ content: doc("three") });
    queue.save();
    queue.edit({ content: doc("four") });
    const settled = queue.save();
    expect(sent).toEqual([{ content: doc("two"), expectedUpdatedAt: at(0) }]);

    saved(0, version("two", 1));
    await tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ content: doc("four"), expectedUpdatedAt: at(1) });
    expect(queue.state).toBe("saving");

    saved(1, version("four", 2));
    await settled;
    expect(queue.state).toBe("saved");
    expect(queue.dirty).toBe(false);
  });

  it("does not claim Saved over text typed during the save", async () => {
    const { queue, saved } = open();
    queue.edit({ content: doc("two") });
    const settled = queue.save();
    queue.edit({ content: doc("three") });
    saved(0, version("two", 1));
    await settled;
    expect(queue.state).toBe("unsaved");
    expect(queue.dirty).toBe(true);
  });

  it("sends nothing when nothing changed, and keeps the text of a failed save for the next one", async () => {
    const { queue, sent, answers, hooks } = open();
    await queue.save();
    expect(sent).toEqual([]);
    queue.edit({ content: doc("two") });
    const settled = queue.save();
    answers[0].reject(new Error("offline"));
    await settled;
    expect(hooks.onError).toHaveBeenCalledWith(new Error("offline"));
    expect(queue.state).toBe("unsaved");
    queue.save();
    expect(sent[1]).toEqual({ content: doc("two"), expectedUpdatedAt: at(0) });
  });

  it("sends the save a closing editor asked for while one was in flight", async () => {
    const { queue, sent, saved } = open();
    queue.edit({ content: doc("two") });
    trackDocumentSave("doc-1", queue.save());
    queue.edit({ content: doc("last") });
    trackDocumentSave("doc-1", queue.save());

    const fetched = vi.fn(async () => new Response(JSON.stringify({ id: "doc-1", name: "Policy", content: doc("last") })));
    vi.stubGlobal("fetch", fetched);
    const reopened = loadDocument("workspace", "doc-1");
    saved(0, version("two", 1));
    await tick();
    expect(sent[1]).toEqual({ content: doc("last"), expectedUpdatedAt: at(1) });
    // Opening it again waits for that save, so it neither shows the old text nor conflicts with itself.
    expect(fetched).not.toHaveBeenCalled();
    saved(1, version("last", 2));
    expect((await reopened).record?.content).toEqual(doc("last"));
  });
});

describe("F52: a newer version from a refetch", () => {
  it("adopts the baseline and the name when the content is the one the server last returned", async () => {
    const { queue, sent } = open();
    queue.edit({ content: doc("two") });
    expect(queue.observe(version("one", 5, "Renamed"))).toBe("adopted");
    expect(queue.draft).toEqual({ title: "Renamed", content: doc("two") });
    queue.save();
    expect(sent[0]).toEqual({ content: doc("two"), expectedUpdatedAt: at(5) });
  });

  it("keeps a title being typed when it adopts", () => {
    const { queue } = open();
    queue.edit({ title: "Mine" });
    expect(queue.observe(version("one", 5, "Theirs"))).toBe("adopted");
    expect(queue.draft.title).toBe("Mine");
  });

  it("takes new content whole when clean, and leaves it to the save when dirty", () => {
    const clean = open();
    expect(clean.queue.observe(version("theirs", 5, "Renamed"))).toBe("reseeded");
    expect(clean.queue.draft).toEqual({ title: "Renamed", content: doc("theirs") });

    const dirty = open();
    dirty.queue.edit({ content: doc("mine") });
    expect(dirty.queue.observe(version("theirs", 5))).toBe("ignored");
    expect(dirty.queue.draft.content).toEqual(doc("mine"));
    dirty.queue.save();
    expect(dirty.sent[0].expectedUpdatedAt).toBe(at(0));
  });

  it("ignores a read that is not newer, and anything during a save", async () => {
    const { queue, saved } = open(version("one", 5));
    expect(queue.observe(version("stale", 4))).toBe("ignored");
    expect(queue.observe(version("one", 5))).toBe("ignored");
    queue.edit({ content: doc("two") });
    const settled = queue.save();
    expect(queue.observe(version("two", 6))).toBe("ignored");
    saved(0, version("two", 6));
    await settled;
    expect(queue.state).toBe("saved");
  });

  it("adopts a rename seen during a save before the save that follows it", async () => {
    const { queue, sent, saved } = open();
    queue.edit({ content: doc("two") });
    queue.save();
    queue.edit({ content: doc("three") });
    queue.save();
    queue.observe(version("two", 3, "Renamed"));
    saved(0, version("two", 1));
    await tick();
    expect(sent[1]).toEqual({ content: doc("three"), expectedUpdatedAt: at(3) });
  });
});

describe("F52: a refused save", () => {
  it("saves over a rename, a move, or an access change without asking: the text is the same", async () => {
    const { queue, sent, saved, refused, hooks } = open();
    queue.edit({ content: doc("two") });
    const settled = queue.save();
    refused(0, version("one", 3, "Renamed elsewhere"));
    await tick();
    expect(hooks.onConflict).not.toHaveBeenCalled();
    expect(sent[1]).toEqual({ content: doc("two"), expectedUpdatedAt: at(3) });
    saved(1, version("two", 4, "Renamed elsewhere"));
    await settled;
    expect(queue.state).toBe("saved");
    expect(queue.draft.title).toBe("Renamed elsewhere");
  });

  async function conflicted() {
    const opened = open();
    opened.queue.edit({ content: doc("mine") });
    const settled = opened.queue.save();
    opened.queue.edit({ content: doc("mine, more") });
    opened.queue.save();
    opened.refused(0, version("theirs", 4, "Their name"));
    await settled;
    return opened;
  }

  it("stops saving and keeps what is typed", async () => {
    const { queue, sent, hooks } = await conflicted();
    expect(queue.state).toBe("conflict");
    expect(hooks.onConflict).toHaveBeenCalledTimes(1);
    queue.edit({ content: doc("still mine") });
    await queue.save();
    expect(queue.state).toBe("conflict");
    expect(queue.draft.content).toEqual(doc("still mine"));
    expect(sent).toHaveLength(1);
    expect(queue.observe(version("theirs", 5))).toBe("ignored");
  });

  it("loads their version", async () => {
    const { queue, sent } = await conflicted();
    queue.loadTheirs();
    expect(queue.draft).toEqual({ title: "Their name", content: doc("theirs") });
    expect(queue.state).toBe("idle");
    await queue.save();
    expect(sent).toHaveLength(1);
  });

  it("keeps mine over the version it was shown, without taking their name back", async () => {
    const { queue, sent, saved } = await conflicted();
    const settled = queue.keepMine();
    expect(sent[1]).toEqual({ content: doc("mine, more"), expectedUpdatedAt: at(4) });
    saved(1, version("mine, more", 6, "Their name"));
    await settled;
    expect(queue.state).toBe("saved");
    expect(queue.draft.title).toBe("Their name");
  });

  it("says Not saved", () => {
    const model = composeDocumentEditor({
      source: "workspace",
      document: { id: "doc-1", name: "Policy", access: "workspace" },
      missing: false,
      forbidden: false,
      ownerName: null,
      saveState: "conflict",
    });
    expect(model.saveLabel).toBe("Not saved");
    expect(page).toContain('role="alert"');
    expect(page).toContain("Load their version");
    expect(page).toContain("Keep mine");
  });
});

describe("F52: the name", () => {
  it("is sent only when it is typed and different", async () => {
    const { queue, sent, saved, hooks } = open();
    queue.edit({ title: "  " });
    let settled = queue.save();
    expect(sent[0]).toEqual({ content: doc("one"), expectedUpdatedAt: at(0) });
    saved(0, version("one", 1));
    await settled;
    expect(hooks.onSaved).toHaveBeenLastCalledWith(version("one", 1), false);
    expect(queue.draft.title).toBe("  ");
    expect(documentNameMissing(queue.draft.title, queue.storedName)).toBe(true);

    queue.edit({ title: "New name" });
    settled = queue.save();
    expect(sent[1]).toEqual({ name: "New name", content: doc("one"), expectedUpdatedAt: at(1) });
    saved(1, version("one", 2, "New name"));
    await settled;
    expect(hooks.onSaved).toHaveBeenLastCalledWith(version("one", 2, "New name"), true);
    expect(documentNameMissing(queue.draft.title, queue.storedName)).toBe(false);
  });

  it("does not put the sent name back over the one typed since", async () => {
    const { queue, saved } = open();
    queue.edit({ title: "New" });
    const settled = queue.save();
    queue.edit({ title: "Policy" });
    saved(0, version("one", 1, "New"));
    await settled;
    expect(queue.draft.title).toBe("Policy");
  });

  it("asks nothing of a page that never had one", () => {
    expect(documentNameMissing("", "")).toBe(false);
  });
});

describe("F52: the read that opens the editor", () => {
  it("is fresh, and a failed one offers Try again instead of a missing Document", () => {
    expect(page).toMatch(/staleTime: 0,\s*queryFn: \(\) => loadDocument/);
    expect(page).toContain("isFetchedAfterMount");
    expect(page).toContain("const waiting = !opened && (!isFetchedAfterMount || isFetching);");
    expect(page).toContain("const loadFailed = !opened && !waiting && isError;");
    expect(page).toContain("This Document could not be loaded");
    expect(page).toContain("<V2LoadFailed");
    expect(page).not.toMatch(/if \(!res\.ok\) return \[\]/);
  });

  it("gives each Document its own editor", () => {
    expect(page.match(/<V2DocumentEditor key=\{documentId\}/g)).toHaveLength(2);
  });

  it("throws on a failed read and reads the row's version", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    await expect(loadDocument("workspace", "doc-x")).rejects.toThrow();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "p", title: "Page", projectId: "prj", updatedAt: at(3) })));
    const loaded = await loadDocument("project", "p");
    expect(documentVersion(loaded.record!)).toEqual({ name: "Page", content: null, updatedAt: at(3) });
  });

  it("keeps what a save's answer leaves out", () => {
    const merged = mergeDocumentRecord(
      { id: "d", name: "Old", canManageAccess: true, folder: { id: "f", name: "HR" } },
      { id: "d", name: "New", canManageAccess: undefined, folder: undefined },
    );
    expect(merged).toEqual({ id: "d", name: "New", canManageAccess: true, folder: { id: "f", name: "HR" } });
  });
});

describe("F54: move and rename", () => {
  it("lists every Folder by path and keeps the current one even when it is not listed", () => {
    const folders = [
      { id: "a", name: "HR" },
      { id: "b", name: "Leave", parentId: "a" },
    ];
    expect(moveDestinations(folders, { id: "a", name: "HR" })).toEqual([
      { value: "a", label: "HR" },
      { value: "b", label: "HR / Leave" },
    ]);
    expect(moveDestinations(folders, { id: "z", name: "Vault" })[0]).toEqual({ value: "z", label: "Vault" });
  });

  it("sends only what changed, and nothing without a name", () => {
    const base = { folderId: "a", name: "Deck" };
    expect(moveRequest({ ...base, target: "a", nextName: "Deck " })).toBeNull();
    expect(moveRequest({ ...base, target: "b", nextName: "" })).toBeNull();
    expect(moveRequest({ ...base, target: null, nextName: "Deck" })).toEqual({ folderId: null });
    expect(moveRequest({ ...base, target: "b", nextName: "Plan" })).toEqual({ folderId: "b", name: "Plan" });
  });

  it("uses the shared dialog, select and input, and refuses in a Read-only Workspace", () => {
    expect(dialog).toContain("<V2FormDialog");
    expect(dialog).toContain("<V2FilterSelect");
    expect(dialog).toContain("<Input");
    expect(dialog).toContain("readOnlyRefusal");
    expect(dialog).toContain('"File updated" : "Document moved"');
    expect(page).toContain('"Rename or move" : "Move"');
    expect(page).toContain("beforeSave={settleSaves}");
  });
});

describe("F55 and F56", () => {
  it("marks the register stale after every save and reads it again after a new name", () => {
    expect(page).toContain('staleRegister(renamed ? "active" : "none")');
    expect(page).toContain('["/api/company-document-folders"], refetchType');
    expect(page).toContain('["/api/company-documents"], refetchType');
  });

  it("ties a Workspace Document's images and attachments to its readers", () => {
    expect(page).toContain("`/api/company-documents/${documentId}/objects`");
    expect(page.match(/await tieObject\(documentId, path\)/g)).toHaveLength(2);
    expect(page).toContain("if (!uploaded.ok) throw new Error");
    expect(page).toContain('fallback: "Image could not be added."');
  });
});

describe("F58: the Document page reads as a document", () => {
  const now = new Date(2026, 10, 24, 12);

  it("says where it is filed, who added it and when it changed", () => {
    const record = {
      id: "d",
      name: "Policy",
      folderId: "f",
      folder: { id: "f", name: "HR" },
      uploadedBy: { firstName: "Ada", lastName: "King" },
      updatedAt: new Date(2026, 10, 3, 12),
    };
    expect(documentMetaLine(record, now)).toBe("HR · Added by Ada King · Updated 3 Nov");
    expect(documentMetaLine({ ...record, folderId: null, folder: null, updatedAt: new Date(2025, 5, 9, 12) }, now)).toBe(
      "Workspace root · Added by Ada King · Updated 9 Jun 2025",
    );
    expect(documentMetaLine({ ...record, folder: null, uploadedBy: null }, now)).toBe("Updated 3 Nov");
  });

  it("gives a File the same line beside its own", () => {
    const viewer = composeFileViewer({
      source: "workspace",
      documentId: "d",
      name: "Deck",
      fileName: "deck.pdf",
      fileSize: 2048,
      mimeType: "application/pdf",
      access: "workspace",
      filing: "HR · Added by Ada King",
      description: "Kickoff",
    });
    expect(viewer.meta).toBe("deck.pdf · 2 KB · PDF");
    expect(viewer.filing).toBe("HR · Added by Ada King");
    expect(viewer.description).toBe("Kickoff");
  });

  it("ends the breadcrumb on the Document's name", () => {
    const labels = (name?: string) => breadcrumbFor("/documents/doc-1", "Harbor Co", name).map((crumb) => crumb.label);
    expect(labels("Security baseline")).toEqual(["Harbor Co", "Workspace Documents", "Security baseline"]);
    expect(labels()).toEqual(["Harbor Co", "Workspace Documents", "Document"]);
    expect(breadcrumbFor("/files", "Harbor Co", "x").map((crumb) => crumb.label)).toEqual(["Harbor Co", "File"]);
    // The bar's observer must carry the editor's own read: its options can become the query's.
    expect(recordLabelSource).toMatch(/queryFn: \(\) => loadDocument\("workspace", documentId\),\s*enabled: false/);
  });

  it("shows the designed state for a missing Document", () => {
    const model = composeDocumentEditor({
      source: "workspace",
      document: null,
      missing: true,
      forbidden: false,
      ownerName: null,
      saveState: "idle",
    });
    expect(model.emptyTitle).toBe("Document not found");
    expect(model.emptyCopy).toBe("This Document is not in this Workspace, or you cannot access it.");
    expect(page).toContain('testId="v2-document-missing"');
  });

  it("draws one column on one surface, under a page title", () => {
    expect(rule('.df-v2 .df-editor [data-testid="block-editor"]')).toContain("max-width: 800px");
    expect(rule('.df-v2 .df-editor [data-testid="editor-sticky-header"]')).toContain("background: var(--df-card-white)");
    const title = rule('.df-v2 .df-editor input[data-testid="input-document-title"]');
    expect(title).toContain("font-size: var(--df-text-6)");
    expect(title).toContain("font-family: var(--df-font-display)");
    expect(title).toContain("font-weight: 800");
    expect(rule(".df-v2 .df-editor .ProseMirror:focus-visible")).toContain("outline: none");
    expect(rule('.df-v2 .df-editor input[data-testid="input-document-title"]:focus-visible')).toContain("box-shadow: inset");
    expect(rule(".df-workspace-content:has(> .df-editor-page:not(.df-file-viewer))")).toContain("height: 100%");
  });
});
