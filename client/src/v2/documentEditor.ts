import { isReadableDocument } from "@shared/documentAccess";
import { chromeRefusal } from "./chrome";
import { documentHref } from "./library";
import { dossierDocumentHref } from "./presentation";

export { projectDocumentHref } from "./library";

/**
 * Where an old `/document/:id` link to a Project Document opens now (#307):
 * the page's place in its Project Dossier, found through the CRM Project that
 * owns the page's Project. Null while no such Project is known.
 */
export function projectDocumentDossierHref(
  document: { id: string; projectId: string },
  projects: Array<{ id: string; project?: { id: string } | null }>,
): string | null {
  const owner = projects.find((row) => row.project?.id === document.projectId);
  return owner ? dossierDocumentHref(owner.id, document.id) : null;
}

export type DocumentEditorSource = "workspace" | "project";

export type DocumentEditorSaveState = "idle" | "unsaved" | "saving" | "saved";

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
    emptyCopy: "",
    backHref,
    backLabel,
  };
}

function saveLabel(state: DocumentEditorSaveState): string {
  if (state === "unsaved") return "Unsaved";
  if (state === "saving") return "Saving";
  if (state === "saved") return "Saved";
  return "";
}
