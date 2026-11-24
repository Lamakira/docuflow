import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import type {
  CompanyDocumentFolderWithCreator,
  CompanyDocumentWithUploader,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { isStandingRefusal, notify } from "./notify";
import {
  clearLibraryFilters,
  composeLibrary,
  folderChoices,
  folderPath,
  libraryOwnerOptions,
  readLibraryFilters,
  writeLibraryFilters,
  LIBRARY_ACCESS_OPTIONS,
  LIBRARY_TYPE_OPTIONS,
  LIBRARY_UPDATED_OPTIONS,
  type LibraryDocument,
  type LibraryFilters,
  type LibraryFolder,
  type LibraryInput,
} from "./library";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { WORKSPACE_LIBRARY_OPEN_KEY, readLibraryOpenState, writeLibraryOpenState, type LibraryOpenState } from "./presentation";
import { V2LibraryRegister, useFolderExpandMotion } from "./V2Library";
import { V2EmptyState } from "./V2EmptyState";
import { V2FormDialog } from "./V2FormDialog";
import { V2ManageAccessDialog } from "./V2ManageAccessDialog";
import { V2UploadDialog, fileTitle, storeUpload } from "./V2UploadDialog";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { V2PreviewHead } from "./V2PreviewHead";
import { focusPreviewOpener, previewClosesOnKey, togglePreviewSelection } from "./previewPanel";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SkeletonLibrary, V2PageSkeleton } from "./V2Skeleton";

/** What the register route adds to a Folder: whether the reader may delete it. */
type RegisterFolder = CompanyDocumentFolderWithCreator & { canDelete?: boolean };
/** The register lists Documents without their full text. */
type RegisterDocument = Omit<CompanyDocumentWithUploader, "content">;

type LibraryPayload = {
  capabilityMiss: boolean;
  folders: RegisterFolder[];
  documents: RegisterDocument[];
};

const MAX_FOLDER_NAME = 255;
const MAX_DOCUMENT_NAME = 500;

type CreateMode = "document" | "folder" | "upload" | null;

const SEARCH_SETTLE_MS = 250;

function restoredOpenState(): LibraryOpenState {
  try {
    return readLibraryOpenState(window.sessionStorage, WORKSPACE_LIBRARY_OPEN_KEY);
  } catch {
    return { expanded: [], selected: null };
  }
}

const CREATE_PARAMS = ["new", "folder", "upload"] as const;

function actionFromSearch(search: string = window.location.search): CreateMode {
  const params = new URLSearchParams(search);
  if (params.get("new") === "1") return "document";
  if (params.get("folder") === "1") return "folder";
  if (params.get("upload") === "1") return "upload";
  return null;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// One route answers the whole register: Folders and Documents without their text.
async function loadWorkspaceLibrary(): Promise<LibraryPayload> {
  const res = await fetch("/api/company-documents/register", { credentials: "include" });
  if (res.status === 401 || res.status === 403) {
    return { capabilityMiss: true, folders: [], documents: [] };
  }
  if (!res.ok) throw new Error("Failed to fetch Workspace Documents");
  const register = await readJson<{ folders: RegisterFolder[]; documents: RegisterDocument[] }>(res);
  return { capabilityMiss: false, folders: register.folders, documents: register.documents };
}

function toFolder(folder: RegisterFolder): LibraryFolder {
  return {
    id: folder.id,
    name: folder.name,
    description: folder.description,
    parentId: folder.parentId,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    createdBy: folder.createdBy
      ? {
          firstName: folder.createdBy.firstName,
          lastName: folder.createdBy.lastName,
          email: folder.createdBy.email,
        }
      : null,
    access: folder.access,
    effectiveAccess: folder.effectiveAccess,
    canManageAccess: folder.canManageAccess,
    canDelete: folder.canDelete === true,
  };
}

function toDocument(document: RegisterDocument): LibraryDocument {
  return {
    id: document.id,
    name: document.name,
    folderId: document.folderId,
    access: document.access,
    effectiveAccess: document.effectiveAccess,
    canManageAccess: document.canManageAccess,
    storagePath: document.storagePath,
    fileName: document.fileName,
    uploadedById: document.uploadedById,
    uploadedBy: document.uploadedBy
      ? {
          firstName: document.uploadedBy.firstName,
          lastName: document.uploadedBy.lastName,
          email: document.uploadedBy.email,
        }
      : null,
    updatedAt: document.updatedAt,
    createdAt: document.createdAt,
  };
}

export function V2DocumentsPage() {
  const now = useMemo(() => new Date(), []);
  const search = useSearch();
  const [, navigate] = useLocation();
  const { memberships } = useV2Chrome();
  const filters = readLibraryFilters(search);
  const [filterQuery, setFilterQuery] = useState(filters.q);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(() => restoredOpenState().expanded);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() => restoredOpenState().selected);
  useEffect(() => {
    try {
      writeLibraryOpenState(window.sessionStorage, WORKSPACE_LIBRARY_OPEN_KEY, { expanded: expandedFolderIds, selected: selectedFolderId });
    } catch {
      // Storage can throw in private modes; the folders just start closed next time.
    }
  }, [expandedFolderIds, selectedFolderId]);
  const [createMode, setCreateMode] = useState<CreateMode>(() => actionFromSearch());
  const [managingFolderId, setManagingFolderId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<string>(V2_SELECT_NONE);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
  const readOnlyRefusal = readOnly
    ? chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" })
    : null;

  function setFilters(next: LibraryFilters) {
    navigate(`/documents${writeLibraryFilters(search, next)}`, { replace: true });
  }

  // Opening the dialog from the address (?new=1, ?folder=1, ?upload=1) works each time the address says so.
  useEffect(() => {
    const mode = actionFromSearch(search);
    if (mode) setCreateMode(mode);
  }, [search]);

  // Closing the dialog drops its param, so a reload does not open it again.
  function closeCreate() {
    setCreateMode(null);
    const params = new URLSearchParams(search);
    if (!CREATE_PARAMS.some((param) => params.has(param))) return;
    for (const param of CREATE_PARAMS) params.delete(param);
    const query = params.toString();
    navigate(`/documents${query ? `?${query}` : ""}`, { replace: true });
  }

  // The filter box answers each keystroke; the URL follows once typing settles.
  useEffect(() => {
    if (filterQuery === filters.q) return;
    const timer = window.setTimeout(() => setFilters({ ...filters, q: filterQuery }), SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [filterQuery]);

  // Every visit re-reads; the cached list shows while it does (F55).
  const { data, isLoading, isError, refetch } = useQuery<LibraryPayload>({
    queryKey: ["/api/company-document-folders", "workspace-library"],
    queryFn: loadWorkspaceLibrary,
    staleTime: 0,
  });
  // A refresh that fails keeps the cached list on screen and says so once.
  useEffect(() => {
    if (isError && data) {
      notify.error(null, { fallback: "Workspace Documents could not be refreshed.", id: "v2-documents-refresh-failed" });
    }
  }, [isError, data]);
  const ownerName = useWorkspaceOwnerName();

  const documents = (data?.documents ?? []).map(toDocument);
  const input: LibraryInput = {
    now,
    workspaceName,
    folders: (data?.folders ?? []).map(toFolder),
    documents,
    expandedFolderIds,
    selectedFolderId,
    filterQuery,
    capabilityMiss: data?.capabilityMiss === true,
    ownerName,
    filters: { type: filters.type, owner: filters.owner, access: filters.access, updated: filters.updated },
  };
  const library = composeLibrary(input);
  const ownerOptions = libraryOwnerOptions(documents);
  const destinations = [
    { value: V2_SELECT_NONE, label: "Workspace root" },
    ...folderChoices(input.folders),
  ];
  const target = targetFolderId === V2_SELECT_NONE ? null : targetFolderId;
  const folderMotion = useFolderExpandMotion(filterQuery);
  const previewFolderId = library.preview?.folderId ?? null;
  const previewFolderName = library.preview?.name ?? "";

  useEffect(() => {
    setFolderName(previewFolderName);
  }, [previewFolderId, previewFolderName]);

  function refuseWrite(errorMessage?: string) {
    if (readOnlyRefusal) {
      setWriteRefusal(readOnlyRefusal);
      return true;
    }
    if (errorMessage && !isStandingRefusal(errorMessage)) {
      notify.error(errorMessage);
      return false;
    }
    if (errorMessage) {
      setWriteRefusal(chromeRefusal({ kind: "generic", message: errorMessage }));
    }
    return false;
  }

  const createDocument = useMutation({
    mutationFn: (documentName: string) =>
      apiRequest("POST", "/api/company-documents", {
        name: documentName,
        content: { type: "doc", content: [{ type: "paragraph" }] },
        ...(target ? { folderId: target } : {}),
      }),
    onSuccess: (created: { id?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      closeCreate();
      setName("");
      setWriteRefusal(null);
      notify.success("Document created");
      if (created?.id) navigate(`/documents/${created.id}`);
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  const createFolder = useMutation({
    mutationFn: (folderName: string) =>
      apiRequest("POST", "/api/company-document-folders", { name: folderName, parentId: target }),
    onSuccess: (created: { id?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      if (target) setExpandedFolderIds((current) => (current.includes(target) ? current : [...current, target]));
      if (created?.id) setSelectedFolderId(created.id);
      closeCreate();
      setName("");
      setWriteRefusal(null);
      notify.success("Folder created");
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const objectPath = await storeUpload(file);
      return apiRequest("POST", "/api/company-documents", {
        name: fileTitle(file),
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        storagePath: objectPath,
        ...(target ? { folderId: target } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  // A folder could be created and never tidied; it can now be renamed and deleted (#260).
  const renameFolder = useMutation({
    mutationFn: ({ id, name: nextName }: { id: string; name: string }) =>
      apiRequest("PATCH", folderPath(id), { name: nextName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      setWriteRefusal(null);
      notify.success("Folder renamed");
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  const deleteFolder = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", folderPath(id)),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setSelectedFolderId(null);
      setExpandedFolderIds((current) => current.filter((folderId) => folderId !== id));
      setWriteRefusal(null);
      notify.success("Folder deleted");
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  function onRenameFolder(event: FormEvent) {
    event.preventDefault();
    const trimmed = folderName.trim();
    if (!previewFolderId || !trimmed || trimmed === previewFolderName) return;
    if (refuseWrite()) return;
    renameFolder.mutate({ id: previewFolderId, name: trimmed });
  }

  function onDeleteFolder() {
    if (!previewFolderId) return;
    if (refuseWrite()) return;
    deleteFolder.mutate(previewFolderId);
  }

  function onFolderClick(folderId: string) {
    folderMotion.onUserExpand();
    setSelectedFolderId((current) => togglePreviewSelection(current, folderId));
    setExpandedFolderIds((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId],
    );
  }

  function closePreview() {
    const opener = selectedFolderId;
    setSelectedFolderId(null);
    if (opener) focusPreviewOpener(`[data-testid="v2-folder-row-${opener}"]`);
  }

  function onLibraryKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const closes = previewClosesOnKey({
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      previewOpen: Boolean(library.preview),
      focusInPage: event.currentTarget.contains(event.target as Node),
      dialogOpen: Boolean(managingFolderId) || confirmingDelete || createMode !== null,
    });
    if (!closes) return;
    event.preventDefault();
    closePreview();
  }

  function openCreate(mode: Exclude<CreateMode, null>) {
    setTargetFolderId(selectedFolderId ?? V2_SELECT_NONE);
    setName("");
    setWriteRefusal(null);
    setCreateMode(mode);
  }

  function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (refuseWrite()) return;
    if (createMode === "folder") createFolder.mutate(trimmed);
    if (createMode === "document") createDocument.mutate(trimmed);
  }

  const creating = createMode === "document" || createMode === "folder";
  const destinationField = (
    <label className="df-daily-field">
      Folder
      <V2FilterSelect
        label=""
        ariaLabel={createMode === "folder" ? "Parent Folder" : "Folder"}
        value={targetFolderId}
        options={destinations}
        onChange={setTargetFolderId}
      />
    </label>
  );

  if (isLoading) {
    return (
      <V2PageSkeleton
        title="Workspace Documents"
        testId="v2-documents"
        frame="library"
        status="Loading Workspace Documents."
      >
        <SkeletonLibrary />
      </V2PageSkeleton>
    );
  }

  if (isError && !data) {
    return (
      <div className="df-page" data-testid="v2-documents">
        <header className="df-today-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="df-title">Workspace Documents</h1>
          </div>
        </header>
        <V2EmptyState
          icon="documents"
          title="Workspace Documents could not be loaded."
          copy="Something went wrong while loading them. Try again."
          testId="v2-documents-load-failed"
          action={
            <Button variant="default" type="button" className="df-btn" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="df-library-page" data-testid="v2-documents" onKeyDown={onLibraryKeyDown}>
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Workspace Documents</h1>
          <p className="df-subhead">{library.subhead}</p>
        </div>
        <div className="df-library-actions">
          <Button variant="outline" type="button" onClick={() => openCreate("folder")} className="df-btn">
            <Plus strokeWidth={1.6} aria-hidden />
            New folder
          </Button>
          <Button variant="outline" type="button" onClick={() => openCreate("upload")} className="df-btn">
            <Upload strokeWidth={1.6} aria-hidden />
            Upload File
          </Button>
          <Button variant="default" type="button" onClick={() => openCreate("document")} className="df-btn">
            <Plus strokeWidth={1.6} aria-hidden />
            New Document
          </Button>
        </div>
      </header>

      <V2FormDialog
        open={creating}
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
        title={createMode === "folder" ? "New Folder" : "New Document"}
        description={
          createMode === "folder"
            ? "A Folder groups Workspace Documents and Files. It can sit at the root or inside any Folder."
            : "A Workspace Document belongs to the Workspace, not to a single Project. It opens in the editor once created."
        }
        submitLabel={createMode === "folder" ? "Create Folder" : "Create Document"}
        pending={createDocument.isPending || createFolder.isPending}
        canSubmit={Boolean(name.trim())}
        onSubmit={onCreate}
        refusal={writeRefusal}
        testId={createMode === "folder" ? "v2-documents-new-folder" : "v2-documents-new-document"}
      >
        <label className="df-daily-field">
          Name
          <input
            type="text"
            value={name}
            autoFocus
            maxLength={createMode === "folder" ? MAX_FOLDER_NAME : MAX_DOCUMENT_NAME}
            onChange={(event) => setName(event.target.value)}
            placeholder={createMode === "folder" ? "Folder name" : "Document name"}
            aria-label={createMode === "folder" ? "Folder name" : "Document name"}
          />
        </label>
        {destinationField}
      </V2FormDialog>

      <V2UploadDialog
        open={createMode === "upload"}
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
        description="Files are stored in the Workspace and open in the viewer. Drop several at once; each becomes its own row."
        upload={(file) => uploadFile.mutateAsync(file)}
        pending={uploadFile.isPending}
        beforeUpload={() => refuseWrite()}
        refusal={writeRefusal}
        testId="v2-documents-upload"
      >
        {destinationField}
      </V2UploadDialog>
      {writeRefusal && !createMode ? <p className="df-refusal">{writeRefusal}</p> : null}

      <div className="df-library">
        <div className="df-library-main">
          <div className="df-filter-bar">
            <label className="df-filter-input">
              <Search width={14} height={14} strokeWidth={1.4} style={{ color: "var(--df-archive-slate)" }} />
              <input
                type="search"
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder="Search this library"
                aria-label="Search this library"
              />
            </label>
            <V2FilterSelect
              label="Type"
              ariaLabel="Filter by type"
              value={filters.type}
              active={filters.type !== "all"}
              options={LIBRARY_TYPE_OPTIONS}
              onChange={(type) => setFilters({ ...filters, type: type as LibraryFilters["type"] })}
            />
            {ownerOptions.length === 0 && filters.owner === "all" ? null : (
              <V2FilterSelect
                label="Added by"
                ariaLabel="Filter by who added it"
                value={filters.owner}
                active={filters.owner !== "all"}
                options={[{ value: "all", label: "Any" }, ...ownerOptions]}
                onChange={(owner) => setFilters({ ...filters, owner })}
              />
            )}
            <V2FilterSelect
              label="Access"
              ariaLabel="Filter by access"
              value={filters.access}
              active={filters.access !== "all"}
              options={LIBRARY_ACCESS_OPTIONS}
              onChange={(access) => setFilters({ ...filters, access: access as LibraryFilters["access"] })}
            />
            <V2FilterSelect
              label="Updated"
              ariaLabel="Filter by last update"
              value={filters.updated}
              active={filters.updated !== "all"}
              options={LIBRARY_UPDATED_OPTIONS}
              onChange={(updated) => setFilters({ ...filters, updated: updated as LibraryFilters["updated"] })}
            />
          </div>

          <V2LibraryRegister
            library={library}
            testId="v2-documents-register"
            instantExpand={folderMotion.instantExpand}
            onFolderClick={onFolderClick}
            emptyAction={
              library.filtered ? (
                <Button
                  variant="outline"
                  type="button"
                  className="df-btn"
                  onClick={() => {
                    setFilterQuery("");
                    setFilters(clearLibraryFilters());
                  }}
                >
                  {library.emptyState?.kind === "search" ? "Clear search" : "Clear filters"}
                </Button>
              ) : null
            }
            createActions={
              <>
                <Button variant="default" type="button" onClick={() => openCreate("document")} className="df-btn">
                  <Plus strokeWidth={1.6} aria-hidden />
                  New Document
                </Button>
                <Button variant="outline" type="button" onClick={() => openCreate("upload")} className="df-btn">
                  <Upload strokeWidth={1.6} aria-hidden />
                  Upload File
                </Button>
                <Button variant="outline" type="button" onClick={() => openCreate("folder")} className="df-btn">
                  <Plus strokeWidth={1.6} aria-hidden />
                  New folder
                </Button>
              </>
            }
          />
        </div>

        {library.preview ? (
          <aside className="df-panel df-folder-preview" data-testid="v2-folder-preview">
            <V2PreviewHead
              kicker="Folder preview"
              title={library.preview.title}
              meta={library.preview.meta}
              onClose={closePreview}
            />
            <div className="df-panel-scroll">
              {library.preview.description ? (
                <>
                  <div className="df-mono df-meta">Description</div>
                  <p className="df-prose df-prose-follow" data-testid="v2-folder-description">
                    {library.preview.description}
                  </p>
                </>
              ) : null}
              <div className="df-mono df-meta">Access</div>
              <p className="df-prose df-prose-follow" style={{ color: "var(--df-archive-slate)" }}>
                {library.preview.accessCopy}
              </p>
              <form className="df-daily-form df-folder-rename" onSubmit={onRenameFolder}>
                <label className="df-daily-field">
                  Name
                  <input
                    type="text"
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                    maxLength={MAX_FOLDER_NAME}
                    aria-label="Folder name"
                  />
                </label>
                <div className="df-form-actions">
                  {library.preview.canDelete ? (
                    <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="destructiveOutline"
                          className="df-btn"
                          disabled={deleteFolder.isPending}
                          data-testid="v2-folder-delete"
                        >
                          <Trash2 strokeWidth={1.6} aria-hidden />
                          Delete folder
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="df-v2 df-alert">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete folder</AlertDialogTitle>
                          <AlertDialogDescription>{library.preview.deleteConsequence}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="df-btn" autoFocus>
                            Keep folder
                          </AlertDialogCancel>
                          <AlertDialogAction
                            className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            data-testid="v2-folder-delete-confirm"
                            onClick={onDeleteFolder}
                          >
                            <Trash2 strokeWidth={1.6} aria-hidden />
                            Delete folder
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                  <Button
                    variant="outline"
                    type="submit"
                    disabled={renameFolder.isPending || !folderName.trim() || folderName.trim() === library.preview.name}
                    className="df-btn"
                  >
                    <Pencil strokeWidth={1.6} aria-hidden />
                    Rename
                  </Button>
                </div>
              </form>
            </div>
            {library.preview.canManageAccess ? (
              <footer className="df-panel-foot">
                <Button
                  variant="outline"
                  type="button"
                  style={{ flex: 1 }}
                  className="df-btn"
                  data-testid="v2-folder-manage-access"
                  onClick={() => setManagingFolderId(library.preview?.folderId ?? null)}
                >
                  <KeyRound strokeWidth={1.6} aria-hidden />
                  Manage access
                </Button>
              </footer>
            ) : null}
          </aside>
        ) : null}
      </div>
      {managingFolderId ? (
        <V2ManageAccessDialog
          kind="folder"
          id={managingFolderId}
          open
          onOpenChange={(open) => {
            if (!open) setManagingFolderId(null);
          }}
          readOnlyRefusal={readOnlyRefusal}
        />
      ) : null}
    </div>
  );
}
