import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FileText, Folder, Search } from "lucide-react";
import type {
  CompanyDocumentFolderWithCreator,
  CompanyDocumentWithUploader,
  SafeUser,
} from "@shared/schema";
import {
  composeLibrary,
  type LibraryDocument,
  type LibraryFolder,
  type LibraryInput,
} from "./library";
import { memberName } from "./today";

type LibraryPayload = {
  capabilityMiss: boolean;
  folders: CompanyDocumentFolderWithCreator[];
  documents: CompanyDocumentWithUploader[];
};

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
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<LibraryPayload>({
    queryKey: ["/api/company-document-folders", "workspace-library"],
    queryFn: loadWorkspaceLibrary,
  });
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const owner = users.find((member) => member.isMainAdmin === 1);

  const input: LibraryInput = {
    now,
    workspaceName: "this Workspace",
    folders: (data?.folders ?? []).map(toFolder),
    documents: (data?.documents ?? []).map(toDocument),
    expandedFolderIds,
    selectedFolderId,
    filterQuery,
    capabilityMiss: data?.capabilityMiss === true,
    ownerName: owner ? memberName(owner) : null,
  };
  const library = composeLibrary(input);

  function onFolderClick(folderId: string) {
    setSelectedFolderId(folderId);
    setExpandedFolderIds((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId],
    );
  }

  if (isLoading) {
    return (
      <div className="df-library" data-testid="v2-documents">
        <div className="df-library-main">
          <header className="df-today-head">
            <div>
              <h1 className="df-title">Workspace Documents</h1>
              <p className="df-subhead">Loading this Workspace…</p>
            </div>
          </header>
          <div className="df-card" style={{ minHeight: 280 }} />
        </div>
      </div>
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
            <Link href="/documents/new-folder" className="df-ghost-btn">
              New folder
            </Link>
            <Link href="/documents/upload" className="df-ghost-btn">
              Upload File
            </Link>
            <Link href="/documents/new" className="df-ink-btn">
              New Document
            </Link>
          </div>
        </header>

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

        <section className="df-card" data-testid="v2-documents-register">
          <div className="df-library-head">
            <span>NAME / PATH</span>
            <span>TYPE</span>
            <span>ACCESS</span>
            <span>LAST EDITOR</span>
            <span style={{ textAlign: "right" }}>UPDATED</span>
          </div>
          {library.refusal ? (
            <p className="df-refusal">{library.refusal}</p>
          ) : library.empty ? (
            <p className="df-empty">{library.emptyCopy}</p>
          ) : (
            library.rows.map((row) => {
              const body = (
                <>
                  <span style={{ minWidth: 0, display: "flex", alignItems: "flex-start", gap: 10 }}>
                    {row.kind === "folder" ? (
                      <Folder width={15} height={15} strokeWidth={1.4} color="#0F1524" style={{ marginTop: 2, flex: "none" }} />
                    ) : (
                      <FileText width={15} height={15} strokeWidth={1.4} color="#59657A" style={{ marginTop: 2, flex: "none" }} />
                    )}
                    <span style={{ minWidth: 0 }}>
                      <div
                        className="df-row-title"
                        style={{
                          fontWeight: row.kind === "folder" ? 600 : 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.name}
                      </div>
                      <div className="df-mono df-meta">{row.path}</div>
                    </span>
                  </span>
                  <span className="df-mono df-meta">{row.type}</span>
                  <span>
                    <span className="df-status">{row.access}</span>
                  </span>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>{row.editor}</span>
                  <span className="df-mono" style={{ fontSize: 12, textAlign: "right" }}>
                    {row.updated}
                  </span>
                </>
              );

              if (row.kind === "folder") {
                return (
                  <button
                    key={row.id}
                    type="button"
                    className="df-library-row"
                    data-expanded={row.expanded ? "true" : "false"}
                    data-selected={row.selected ? "true" : "false"}
                    data-testid={`v2-folder-row-${row.id}`}
                    onClick={() => onFolderClick(row.id)}
                  >
                    {body}
                  </button>
                );
              }

              return (
                <Link
                  key={row.id}
                  href={row.href ?? "/documents/new"}
                  className="df-library-row"
                  data-child={row.child ? "true" : "false"}
                  data-testid={`v2-document-row-${row.id}`}
                >
                  {body}
                </Link>
              );
            })
          )}
          <div className="df-library-foot">
            <span>
              {library.itemCount} {library.itemCount === 1 ? "ITEM" : "ITEMS"} · {library.folderCount}{" "}
              {library.folderCount === 1 ? "FOLDER" : "FOLDERS"}
            </span>
          </div>
        </section>
      </div>

      {library.preview ? (
        <aside className="df-panel df-folder-preview" data-testid="v2-folder-preview">
          <header
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid #D8DEE6",
            }}
          >
            <div className="df-mono" style={{ fontSize: 10, color: "#59657A", letterSpacing: "0.08em" }}>
              FOLDER PREVIEW
            </div>
            <div style={{ fontFamily: "var(--df-font-display)", fontWeight: 700, fontSize: 18 }}>
              {library.preview.title}
            </div>
            <div className="df-mono df-meta" style={{ marginTop: 4 }}>
              {library.preview.meta}
            </div>
          </header>
          <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
            <div className="df-mono df-meta">ACCESS</div>
            <p className="df-prose" style={{ marginTop: 8, color: "#59657A" }}>
              {library.preview.accessCopy}
            </p>
          </div>
          <footer
            style={{
              padding: 12,
              borderTop: "1px solid #D8DEE6",
              display: "flex",
              gap: 8,
            }}
          >
            <button
              type="button"
              className="df-ink-btn"
              style={{ flex: 1 }}
              onClick={() => {
                if (!selectedFolderId) return;
                setExpandedFolderIds((current) =>
                  current.includes(selectedFolderId) ? current : [...current, selectedFolderId],
                );
              }}
            >
              Open folder
            </button>
            <Link href="/documents/access" className="df-ghost-btn">
              Manage access
            </Link>
          </footer>
        </aside>
      ) : null}
    </div>
  );
}
