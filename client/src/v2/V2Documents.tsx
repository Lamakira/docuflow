import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type {
  CompanyDocumentFolderWithCreator,
  CompanyDocumentWithUploader,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import {
  composeLibrary,
  folderPath,
  type LibraryDocument,
  type LibraryFolder,
  type LibraryInput,
} from "./library";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2LibraryRegister, useFolderExpandMotion } from "./V2Library";
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

type LibraryPayload = {
  capabilityMiss: boolean;
  folders: CompanyDocumentFolderWithCreator[];
  documents: CompanyDocumentWithUploader[];
};

type CreateMode = "document" | "folder" | "upload" | null;

function actionFromSearch(): CreateMode {
  const params = new URLSearchParams(window.location.search);
  if (params.get("new") === "1") return "document";
  if (params.get("folder") === "1") return "folder";
  if (params.get("upload") === "1") return "upload";
  return null;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function loadWorkspaceLibrary(): Promise<LibraryPayload> {
  const foldersRes = await fetch("/api/company-document-folders", { credentials: "include" });
  if (foldersRes.status === 401 || foldersRes.status === 403) {
    return { capabilityMiss: true, folders: [], documents: [] };
  }
  if (!foldersRes.ok) throw new Error("Failed to fetch Workspace Document folders");
  const folders = await readJson<CompanyDocumentFolderWithCreator[]>(foldersRes);

  const rootRes = await fetch("/api/company-documents", { credentials: "include" });
  if (rootRes.status === 401 || rootRes.status === 403) {
    return { capabilityMiss: true, folders: [], documents: [] };
  }
  if (!rootRes.ok) throw new Error("Failed to fetch Workspace Documents");
  const root = await readJson<CompanyDocumentWithUploader[]>(rootRes);

  const nested = await Promise.all(
    folders.map(async (folder) => {
      const res = await fetch(`/api/company-documents?folderId=${encodeURIComponent(folder.id)}`, {
        credentials: "include",
      });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) return [] as CompanyDocumentWithUploader[];
      return readJson<CompanyDocumentWithUploader[]>(res);
    }),
  );
  if (nested.some((item) => item === null)) {
    return { capabilityMiss: true, folders: [], documents: [] };
  }

  return {
    capabilityMiss: false,
    folders,
    documents: [...root, ...nested.flatMap((item) => item ?? [])],
  };
}

function toFolder(folder: CompanyDocumentFolderWithCreator): LibraryFolder {
  return {
    id: folder.id,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    createdBy: folder.createdBy
      ? {
          firstName: folder.createdBy.firstName,
          lastName: folder.createdBy.lastName,
          email: folder.createdBy.email,
        }
      : null,
  };
}

function toDocument(document: CompanyDocumentWithUploader): LibraryDocument {
  return {
    id: document.id,
    name: document.name,
    folderId: document.folderId,
    access: document.access,
    content: document.content,
    storagePath: document.storagePath,
    fileName: document.fileName,
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
  const [, navigate] = useLocation();
  const { memberships } = useV2Chrome();
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>(() => actionFromSearch());
  const [name, setName] = useState("");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const { data, isLoading } = useQuery<LibraryPayload>({
    queryKey: ["/api/company-document-folders", "workspace-library"],
    queryFn: loadWorkspaceLibrary,
  });
  const ownerName = useWorkspaceOwnerName();

  const input: LibraryInput = {
    now,
    workspaceName,
    folders: (data?.folders ?? []).map(toFolder),
    documents: (data?.documents ?? []).map(toDocument),
    expandedFolderIds,
    selectedFolderId,
    filterQuery,
    capabilityMiss: data?.capabilityMiss === true,
    ownerName,
  };
  const library = composeLibrary(input);
  const folderMotion = useFolderExpandMotion(filterQuery);
  const previewFolderId = library.preview?.folderId ?? null;
  const previewFolderName = library.preview?.name ?? "";

  useEffect(() => {
    setFolderName(previewFolderName);
  }, [previewFolderId, previewFolderName]);

  function refuseWrite(errorMessage?: string) {
    if (readOnly) {
      setWriteRefusal(
        chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }),
      );
      return true;
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
        ...(selectedFolderId ? { folderId: selectedFolderId } : {}),
      }),
    onSuccess: (created: { id?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setCreateMode(null);
      setName("");
      setWriteRefusal(null);
      if (created?.id) navigate(`/documents/${created.id}`);
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  const createFolder = useMutation({
    mutationFn: (folderName: string) => apiRequest("POST", "/api/company-document-folders", { name: folderName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      setCreateMode(null);
      setName("");
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const urlResponse = await apiRequest("POST", "/api/company-documents/upload-url");
      const { uploadURL, objectPath } = urlResponse as { uploadURL: string; objectPath: string };
      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadResponse.ok) throw new Error(`Failed to upload ${file.name}`);
      return apiRequest("POST", "/api/company-documents", {
        name: file.name.replace(/\.[^/.]+$/, ""),
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        storagePath: objectPath,
        ...(selectedFolderId ? { folderId: selectedFolderId } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      setCreateMode(null);
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
    setSelectedFolderId(folderId);
    setExpandedFolderIds((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId],
    );
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (refuseWrite()) return;
    if (createMode === "folder") createFolder.mutate(trimmed);
    if (createMode === "document") createDocument.mutate(trimmed);
  }

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

  return (
    <div className="df-library" data-testid="v2-documents">
      <div className="df-library-main">
        <header className="df-today-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="df-title">Workspace Documents</h1>
            <p className="df-subhead">{library.subhead}</p>
          </div>
          <div className="df-library-actions">
            <Button variant="outline" type="button" onClick={() => setCreateMode("folder")} className="df-btn">
              New folder
            </Button>
            <Button variant="outline" type="button" onClick={() => setCreateMode("upload")} className="df-btn">
              Upload File
            </Button>
            <Button variant="default" type="button" onClick={() => setCreateMode("document")} className="df-btn">
              New Document
            </Button>
          </div>
        </header>

        {createMode === "document" || createMode === "folder" ? (
          <form className="df-filter-bar" onSubmit={onCreate}>
            <label className="df-filter-input">
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={createMode === "folder" ? "Folder name" : "Document name"}
                aria-label={createMode === "folder" ? "Folder name" : "Document name"}
              />
            </label>
            <Button variant="default" type="submit" disabled={createDocument.isPending || createFolder.isPending || !name.trim()} className="df-btn">
              Create
            </Button>
          </form>
        ) : null}
        {createMode === "upload" ? (
          <div className="df-filter-bar">
            <label className="df-filter-input">
              <input
                type="file"
                aria-label="Upload File"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (refuseWrite()) return;
                  uploadFile.mutate(file);
                }}
              />
            </label>
          </div>
        ) : null}
        {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

        <div className="df-filter-bar">
          <label className="df-filter-input">
            <Search width={14} height={14} strokeWidth={1.4} color="#59657A" />
            <input
              type="search"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Filter this library"
              aria-label="Filter this library"
            />
          </label>
          <span className="df-filter-chip">TYPE: ALL</span>
          <span className="df-filter-chip">OWNER: ANY</span>
          <span className="df-filter-chip" data-active="true">
            ACCESS: EVERYONE
          </span>
          <span className="df-filter-chip">UPDATED: 90 d</span>
          <div className="df-segment" role="group" aria-label="Library density">
            <span data-active="true">LIST</span>
            <span>GRID</span>
          </div>
        </div>

        <V2LibraryRegister
          library={library}
          testId="v2-documents-register"
          instantExpand={folderMotion.instantExpand}
          onFolderClick={onFolderClick}
        />
      </div>

      {library.preview ? (
        <aside className="df-panel df-folder-preview" data-testid="v2-folder-preview">
          <header className="df-panel-head">
            <div className="df-mono" style={{ fontSize: 10, color: "#59657A", letterSpacing: "0.08em" }}>
              FOLDER PREVIEW
            </div>
            <div style={{ fontFamily: "var(--df-font-display)", fontWeight: 700, fontSize: 18 }}>
              {library.preview.title}
            </div>
            <div className="df-mono df-meta df-meta-follow">
              {library.preview.meta}
            </div>
          </header>
          <div className="df-panel-scroll">
            <div className="df-mono df-meta">ACCESS</div>
            <p className="df-prose df-prose-follow" style={{ color: "var(--df-archive-slate)" }}>
              {library.preview.accessCopy}
            </p>
            <form className="df-daily-form df-folder-rename" onSubmit={onRenameFolder}>
              <label className="df-daily-field">
                NAME
                <input
                  type="text"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  aria-label="Folder name"
                />
              </label>
              <div className="df-form-actions">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="destructiveOutline"
                      className="df-btn"
                      disabled={deleteFolder.isPending}
                      data-testid="v2-folder-delete"
                    >
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
                        Delete folder
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button
                  variant="outline"
                  type="submit"
                  disabled={renameFolder.isPending || !folderName.trim() || folderName.trim() === library.preview.name}
                  className="df-btn"
                >
                  Rename
                </Button>
              </div>
            </form>
          </div>
          <footer className="df-panel-foot">
            <Button variant="default" type="button" style={{ flex: 1 }} onClick={() => { if (!selectedFolderId) return; setExpandedFolderIds((current) => current.includes(selectedFolderId) ? current : [...current, selectedFolderId], ); }} className="df-btn">
              Open folder
            </Button>
            <Button asChild variant="outline" className="df-btn"><Link href="/documents/access">
              Manage access
            </Link></Button>
          </footer>
        </aside>
      ) : null}
    </div>
  );
}
