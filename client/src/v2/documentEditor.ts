import { isReadableDocument } from "@shared/documentAccess";
import { isDeliveryProject } from "@shared/projectLifecycle";
import { chromeRefusal } from "./chrome";
import { MONTHS } from "./dates";
import { documentHref, folderChoices, type FolderChoice, type LibraryFolder, type LibraryPerson } from "./library";
import { opportunityHref } from "./opportunities";
import { dossierDocumentHref } from "./presentation";
import { memberName } from "./today";

export { projectDocumentHref } from "./library";

/** The CRM Project that owns a Project Document's Project, as `by-project` answers it (F60). */
export type DocumentOwner = {
  id: string;
  isDocumentationOnly?: number | null;
  projectType?: string | null;
  status?: string | null;
};

/**
 * Where an old `/document/:id` link to a Project Document opens now (#307):
 * the page's place in its Project Dossier. Null for a sale's Document, which
 * has no Dossier (F61), and while no owner is known.
 */
export function projectDocumentDossierHref(document: { id: string }, owner: DocumentOwner | null | undefined): string | null {
  return owner && isDeliveryProject(owner) ? dossierDocumentHref(owner.id, document.id) : null;
}

/** The owner is a sale: its Documents open on their own page (F61). */
export function isSaleDocumentOwner(owner: DocumentOwner | null | undefined): owner is DocumentOwner {
  return Boolean(owner) && !isDeliveryProject(owner!);
}

/** Under the CRM Projects prefix, so winning a sale or any other Project write reads it again. */
export function documentOwnerKey(projectId: string) {
  return ["/api/crm/projects", "by-project", projectId];
}

/** Null when no CRM Project owns it: the Document still opens, since its own read already passed. */
export async function loadDocumentOwner(projectId: string): Promise<DocumentOwner | null> {
  const res = await fetch(`/api/crm/projects/by-project/${projectId}`, { credentials: "include" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch Project");
  return res.json();
}

/** What a sale's Document says of its Opportunity; the name is null until it loads. */
export type DocumentOpportunity = { id: string; name: string | null };

export type DocumentEditorSource = "workspace" | "project";

export type DocumentEditorSaveState = "idle" | "unsaved" | "saving" | "saved" | "conflict";

export type DocumentEditorRecord = {
  id: string;
  name: string;
  content?: unknown;
  storagePath?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  access?: string | null;
  effectiveAccess?: string | null;
  /** Whether this reader may open Manage access: the Document's owner or an Administrator (#278). */
  canManageAccess?: boolean;
  projectId?: string | null;
  folderId?: string | null;
  folder?: { id: string; name: string } | null;
  uploadedBy?: LibraryPerson | null;
  description?: string | null;
  updatedAt?: Date | string | null;
};

export type DocumentEditorInput = {
  source: DocumentEditorSource;
  document: DocumentEditorRecord | null;
  missing: boolean;
  forbidden: boolean;
  ownerName: string | null;
  saveState: DocumentEditorSaveState;
  assigned?: boolean;
  /** The sale a Project Document belongs to (F61). */
  opportunity?: DocumentOpportunity | null;
};

export type DocumentEditorMode = "missing" | "editor" | "viewer";

export type DocumentEditorModel = {
  missing: boolean;
  mode: DocumentEditorMode;
  title: string | null;
  saveLabel: string;
  saveState: DocumentEditorSaveState;
  refusal: string | null;
  /** Headline of the designed empty state when the Document is not there (F58). */
  emptyTitle: string;
  emptyCopy: string;
  backHref: string;
  backLabel: string;
};

const MISSING_TITLE = "Document not found";
const VIEW_WORKSPACE_DOCUMENTS_CAPABILITY = "View Workspace Documents";
const VIEW_PROJECT_DOCUMENTS_CAPABILITY = "View Project Documents";

export function workspaceDocumentHref(id: string): string {
  return documentHref(id);
}

/** Where Back goes from a Document: known before any fetch, so the wait can show it. */
export function documentBack(
  source: DocumentEditorSource,
  opportunity?: DocumentOpportunity | null,
): { backHref: string; backLabel: string } {
  if (opportunity) return { backHref: opportunityHref(opportunity.id), backLabel: opportunity.name || "Opportunity" };
  return source === "project"
    ? { backHref: "/project-documentation", backLabel: "Project Documentation" }
    : { backHref: "/documents", backLabel: "Workspace Documents" };
}

export function composeDocumentEditor(input: DocumentEditorInput): DocumentEditorModel {
  const { backHref, backLabel } = documentBack(input.source, input.opportunity);
  const capability =
    input.source === "project" ? VIEW_PROJECT_DOCUMENTS_CAPABILITY : VIEW_WORKSPACE_DOCUMENTS_CAPABILITY;

  if (input.source === "project" && input.assigned === false) {
    return {
      missing: true,
      mode: "missing",
      title: null,
      saveLabel: "",
      saveState: input.saveState,
      refusal: null,
      emptyTitle: MISSING_TITLE,
      emptyCopy: "This Document is not in this Workspace, or you cannot access it.",
      backHref,
      backLabel,
    };
  }

  if (input.forbidden) {
    return {
      missing: true,
      mode: "missing",
      title: null,
      saveLabel: "",
      saveState: input.saveState,
      refusal: chromeRefusal({ kind: "capability", capability, ownerName: input.ownerName }),
      emptyTitle: "",
      emptyCopy: "",
      backHref,
      backLabel,
    };
  }

  const record = input.document;
  if (input.missing || !record || !isReadableDocument(record)) {
    return {
      missing: true,
      mode: "missing",
      title: null,
      saveLabel: "",
      saveState: input.saveState,
      refusal: null,
      emptyTitle: MISSING_TITLE,
      emptyCopy: "This Document is not in this Workspace, or you cannot access it.",
      backHref,
      backLabel,
    };
  }

  const viewer = Boolean(record.storagePath);
  return {
    missing: false,
    mode: viewer ? "viewer" : "editor",
    title: record.name,
    saveLabel: viewer ? "" : saveLabel(input.saveState),
    saveState: input.saveState,
    refusal: null,
    emptyTitle: "",
    emptyCopy: "",
    backHref,
    backLabel,
  };
}

function saveLabel(state: DocumentEditorSaveState): string {
  if (state === "unsaved") return "Unsaved";
  if (state === "saving") return "Saving";
  if (state === "saved") return "Saved";
  if (state === "conflict") return "Not saved";
  return "";
}

export const DOCUMENT_CONFLICT_COPY =
  "Someone else changed this Document since you opened it. Your changes are not saved yet.";
export const DOCUMENT_BLANK_NAME_COPY = "A Document needs a name. Until you type one, it keeps the last one.";

const WORKSPACE_ROOT = "Workspace root";

/** Where a Workspace Document is filed, who added it and when it last changed: the line beside Back (F58). */
export function documentMetaLine(record: DocumentEditorRecord, now: Date): string {
  return placedMetaLine(record.folder?.name ?? (record.folderId ? "" : WORKSPACE_ROOT), record, now);
}

/** The same line for a Project Document on its own page, filed under its Opportunity (F61). */
export function projectDocumentMetaLine(
  record: DocumentEditorRecord,
  opportunity: DocumentOpportunity | null,
  now: Date,
): string {
  return placedMetaLine(opportunity?.name ?? "", record, now);
}

function placedMetaLine(place: string, record: DocumentEditorRecord, now: Date): string {
  const author = record.uploadedBy ? `Added by ${memberName(record.uploadedBy)}` : "";
  const updated = record.updatedAt ? shortDate(record.updatedAt, now) : "";
  return [place, author, updated ? `Updated ${updated}` : ""].filter(Boolean).join(" · ");
}

function shortDate(value: Date | string, now: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** Where an item can be filed. The Folder it is in stays listed when the reader's list does not hold it. */
export function moveDestinations(folders: LibraryFolder[], current: { id: string; name: string } | null): FolderChoice[] {
  const choices = folderChoices(folders);
  if (!current || choices.some((choice) => choice.value === current.id)) return choices;
  return [{ value: current.id, label: current.name }, ...choices];
}

/** What a move or rename sends, or null while there is nothing to save. */
export function moveRequest(input: {
  folderId: string | null;
  name: string;
  target: string | null;
  nextName: string;
}): { folderId?: string | null; name?: string } | null {
  const nextName = input.nextName.trim();
  if (!nextName) return null;
  const body: { folderId?: string | null; name?: string } = {};
  if (input.target !== input.folderId) body.folderId = input.target;
  if (nextName !== input.name.trim()) body.name = nextName;
  return Object.keys(body).length > 0 ? body : null;
}

/** A row over the cached record. A field the answer leaves out keeps its value: a PATCH answers without all a GET has. */
export function mergeDocumentRecord(record: DocumentEditorRecord, next: DocumentEditorRecord): DocumentEditorRecord {
  return {
    ...record,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)),
  };
}

/** A name worth asking for: the editor's is blank while the stored one is not. */
export function documentNameMissing(title: string, storedName: string): boolean {
  return !title.trim() && Boolean(storedName.trim());
}

/** A Document as the server last returned it. */
export type DocumentVersion = { name: string; content: unknown; updatedAt: string | null };

export type DocumentDraft = { title: string; content: unknown };

/** What one save sends. No `name` when the title is blank or unchanged. */
export type DocumentSaveRequest = { name?: string; content: unknown; expectedUpdatedAt?: string };

export type DocumentSaveAnswer =
  | { kind: "saved"; version: DocumentVersion }
  | { kind: "conflict"; current: DocumentVersion };

export const EMPTY_DOCUMENT = { type: "doc", content: [{ type: "paragraph" }] };

export function documentVersion(record: DocumentEditorRecord): DocumentVersion {
  return {
    name: record.name,
    content: record.content ?? null,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
  };
}

function sameContent(a: DocumentVersion, b: DocumentVersion): boolean {
  return JSON.stringify(a.content ?? null) === JSON.stringify(b.content ?? null);
}

function isNewer(next: DocumentVersion, than: DocumentVersion): boolean {
  if (!next.updatedAt) return false;
  return !than.updatedAt || Date.parse(next.updatedAt) > Date.parse(than.updatedAt);
}

/**
 * What one open editor holds and has yet to save (F52). Saves never overlap:
 * a save asked for while one is in flight goes out after it, with the newest
 * text and the `updatedAt` that answer brought. It holds no React state, so
 * the save an unmounting editor asks for is still delivered.
 */
export class DocumentSaveQueue {
  draft: DocumentDraft;
  state: DocumentEditorSaveState = "idle";
  conflict: DocumentVersion | null = null;

  private server: DocumentVersion;
  /** The name the title started from; the title is dirty when it differs. */
  private baseName: string;
  private revision = 0;
  private savedRevision = 0;
  private again = false;
  private running: Promise<void> | null = null;
  private observed: DocumentVersion | null = null;

  constructor(
    version: DocumentVersion,
    private readonly hooks: {
      send: (request: DocumentSaveRequest) => Promise<DocumentSaveAnswer>;
      onChange: () => void;
      onSaved: (version: DocumentVersion, renamed: boolean) => void;
      onConflict: () => void;
      onError: (error: Error) => void;
    },
  ) {
    this.server = version;
    this.baseName = version.name;
    this.draft = { title: version.name, content: version.content ?? EMPTY_DOCUMENT };
  }

  get dirty(): boolean {
    return this.revision !== this.savedRevision || this.running !== null;
  }

  get storedName(): string {
    return this.server.name;
  }

  /** The save in flight and any that follows it. */
  get settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  edit(next: Partial<DocumentDraft>) {
    this.draft = { ...this.draft, ...next };
    this.revision += 1;
    if (!this.conflict) this.state = "unsaved";
    this.hooks.onChange();
  }

  save(): Promise<void> {
    if (this.conflict) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    if (!this.dirty) return Promise.resolve();
    this.running = this.drain().finally(() => {
      this.running = null;
      this.hooks.onChange();
    });
    return this.running;
  }

  /** A refetch landed: take it whole when nothing is unsaved, its baseline alone when only the rest of the row moved. */
  observe(next: DocumentVersion): "ignored" | "adopted" | "reseeded" {
    this.observed = next;
    if (this.conflict || this.running || !isNewer(next, this.server)) return "ignored";
    if (sameContent(next, this.server)) {
      this.adopt(next);
      this.hooks.onChange();
      return "adopted";
    }
    if (this.dirty) return "ignored";
    this.seed(next);
    return "reseeded";
  }

  loadTheirs() {
    if (this.conflict) this.seed(this.conflict);
  }

  keepMine(): Promise<void> {
    if (!this.conflict) return Promise.resolve();
    this.server = this.conflict;
    this.conflict = null;
    this.state = "unsaved";
    return this.save();
  }

  private seed(version: DocumentVersion) {
    this.server = version;
    this.baseName = version.name;
    this.draft = { title: version.name, content: version.content ?? EMPTY_DOCUMENT };
    this.conflict = null;
    this.savedRevision = this.revision;
    this.state = "idle";
    this.hooks.onChange();
  }

  /** Takes a version as the new baseline. A title the reader has not touched follows the stored name. */
  private adopt(version: DocumentVersion, nameSent = false) {
    const untouched = this.draft.title.trim() === this.baseName.trim();
    if (!nameSent && untouched && version.name !== this.baseName) this.draft = { ...this.draft, title: version.name };
    this.baseName = version.name;
    this.server = version;
  }

  private async drain() {
    do {
      this.again = false;
      await this.sendOnce();
    } while (this.again && !this.conflict);
  }

  private async sendOnce() {
    const revision = this.revision;
    const name = this.draft.title.trim();
    const renamed = Boolean(name) && name !== this.baseName.trim();
    this.state = "saving";
    this.hooks.onChange();
    try {
      const answer = await this.hooks.send({
        ...(renamed ? { name } : {}),
        content: this.draft.content,
        ...(this.server.updatedAt ? { expectedUpdatedAt: this.server.updatedAt } : {}),
      });
      // A rename, a move, or an access change moved the row, not the text: nothing to choose between.
      if (answer.kind === "conflict" && sameContent(answer.current, this.server)) {
        this.adopt(answer.current);
        this.state = "unsaved";
        this.again = true;
        return;
      }
      if (answer.kind === "conflict") {
        this.conflict = answer.current;
        this.state = "conflict";
        this.hooks.onConflict();
        return;
      }
      this.adopt(answer.version, renamed);
      const seen = this.observed;
      if (seen && isNewer(seen, this.server) && sameContent(seen, this.server)) this.adopt(seen);
      this.savedRevision = revision;
      this.state = this.revision === revision ? "saved" : "unsaved";
      this.hooks.onSaved(this.server, renamed);
    } catch (error) {
      this.state = "unsaved";
      this.hooks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export type LoadedDocument = {
  forbidden: boolean;
  missing: boolean;
  record: DocumentEditorRecord | null;
};

/** A route's row as the editor holds it; both sources share every field but the name. */
export function toDocumentRecord(source: DocumentEditorSource, row: Record<string, any>): DocumentEditorRecord {
  if (source === "project") {
    return {
      id: row.id,
      name: row.title,
      content: row.content,
      access: "workspace",
      projectId: row.projectId,
      uploadedBy: row.createdBy,
      updatedAt: row.updatedAt,
    };
  }
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    storagePath: row.storagePath,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    access: row.access,
    effectiveAccess: row.effectiveAccess,
    canManageAccess: row.canManageAccess,
    folderId: row.folderId,
    folder: row.folder,
    uploadedBy: row.uploadedBy,
    description: row.description,
    updatedAt: row.updatedAt,
  };
}

export function documentApiPath(source: DocumentEditorSource, documentId: string): string {
  return source === "project" ? `/api/documents/${documentId}` : `/api/company-documents/${documentId}`;
}

export function documentQueryKey(source: DocumentEditorSource, documentId: string) {
  return [source === "project" ? "/api/documents" : "/api/company-documents", documentId, "v2-editor"];
}

/** Saves an editor left behind as it closed. A Document opened again is read after them. */
const savesInFlight = new Map<string, Promise<void>>();

export function trackDocumentSave(documentId: string, save: Promise<void>) {
  savesInFlight.set(documentId, save);
  void save.finally(() => {
    if (savesInFlight.get(documentId) === save) savesInFlight.delete(documentId);
  });
}

export async function loadDocument(source: DocumentEditorSource, documentId: string): Promise<LoadedDocument> {
  await savesInFlight.get(documentId);
  const res = await fetch(documentApiPath(source, documentId), { credentials: "include" });
  if (res.status === 401 || res.status === 403) {
    return { forbidden: true, missing: false, record: null };
  }
  if (res.status === 404) return { forbidden: false, missing: true, record: null };
  if (!res.ok) throw new Error("Failed to fetch Document");
  return { forbidden: false, missing: false, record: toDocumentRecord(source, await res.json()) };
}
