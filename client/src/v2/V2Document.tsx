import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FolderInput, KeyRound } from "lucide-react";
import type { CompanyDocument, CrmProjectWithDetails } from "@shared/schema";
import { BlockEditor } from "@/components/editor/BlockEditor";
import { apiRequest, queryClient, throwIfResNotOk } from "@/lib/queryClient";
import { useDebouncedCallback } from "@/hooks/useDebounce";
import { chromeRefusal } from "./chrome";
import { isStandingRefusal, notify } from "./notify";
import { composeFileViewer } from "./fileViewer";
import {
  composeDocumentEditor,
  documentApiPath,
  documentBack,
  documentMetaLine,
  documentNameMissing,
  documentOwnerKey,
  documentQueryKey,
  documentVersion,
  isSaleDocumentOwner,
  loadDocument,
  loadDocumentOwner,
  mergeDocumentRecord,
  projectDocumentDossierHref,
  projectDocumentMetaLine,
  toDocumentRecord,
  trackDocumentSave,
  DocumentSaveQueue,
  DOCUMENT_BLANK_NAME_COPY,
  DOCUMENT_CONFLICT_COPY,
  type DocumentEditorRecord,
  type DocumentEditorSource,
  type DocumentOpportunity,
  type DocumentOwner,
  type DocumentSaveAnswer,
  type DocumentSaveRequest,
  type LoadedDocument,
} from "./documentEditor";
import { matchV2Route } from "./presentation";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { FileLoading, V2FileViewer } from "./V2FileViewer";
import { SkeletonBar, SkeletonLines } from "./V2Skeleton";
import { V2EmptyState, V2LoadFailed } from "./V2EmptyState";
import { V2ManageAccessDialog } from "./V2ManageAccessDialog";
import { V2MoveDocumentDialog } from "./V2MoveDocumentDialog";
import { useV2Chrome } from "./V2Shell";
import { Button } from "@/components/ui/button";

const LEFT_UNSAVED_COPY =
  "Your last changes to this Document were not saved: someone else changed it since you opened it.";

async function saveDocument(
  source: DocumentEditorSource,
  documentId: string,
  { name, ...request }: DocumentSaveRequest,
): Promise<{ conflict: boolean; record: DocumentEditorRecord }> {
  const named = name === undefined ? {} : source === "project" ? { title: name } : { name };
  const res = await fetch(documentApiPath(source, documentId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...named, ...request }),
    credentials: "include",
  });
  if (res.status === 409) {
    const body = await res.clone().json().catch(() => null);
    if (body?.code === "document_changed" && body.current) {
      return { conflict: true, record: toDocumentRecord(source, body.current) };
    }
  }
  await throwIfResNotOk(res);
  return { conflict: false, record: toDocumentRecord(source, await res.json()) };
}

/** The register lists a Document's name, Folder and time: what it shows next must be read again (F55). */
function staleRegister(refetchType: "active" | "none") {
  queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"], refetchType });
  queryClient.invalidateQueries({ queryKey: ["/api/company-documents"], refetchType });
}

/** Project Documentation lists a Project Document's name and time (F63). */
function staleDocumentation(refetchType: "active" | "none") {
  queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"], refetchType });
}

/** Stores a File in the slot a route gives. */
async function storeObject(slotPath: string, file: File, contentType: string): Promise<string> {
  const slot = (await apiRequest("POST", slotPath)) as { uploadURL: string; objectPath?: string };
  const uploaded = await fetch(slot.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
  if (!uploaded.ok) throw new Error(`Failed to upload ${file.name}`);
  return slot.objectPath ?? slot.uploadURL;
}

/** Ties a stored object to the Document's readers (F56). */
async function tieObject(documentId: string, objectPath: string): Promise<string> {
  const tied = (await apiRequest("PUT", `/api/company-documents/${documentId}/objects`, { objectPath })) as {
    objectPath: string;
  };
  staleRegister("none");
  return tied.objectPath;
}

/** Read again on every opening: a sale won elsewhere is delivery work now. */
function useDocumentOwner(projectId: string | null) {
  return useQuery<DocumentOwner | null>({
    queryKey: documentOwnerKey(projectId ?? ""),
    enabled: Boolean(projectId),
    staleTime: 0,
    queryFn: async () => {
      const owner = await loadDocumentOwner(projectId!);
      // The Dossier sends a sale back here, so a row it holds from before must not disagree.
      if (owner) {
        const { status, projectType, isDocumentationOnly } = owner;
        queryClient.setQueryData<CrmProjectWithDetails | null>(["/api/crm/projects", owner.id], (row) =>
          row ? ({ ...row, status, projectType, isDocumentationOnly } as CrmProjectWithDetails) : row,
        );
      }
      return owner;
    },
  });
}

/** The Document routes. A Project Document opens in its Project Dossier since #307. */
export function V2DocumentPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const documentId = match.kind === "document-editor" ? match.documentId : "";
  const source: DocumentEditorSource = match.kind === "document-editor" ? match.source : "workspace";

  if (!documentId) {
    return <Redirect to={source === "project" ? "/project-documentation" : "/documents"} />;
  }
  if (source === "project") return <ProjectDocumentRedirect documentId={documentId} />;
  return <V2DocumentEditor key={documentId} source="workspace" documentId={documentId} />;
}

/**
 * An old `/document/:id` link moves to the page's place in its Project
 * Dossier. A sale's Document stays here (F61), and so does one no CRM Project
 * owns. Who may read it is the server's answer alone (F60).
 */
function ProjectDocumentRedirect({ documentId }: { documentId: string }) {
  const { data, isLoading, isError, refetch } = useQuery<LoadedDocument>({
    queryKey: documentQueryKey("project", documentId),
    queryFn: () => loadDocument("project", documentId),
  });
  const projectId = data?.record?.projectId ?? null;
  const {
    data: owner,
    isFetchedAfterMount: ownerFetched,
    isLoading: ownerLoading,
    isError: ownerFailed,
    refetch: refetchOwner,
  } = useDocumentOwner(projectId);
  const href = data?.record && ownerFetched ? projectDocumentDossierHref(data.record, owner) : null;

  if (href) return <Redirect to={href} />;
  if (isLoading || (projectId && (!ownerFetched || ownerLoading))) {
    return <EditorLoading embedded={false} {...documentBack("project")} />;
  }
  if ((isError && !data) || (ownerFailed && owner === undefined)) {
    return (
      <DocumentLoadFailed
        embedded={false}
        {...documentBack("project")}
        onRetry={() => (isError ? refetch() : refetchOwner())}
      />
    );
  }
  return <V2DocumentEditor key={documentId} source="project" documentId={documentId} />;
}

const LOADING_DOCUMENT_COPY = "Loading this Document…";

function EditorLoading({ embedded, backHref, backLabel }: { embedded: boolean; backHref: string; backLabel: string }) {
  return (
    <div className="df-editor-page" data-testid="v2-document-editor" aria-busy="true">
      {embedded ? (
        <div className="df-editor">
          <p className="df-sr-only" role="status">
            {LOADING_DOCUMENT_COPY}
          </p>
          <SkeletonBar role="title" />
          <SkeletonLines count={8} />
        </div>
      ) : (
        <>
          <header className="df-editor-head df-file-head">
            <Button asChild variant="outline" className="df-btn"><Link href={backHref}>
              Back to {backLabel}
            </Link></Button>
            <div className="df-file-identity df-file-identity-skeleton">
              <SkeletonBar role="title" />
              <SkeletonBar width="medium" />
            </div>
          </header>
          <FileLoading status={LOADING_DOCUMENT_COPY} />
        </>
      )}
    </div>
  );
}

function BackLink({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <Button asChild variant="outline" className="df-btn"><Link href={backHref}>
      Back to {backLabel}
    </Link></Button>
  );
}

function DocumentLoadFailed({
  embedded,
  backHref,
  backLabel,
  onRetry,
}: {
  embedded: boolean;
  backHref: string;
  backLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="df-editor-page" data-testid="v2-document-editor">
      <V2LoadFailed
        title="This Document could not be loaded"
        copy={`Something went wrong while loading it. Try again${embedded ? "." : `, or go back to ${backLabel}.`}`}
        onRetry={onRetry}
        action={embedded ? undefined : <BackLink backHref={backHref} backLabel={backLabel} />}
        testId="v2-document-load-failed"
      />
    </div>
  );
}

/**
 * One Document in the editor: on its own page, or `embedded` beside the page
 * tree in a Project Dossier (#307), where the tree replaces the way back and
 * Print prints the page as v1 did, titled "Project - Page". Render it keyed by
 * `documentId`: what it has yet to save belongs to one Document.
 */
export function V2DocumentEditor({
  source,
  documentId,
  embedded = false,
  projectName,
}: {
  source: DocumentEditorSource;
  documentId: string;
  embedded?: boolean;
  projectName?: string;
}) {
  const { memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const [, changed] = useReducer((count: number) => count + 1, 0);
  // Set once the fresh read seeded the editor; until then nothing may be painted or saved (F52).
  const queueRef = useRef<DocumentSaveQueue | null>(null);
  const aliveRef = useRef(true);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // Remounts the editor on content that did not come from it.
  const [seed, setSeed] = useState(0);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [managingAccess, setManagingAccess] = useState(false);
  const [moving, setMoving] = useState(false);

  const ownerName = useWorkspaceOwnerName();
  const queryKey = documentQueryKey(source, documentId);
  const { data, isError, isFetching, isFetchedAfterMount, refetch } = useQuery<LoadedDocument>({
    queryKey,
    enabled: Boolean(documentId),
    staleTime: 0,
    queryFn: () => loadDocument(source, documentId),
  });
  // In a Dossier the owner is on screen already; on its own page it decides the way back.
  const { data: owner } = useDocumentOwner(source === "project" && !embedded ? data?.record?.projectId ?? null : null);
  const saleId = isSaleDocumentOwner(owner) ? owner.id : "";
  const { data: sale } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", saleId],
    enabled: Boolean(saleId),
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects/${saleId}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch Opportunity");
      return res.json();
    },
  });
  const opportunity: DocumentOpportunity | null = saleId
    ? { id: saleId, name: sale?.project?.name?.trim() || null }
    : null;

  const queue = queueRef.current;
  const saveState = queue?.state ?? "idle";
  const opened = Boolean(queue && data?.record);
  const waiting = !opened && (!isFetchedAfterMount || isFetching);
  const loadFailed = !opened && !waiting && isError;

  const refuseReadOnly = () => {
    setWriteRefusal(chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }));
  };

  const mergeRecord = (next: DocumentEditorRecord) => {
    queryClient.setQueryData<LoadedDocument>(queryKey, (loaded) =>
      loaded?.record ? { ...loaded, record: mergeDocumentRecord(loaded.record, next) } : loaded,
    );
  };

  const openQueue = (record: DocumentEditorRecord) =>
    new DocumentSaveQueue(documentVersion(record), {
      send: async (request: DocumentSaveRequest): Promise<DocumentSaveAnswer> => {
        const answer = await saveDocument(source, documentId, request);
        // A closed editor leaves the cache alone, so the next one opens on its own read.
        if (aliveRef.current) mergeRecord(answer.record);
        const version = documentVersion(answer.record);
        return answer.conflict ? { kind: "conflict", current: version } : { kind: "saved", version };
      },
      onChange: changed,
      onSaved: (_version, renamed) => {
        setWriteRefusal(null);
        if (source === "workspace") {
          staleRegister(renamed ? "active" : "none");
          return;
        }
        staleDocumentation(renamed ? "active" : "none");
        // The page tree beside the editor lists the new title too.
        if (record.projectId) {
          queryClient.invalidateQueries({ queryKey: ["/api/projects", record.projectId, "documents"] });
        }
      },
      onConflict: () => {
        if (!aliveRef.current) notify.error(LEFT_UNSAVED_COPY, { id: `v2-document-save-${documentId}` });
      },
      onError: (error) => {
        if (aliveRef.current && readOnlyRef.current) {
          refuseReadOnly();
          return;
        }
        if (aliveRef.current && isStandingRefusal(error)) {
          setWriteRefusal(chromeRefusal({ kind: "generic", message: error.message }));
          return;
        }
        notify.error(error, { fallback: "Document could not be saved.", id: `v2-document-save-${documentId}` });
      },
    });

  useEffect(() => {
    if (!isFetchedAfterMount || !data) return;
    if (!data.record) {
      queueRef.current = null;
      return;
    }
    if (!queueRef.current) {
      if (isError || isFetching) return;
      queueRef.current = openQueue(data.record);
      changed();
      return;
    }
    // Access, a move, or a rename from the page tree (#307) reaches an open editor here.
    if (queueRef.current.observe(documentVersion(data.record)) === "reseeded") setSeed((count) => count + 1);
  }, [data, isFetchedAfterMount, isError, isFetching, saveState, queue?.dirty]);

  const editor = composeDocumentEditor({
    source,
    document: data?.record ?? null,
    missing: data?.missing === true || (!waiting && !data?.record && !data?.forbidden),
    forbidden: data?.forbidden === true,
    ownerName,
    saveState,
    opportunity,
  });

  const requestSave = () => {
    const open = queueRef.current;
    if (!open) return;
    if (readOnly) {
      refuseReadOnly();
      return;
    }
    trackDocumentSave(documentId, open.save());
  };
  const debouncedSave = useDebouncedCallback(requestSave, 1500);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (queueRef.current?.conflict) {
        notify.error(LEFT_UNSAVED_COPY, { id: `v2-document-save-${documentId}` });
      }
    };
  }, []);

  useEffect(() => {
    if (saveState !== "conflict") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const handleTitleChange = (title: string) => {
    queueRef.current?.edit({ title });
    debouncedSave();
  };

  const handleContentChange = (content: unknown) => {
    queueRef.current?.edit({ content });
    debouncedSave();
  };

  const loadTheirs = () => {
    queueRef.current?.loadTheirs();
    setSeed((count) => count + 1);
  };

  const keepMine = () => {
    if (readOnly) {
      refuseReadOnly();
      return;
    }
    const open = queueRef.current;
    if (open) trackDocumentSave(documentId, open.keepMine());
  };

  const settleSaves = async () => {
    debouncedSave.flush();
    await queueRef.current?.settled;
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
          if (source === "project") {
            const imageURL = await storeObject("/api/objects/upload", file, file.type);
            const stored = (await apiRequest("PUT", "/api/document-images", { imageURL })) as { objectPath: string };
            cleanup();
            resolve(stored.objectPath);
            return;
          }
          const path = await storeObject("/api/company-documents/upload-url", file, file.type);
          const tied = await tieObject(documentId, path);
          cleanup();
          resolve(tied);
        } catch (error) {
          notify.error(error, { fallback: "Image could not be added." });
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
  }, [source, documentId]);

  /**
   * The editor's attach control (#260). It was drawn on every v2 Document and
   * did nothing (#249); a Project Document stores the File the way v1's
   * Document page did, as an object whose ACL `/api/document-attachments` sets;
   * a Workspace Document's is tied to the Document's own readers (F56).
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
              onProgress?.(0);
              const path = await storeObject("/api/objects/upload", file, filetype);
              onProgress?.(100);
              const url =
                source === "project"
                  ? ((await apiRequest("PUT", "/api/document-attachments", { fileURL: path })) as { objectPath: string })
                      .objectPath
                  : await tieObject(documentId, path);
              setWriteRefusal(null);
              cleanup();
              resolve({ url, filename: file.name, filesize: file.size, filetype });
            } catch (error) {
              notify.error(error, { fallback: "File could not be attached." });
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
    [source, documentId, readOnly, workspaceName],
  );

  const readOnlyRefusal = readOnly
    ? chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" })
    : null;
  const isFile = editor.mode === "viewer";

  const manageAccess =
    source === "workspace" && data?.record?.canManageAccess ? (
      <>
        <Button
          variant="outline"
          type="button"
          className="df-btn"
          data-testid="v2-document-move"
          onClick={() => setMoving(true)}
        >
          <FolderInput strokeWidth={1.6} aria-hidden />
          {isFile ? "Rename or move" : "Move"}
        </Button>
        <Button
          variant="outline"
          type="button"
          className="df-btn"
          data-testid="v2-document-manage-access"
          onClick={() => setManagingAccess(true)}
        >
          <KeyRound strokeWidth={1.6} aria-hidden />
          Manage access
        </Button>
        {managingAccess ? (
          <V2ManageAccessDialog
            kind="document"
            id={documentId}
            open
            onOpenChange={setManagingAccess}
            readOnlyRefusal={readOnlyRefusal}
          />
        ) : null}
        {moving ? (
          <V2MoveDocumentDialog
            kind={isFile ? "file" : "document"}
            id={documentId}
            name={data.record.name}
            folderId={data.record.folderId ?? null}
            folderName={data.record.folder?.name ?? null}
            onOpenChange={setMoving}
            readOnlyRefusal={readOnlyRefusal}
            beforeSave={settleSaves}
            onSaved={(row: CompanyDocument, folder) => {
              mergeRecord({ ...toDocumentRecord(source, row), folder });
              staleRegister("active");
            }}
          />
        ) : null}
      </>
    ) : null;

  const handlePrint = () => {
    const original = window.document.title;
    window.document.title = [projectName, queueRef.current?.draft.title.trim() || "Untitled"].filter(Boolean).join(" - ");
    const restore = () => {
      window.document.title = original;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    // v1 waits a beat so the browser takes the new title as the PDF name.
    window.setTimeout(() => window.print(), 100);
  };

  const back = documentBack(source, opportunity);
  if (waiting) return <EditorLoading embedded={embedded} {...back} />;

  if (loadFailed) return <DocumentLoadFailed embedded={embedded} {...back} onRetry={() => refetch()} />;

  if (editor.missing) {
    return (
      <div className="df-editor-page" data-testid="v2-document-editor">
        {editor.refusal && !embedded ? (
          <header className="df-editor-head">
            <BackLink backHref={editor.backHref} backLabel={editor.backLabel} />
          </header>
        ) : null}
        {editor.refusal ? (
          <p className="df-refusal">{editor.refusal}</p>
        ) : (
          <V2EmptyState
            icon="documents"
            title={editor.emptyTitle}
            copy={editor.emptyCopy}
            testId="v2-document-missing"
            action={embedded ? undefined : <BackLink backHref={editor.backHref} backLabel={editor.backLabel} />}
          />
        )}
      </div>
    );
  }

  const meta =
    !data?.record || (source === "project" && embedded)
      ? ""
      : source === "project"
        ? projectDocumentMetaLine(data.record, opportunity, new Date())
        : documentMetaLine(data.record, new Date());
  const description = data?.record?.description?.trim() || "";

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
          effectiveAccess: record?.effectiveAccess ?? null,
          backHref: editor.backHref,
          filing: meta,
          description,
        })}
        actions={manageAccess}
      />
    );
  }

  return (
    <div className="df-editor-page" data-testid="v2-document-editor">
      <header className="df-editor-head">
        {embedded ? null : <BackLink backHref={editor.backHref} backLabel={editor.backLabel} />}
        {meta ? (
          <div className="df-file-identity">
            <div className="df-editor-meta" data-testid="v2-document-meta">
              {meta}
            </div>
            {description ? (
              <div className="df-editor-description" title={description}>
                {description}
              </div>
            ) : null}
          </div>
        ) : null}
        {editor.saveLabel ? (
          <span className="df-save-state" data-state={saveState} data-motion={saveState === "idle" ? "none" : "standard"}>
            {editor.saveLabel}
          </span>
        ) : null}
        {queue && documentNameMissing(queue.draft.title, queue.storedName) ? (
          <span className="df-save-hint" role="status">
            {DOCUMENT_BLANK_NAME_COPY}
          </span>
        ) : null}
        {writeRefusal ? (
          <p className="df-refusal df-flush">
            {writeRefusal}
          </p>
        ) : null}
        {manageAccess}
        {embedded ? (
          <Button
            variant="outline"
            type="button"
            className="df-btn df-editor-print"
            onClick={handlePrint}
            data-testid="v2-document-print"
          >
            Print
          </Button>
        ) : null}
      </header>
      {saveState === "conflict" ? (
        <div className="df-editor-notice" role="alert" data-testid="v2-document-conflict">
          <p>{DOCUMENT_CONFLICT_COPY}</p>
          <span className="df-cluster">
            <Button variant="outline" type="button" className="df-btn" onClick={loadTheirs}>
              Load their version
            </Button>
            <Button variant="outline" type="button" className="df-btn" onClick={keepMine}>
              Keep mine
            </Button>
          </span>
        </div>
      ) : null}
      <div className="df-editor">
        {queue ? (
          <BlockEditor
            key={`${documentId}-${seed}`}
            content={queue.draft.content}
            onChange={handleContentChange}
            onImageUpload={handleImageUpload}
            onDocumentUpload={readOnly ? undefined : handleDocumentUpload}
            title={queue.draft.title}
            onTitleChange={handleTitleChange}
            titlePlaceholder="Untitled"
            editable={!readOnly}
          />
        ) : null}
      </div>
    </div>
  );
}
