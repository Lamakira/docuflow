import { chromeRefusal } from "./chrome";
import { documentHref } from "./library";

export { projectDocumentHref } from "./library";

export type DocumentEditorSource = "workspace" | "project";

export type DocumentEditorSaveState = "idle" | "unsaved" | "saving" | "saved";

export type DocumentEditorRecord = {
  id: string;
  name: string;
  content?: unknown;
  storagePath?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  access?: string | null;
  projectId?: string | null;
};

export type DocumentEditorInput = {
  source: DocumentEditorSource;
  document: DocumentEditorRecord | null;
  missing: boolean;
  forbidden: boolean;
  ownerName: string | null;
  saveState: DocumentEditorSaveState;
  assigned?: boolean;
};

export type DocumentEditorMode = "missing" | "editor" | "viewer";

export type DocumentEditorModel = {
  missing: boolean;
  mode: DocumentEditorMode;
  title: string | null;
  saveLabel: string;
  saveState: DocumentEditorSaveState;
  refusal: string | null;
  emptyCopy: string;
  backHref: string;
  backLabel: string;
  downloadHref: string | null;
  streamHref: string | null;
};

const VIEW_WORKSPACE_DOCUMENTS_CAPABILITY = "View Workspace Documents";
const VIEW_PROJECT_DOCUMENTS_CAPABILITY = "View Project Documents";

export function workspaceDocumentHref(id: string): string {
  return documentHref(id);
}

export function composeDocumentEditor(input: DocumentEditorInput): DocumentEditorModel {
  const backHref = input.source === "project" ? "/project-documentation" : "/documents";
  const backLabel = input.source === "project" ? "Project Documentation" : "Workspace Documents";
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
      emptyCopy: "This Document is not in this Workspace, or you cannot access it.",
      backHref,
      backLabel,
      downloadHref: null,
      streamHref: null,
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
      emptyCopy: "",
      backHref,
      backLabel,
      downloadHref: null,
      streamHref: null,
    };
  }

  const record = input.document;
  if (input.missing || !record || !isVisibleDocument(record.access)) {
    return {
      missing: true,
      mode: "missing",
      title: null,
      saveLabel: "",
      saveState: input.saveState,
      refusal: null,
      emptyCopy: "This Document is not in this Workspace, or you cannot access it.",
      backHref,
      backLabel,
      downloadHref: null,
      streamHref: null,
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
    emptyCopy: "",
    backHref,
    backLabel,
    downloadHref: viewer && input.source === "workspace" ? `/api/company-documents/${record.id}/download` : null,
    streamHref: viewer && input.source === "workspace" ? `/api/company-documents/${record.id}/stream` : null,
  };
}

function isVisibleDocument(access: string | null | undefined): boolean {
  const value = (access ?? "workspace").toLowerCase();
  return value === "workspace" || value === "everyone";
}

function saveLabel(state: DocumentEditorSaveState): string {
  if (state === "unsaved") return "Unsaved";
  if (state === "saving") return "Saving";
  if (state === "saved") return "Saved";
  return "";
}
