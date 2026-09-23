import { useCallback, useEffect, useState } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CompanyDocumentWithUploader, CrmProjectWithDetails, DocumentWithCreator } from "@shared/schema";
import { BlockEditor } from "@/components/editor/BlockEditor";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDebouncedCallback } from "@/hooks/useDebounce";
import { useAuth } from "@/hooks/useAuth";
import { chromeRefusal } from "./chrome";
import { composeFileViewer } from "./fileViewer";
import {
  composeDocumentEditor,
  type DocumentEditorRecord,
  type DocumentEditorSaveState,
  type DocumentEditorSource,
} from "./documentEditor";
import { matchV2Route } from "./presentation";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { V2FileViewer } from "./V2FileViewer";
import { projectVisibleTo } from "./projects";
import { useV2Chrome } from "./V2Shell";
import { Button } from "@/components/ui/button";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

type LoadedDocument = {
  forbidden: boolean;
  missing: boolean;
  record: DocumentEditorRecord | null;
};

function toWorkspaceRecord(document: CompanyDocumentWithUploader): DocumentEditorRecord {
  return {
    id: document.id,
    name: document.name,
    content: document.content,
    storagePath: document.storagePath,
    fileName: document.fileName,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
    access: document.access,
  };
}

function toProjectRecord(document: DocumentWithCreator): DocumentEditorRecord {
  return {
    id: document.id,
    name: document.title,
    content: document.content,
    access: "workspace",
    projectId: document.projectId,
  };
}

async function loadDocument(source: DocumentEditorSource, documentId: string): Promise<LoadedDocument> {
  const url = source === "project" ? `/api/documents/${documentId}` : `/api/company-documents/${documentId}`;
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 401 || res.status === 403) {
    return { forbidden: true, missing: false, record: null };
  }
  if (res.status === 404) return { forbidden: false, missing: true, record: null };
  if (!res.ok) throw new Error("Failed to fetch Document");
  const body = await res.json();
  return {
    forbidden: false,
    missing: false,
    record: source === "project" ? toProjectRecord(body) : toWorkspaceRecord(body),
  };
}

export function V2DocumentPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const documentId = match.kind === "document-editor" ? match.documentId : "";
  const source: DocumentEditorSource = match.kind === "document-editor" ? match.source : "workspace";
  const { user } = useAuth();
  const { memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<unknown>(null);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<DocumentEditorSaveState>("idle");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const ownerName = useWorkspaceOwnerName();
  const { data, isLoading } = useQuery<LoadedDocument>({
    queryKey: [source === "project" ? "/api/documents" : "/api/company-documents", documentId, "v2-editor"],
    enabled: Boolean(documentId),
    queryFn: () => loadDocument(source, documentId),
  });
  const { data: projects = [], isLoading: projectsLoading } = useQuery<CrmProjectWithDetails[]>({
    queryKey: ["/api/crm/projects", "document-assignment"],
    enabled: source === "project" && Boolean(data?.record?.projectId),
    queryFn: async () => {
      const res = await fetch("/api/crm/projects?pageSize=500", { credentials: "include" });
      if (!res.ok) return [];
      const body = (await res.json()) as { data?: CrmProjectWithDetails[] };
      return body.data ?? [];
    },
  });

  const assigned =
    source !== "project"
      ? true
      : Boolean(
          data?.record?.projectId &&
            projects.some((project) => {
              if (project.project?.id !== data.record?.projectId) return false;
              const memberIds = (project.members ?? [])
                .map((row) => row.userId || row.user?.id)
                .filter((id): id is string => Boolean(id));
              return projectVisibleTo({
                role: current?.workspaceRole?.toLowerCase() || null,
                userId: user?.id ?? "",
                memberIds,
                assigneeId: project.assigneeId ?? project.assignee?.id ?? null,
              });
            }),
        );
  const assignmentPending = source === "project" && Boolean(data?.record) && projectsLoading;

  useEffect(() => {
    if (!data?.record) {
      setReadyId(null);
      return;
    }
    setTitle(data.record.name);
    setContent(data.record.content ?? EMPTY_DOC);
    setSaveState("idle");
    setWriteRefusal(null);
    setReadyId(data.record.id);
  }, [data?.record?.id]);

  const editor = composeDocumentEditor({
    source,
    document: assigned ? data?.record ?? null : null,
    missing:
      data?.missing === true ||
      assigned === false ||
      (!isLoading && !assignmentPending && !data?.record && !data?.forbidden),
    forbidden: data?.forbidden === true,
    ownerName,
    saveState,
    assigned,
  });

  const saveMutation = useMutation({
    mutationFn: async (next: { title: string; content: unknown }) => {
      if (source === "project") {
        return apiRequest("PATCH", `/api/documents/${documentId}`, { title: next.title, content: next.content });
      }
      return apiRequest("PATCH", `/api/company-documents/${documentId}`, {
        name: next.title,
        content: next.content,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [source === "project" ? "/api/documents" : "/api/company-documents", documentId],
      });
      setSaveState("saved");
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      setSaveState("unsaved");
      if (readOnly) {
        setWriteRefusal(
          chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }),
        );
        return;
      }
      setWriteRefusal(chromeRefusal({ kind: "generic", message: error.message }));
    },
  });

  const debouncedSave = useDebouncedCallback((nextTitle: string, nextContent: unknown) => {
    if (readOnly) {
      setWriteRefusal(
        chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }),
      );
      setSaveState("unsaved");
      return;
    }
    setSaveState("saving");
    saveMutation.mutate({ title: nextTitle, content: nextContent });
  }, 1500);

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    setSaveState("unsaved");
    debouncedSave(nextTitle, content ?? EMPTY_DOC);
  };

  const handleContentChange = (nextContent: unknown) => {
    setContent(nextContent);
    setSaveState("unsaved");
    debouncedSave(title, nextContent);
  };

  const handleImageUpload = useCallback(async (): Promise<string | null> => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    window.document.body.appendChild(input);
    return new Promise((resolve) => {
      const cleanup = () => {
        if (input.parentNode) input.parentNode.removeChild(input);
      };
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          cleanup();
          resolve(null);
          return;
        }
        try {
          const uploadPath = source === "project" ? "/api/objects/upload" : "/api/company-documents/upload-url";
          const urlResponse = await apiRequest("POST", uploadPath);
          const { uploadURL, objectPath } = urlResponse as { uploadURL: string; objectPath?: string };
          await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
          if (source === "project") {
            const updateResponse = (await apiRequest("PUT", "/api/document-images", {
              imageURL: objectPath ?? uploadURL,
            })) as { objectPath: string };
            cleanup();
            resolve(updateResponse.objectPath);
            return;
          }
          cleanup();
          resolve(objectPath ?? null);
        } catch {
          cleanup();
          resolve(null);
        }
      };
      input.addEventListener("cancel", () => {
        cleanup();
        resolve(null);
      });
      input.click();
    });
  }, [source]);

  /**
   * The editor's attach control (#260). It was drawn on every v2 Document and
   * did nothing (#249); it now stores the File the way v1's Document page did,
   * as an object whose ACL `/api/document-attachments` sets.
   */
  const handleDocumentUpload = useCallback(
    async (onProgress?: (progress: number) => void) => {
      const input = window.document.createElement("input");
      input.type = "file";
      input.style.display = "none";
      window.document.body.appendChild(input);
      return new Promise<{ url: string; filename: string; filesize: number; filetype: string } | null>(
        (resolve) => {
          const cleanup = () => {
            if (input.parentNode) input.parentNode.removeChild(input);
          };
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
              cleanup();
              resolve(null);
              return;
            }
            if (readOnly) {
              setWriteRefusal(
                chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }),
              );
              cleanup();
              resolve(null);
              return;
            }
            const filetype = file.type || "application/octet-stream";
            try {
              const slot = (await apiRequest("POST", "/api/objects/upload")) as {
                uploadURL: string;
                objectPath?: string;
              };
              onProgress?.(0);
              const uploaded = await fetch(slot.uploadURL, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": filetype },
              });
              if (!uploaded.ok) throw new Error(`Failed to upload ${file.name}`);
              onProgress?.(100);
              const attached = (await apiRequest("PUT", "/api/document-attachments", {
                fileURL: slot.objectPath ?? slot.uploadURL,
              })) as { objectPath: string };
              setWriteRefusal(null);
              cleanup();
              resolve({ url: attached.objectPath, filename: file.name, filesize: file.size, filetype });
            } catch (error) {
              setWriteRefusal(
                chromeRefusal({
                  kind: "generic",
                  message: error instanceof Error ? error.message : "Failed to attach File",
                }),
              );
              cleanup();
              resolve(null);
            }
          };
          input.addEventListener("cancel", () => {
            cleanup();
            resolve(null);
          });
          input.click();
        },
      );
    },
    [readOnly, workspaceName],
  );

  if (!documentId) {
    return <Redirect to={source === "project" ? "/project-documentation" : "/documents"} />;
  }

  if (isLoading || assignmentPending) {
    return (
      <div className="df-editor-page" data-testid="v2-document-editor">
        <header className="df-editor-head">
          <h1 className="df-title" style={{ fontSize: 22 }}>
            Document
          </h1>
        </header>
        <p className="df-subhead df-page-inset">
          Loading this Document…
        </p>
      </div>
    );
  }

  if (editor.missing) {
    return (
      <div className="df-editor-page" data-testid="v2-document-editor">
        <header className="df-editor-head">
          <Button asChild variant="outline" className="df-btn"><Link href={editor.backHref}>
            Back to {editor.backLabel}
          </Link></Button>
        </header>
        {editor.refusal ? <p className="df-refusal">{editor.refusal}</p> : <p className="df-empty">{editor.emptyCopy}</p>}
      </div>
    );
  }

  // An uploaded File is Knowledge, not a page to edit: it opens in the viewer (#216).
  // Only a Workspace Document has the stream and conversion routes; anything
  // else is read from the object it was stored as.
  if (editor.mode === "viewer") {
    const record = data?.record;
    return (
      <V2FileViewer
        viewer={composeFileViewer({
          source: source === "project" ? "object" : "workspace",
          documentId,
          objectPath: record?.storagePath ?? null,
          name: editor.title ?? "File",
          fileName: record?.fileName ?? null,
          fileSize: record?.fileSize ?? null,
          mimeType: record?.mimeType ?? null,
          access: record?.access ?? null,
          backHref: editor.backHref,
        })}
      />
    );
  }

  return (
    <div className="df-editor-page" data-testid="v2-document-editor">
      <header className="df-editor-head">
        <Button asChild variant="outline" className="df-btn"><Link href={editor.backHref}>
          Back to {editor.backLabel}
        </Link></Button>
        {editor.saveLabel ? (
          <span className="df-save-state" data-state={saveState} data-motion={saveState === "idle" ? "none" : "standard"}>
            {editor.saveLabel}
          </span>
        ) : null}
        {writeRefusal ? (
          <p className="df-refusal df-flush">
            {writeRefusal}
          </p>
        ) : null}
      </header>
      <div className="df-editor">
        {readyId === documentId && content ? (
          <BlockEditor
            key={documentId}
            content={content}
            onChange={handleContentChange}
            onImageUpload={handleImageUpload}
            onDocumentUpload={readOnly ? undefined : handleDocumentUpload}
            title={title}
            onTitleChange={handleTitleChange}
            titlePlaceholder="Untitled"
            editable={!readOnly}
          />
        ) : null}
      </div>
    </div>
  );
}
