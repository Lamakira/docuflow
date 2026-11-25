import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FolderInput, Plus, Search, Upload } from "lucide-react";
import type { CrmClient, Document, Project } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { canManageAdministration } from "./administration";
import { chromeRefusal } from "./chrome";
import { isStandingRefusal, notify } from "./notify";
import {
  clearDocumentationFilters,
  composeProjectDocumentation,
  documentationFilterLabels,
  documentationFilterWords,
  documentationRegisterPath,
  offeredProject,
  projectFilesPath,
  readDocumentationFilters,
  writeDocumentationFilters,
  DOCUMENTATION_OPTIONS,
  type DocumentationSetting,
  type ProjectDocumentationFilters,
} from "./projectDocumentation";
import type { LibraryPerson, LibraryRow } from "./library";
import { composePaging } from "./paging";
import { projectHref } from "./today";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { PROJECT_DOCUMENTATION_OPEN_KEY, readLibraryOpenState, writeLibraryOpenState, type LibraryOpenState } from "./presentation";
import { V2LibraryRegister, useFolderExpandMotion } from "./V2Library";
import { useV2Chrome } from "./V2Shell";
import { V2EmptyLine, V2LoadFailed } from "./V2EmptyState";
import { V2FormDialog } from "./V2FormDialog";
import { V2LinkDocumentationDialog } from "./V2LinkDocumentationDialog";
import { V2UploadDialog, fileTitle, storeUpload } from "./V2UploadDialog";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { V2RegisterPager } from "./V2RegisterPager";
import { Button } from "@/components/ui/button";
import { SkeletonLibrary, V2PageSkeleton } from "./V2Skeleton";
import { V2PageHead } from "./V2PageHead";

/**
 * `/api/projects/documentable` pages Projects. Calling them folders here is
 * what sent a leak investigation through `documents` and `company_documents`
 * before the row turned out to be in `projects` (#245, F4).
 */
type DocumentationPage = {
  data: Array<{
    project: Project;
    crmProjectId: string;
    clientName: string | null;
    isDocumentationOnly: boolean;
    owner: LibraryPerson | null;
    documentationEnabled: boolean;
    documents: Array<
      Pick<Document, "id" | "title" | "projectId" | "parentId" | "createdAt" | "updatedAt"> & { createdBy: LibraryPerson | null }
    >;
    files?: Array<{
      id: string;
      name: string;
      projectId: string;
      createdBy: LibraryPerson | null;
      createdAt: string | null;
      updatedAt: string | null;
    }>;
  }>;
  total: number;
  projects: Array<{ id: string; name: string; documentationEnabled: boolean; isDocumentationOnly: boolean }>;
};

type LibraryPayload = { capabilityMiss: boolean; page: DocumentationPage | null };

const MAX_PROJECT_NAME = 255;
const MAX_DOCUMENT_NAME = 500;

const SEARCH_SETTLE_MS = 250;

async function loadDocumentationPage(path: string): Promise<LibraryPayload> {
  const res = await fetch(path, { credentials: "include" });
  if (res.status === 401 || res.status === 403) return { capabilityMiss: true, page: null };
  if (!res.ok) throw new Error("Failed to fetch Project Documentation");
  return { capabilityMiss: false, page: (await res.json()) as DocumentationPage };
}

function restoredOpenState(): LibraryOpenState {
  try {
    return readLibraryOpenState(window.sessionStorage, PROJECT_DOCUMENTATION_OPEN_KEY);
  } catch {
    return { expanded: [], selected: null };
  }
}

export function V2ProjectDocumentationPage() {
  const now = useMemo(() => new Date(), []);
  const search = useSearch();
  const [, navigate] = useLocation();
  const { memberships } = useV2Chrome();
  const filters = readDocumentationFilters(search);
  const [filterQuery, setFilterQuery] = useState(filters.q);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() => restoredOpenState().expanded);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => restoredOpenState().selected);
  useEffect(() => {
    try {
      writeLibraryOpenState(window.sessionStorage, PROJECT_DOCUMENTATION_OPEN_KEY, { expanded: expandedProjectIds, selected: selectedProjectId });
    } catch {
      // Storage can throw in private modes; the folders just start closed next time.
    }
  }, [expandedProjectIds, selectedProjectId]);
  const [createMode, setCreateMode] = useState<"document" | "project" | "upload" | null>(null);
  const [name, setName] = useState("");
  const [targetProjectId, setTargetProjectId] = useState<string>(V2_SELECT_NONE);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [linkSource, setLinkSource] = useState<{
    crmProjectId: string;
    name: string;
    documents: number;
    files: number;
  } | null>(null);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
  const readOnlyRefusal = readOnly
    ? chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" })
    : null;
  const canManage = canManageAdministration(current?.workspaceRole ?? "");

  function setFilters(next: ProjectDocumentationFilters) {
    navigate(`/project-documentation${writeDocumentationFilters(search, next)}`, { replace: true });
  }

  // The search box answers each keystroke; the URL, and so the server page,
  // follows once typing settles.
  useEffect(() => {
    if (filterQuery === filters.q) return;
    const timer = window.setTimeout(() => setFilters({ ...filters, q: filterQuery, page: 1 }), SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [filterQuery]);

  const registerPath = documentationRegisterPath(filters);
  // Every visit re-reads; the cached list shows while it does. A page that fails
  // has no data, so another filter's rows never stand in for its answer (F63).
  const { data, isLoading, isError, refetch } = useQuery<LibraryPayload>({
    queryKey: ["/api/projects/documentable", "register-page", registerPath],
    placeholderData: keepPreviousData,
    queryFn: () => loadDocumentationPage(registerPath),
    staleTime: 0,
  });
  // A refresh that fails keeps the cached list on screen and says so once.
  useEffect(() => {
    if (isError && data) {
      notify.error(null, {
        fallback: "Project Documentation could not be refreshed.",
        id: "v2-project-documentation-refresh-failed",
      });
    }
  }, [isError, data]);
  const { data: clients = [] } = useQuery<CrmClient[]>({ queryKey: ["/api/crm/clients"] });
  const ownerName = useWorkspaceOwnerName();

  const page = data?.page ?? null;
  const paging = composePaging({
    page: filters.page,
    pageSize: filters.pageSize,
    total: page?.total ?? 0,
    noun: { one: "project", many: "projects" },
  });

  // A shared link past the last page lands on the last one instead of nothing.
  useEffect(() => {
    if (!page || filters.page <= paging.pageCount) return;
    setFilters({ ...filters, page: paging.pageCount });
  }, [page, filters.page, paging.pageCount]);

  const choices = page?.projects ?? [];
  const projectChipOptions = choices
    .filter((project) => filters.documentation === "all" || project.documentationEnabled === (filters.documentation === "enabled"))
    .map((project) => ({ value: project.id, label: project.name || "Untitled Project" }));
  const clientOptions = [...clients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((client) => ({ value: client.id, label: client.name }));
  const filterNames = {
    projects: new Map(choices.map((project) => [project.id, project.name])),
    clients: new Map(clientOptions.map((option) => [option.value, option.label])),
  };
  const activeFilters = documentationFilterLabels(filters, filterNames);
  const filterWords = documentationFilterWords(filters, filterNames);

  // The server already scoped the page to what the reader may see.
  const projectInputs = (page?.data ?? []).map((entry) => ({
    id: entry.project.id,
    documentProjectId: entry.project.id,
    name: entry.project.name || "Untitled Project",
    documentationEnabled: entry.documentationEnabled,
    visible: true,
    updatedAt: entry.project.updatedAt,
    clientName: entry.clientName,
    isDocumentationOnly: entry.isDocumentationOnly,
    owner: entry.owner,
  }));
  const library = composeProjectDocumentation({
    now,
    workspaceName,
    projects: projectInputs,
    activeFilters,
    filterWords,
    documents: (page?.data ?? []).flatMap((entry) => entry.documents).map((document) => ({
      id: document.id,
      title: document.title,
      projectId: document.projectId,
      parentId: document.parentId,
      updatedAt: document.updatedAt,
      createdAt: document.createdAt,
      createdBy: document.createdBy,
    })),
    files: (page?.data ?? []).flatMap((entry) => entry.files ?? []).map((file) => ({
      id: file.id,
      name: file.name,
      projectId: file.projectId,
      updatedAt: file.updatedAt,
      createdAt: file.createdAt,
      createdBy: file.createdBy,
    })),
    expandedProjectIds,
    selectedProjectId,
    filterQuery: filters.q,
    capabilityMiss: data?.capabilityMiss === true,
    ownerName,
  });
  const folderMotion = useFolderExpandMotion(filterQuery);

  const offeredProjects = choices
    .filter((project) => project.documentationEnabled)
    .map((project) => ({ value: project.id, label: project.name || "Untitled Project" }));
  const projectOptions = [
    { value: V2_SELECT_NONE, label: "Choose a Project" },
    ...offeredProjects,
  ];
  const selectedDocumentProjectId = offeredProject(offeredProjects, targetProjectId);

  function refuseWrite(errorMessage?: string) {
    if (readOnlyRefusal) {
      setWriteRefusal(readOnlyRefusal);
      return true;
    }
    if (errorMessage && !isStandingRefusal(errorMessage) && !/select a project/i.test(errorMessage)) {
      notify.error(errorMessage);
      return false;
    }
    if (errorMessage) {
      setWriteRefusal(chromeRefusal({ kind: "generic", message: errorMessage }));
    }
    return false;
  }

  const createDocument = useMutation({
    mutationFn: (title: string) => {
      if (!selectedDocumentProjectId) throw new Error("Select a Project first.");
      return apiRequest("POST", `/api/projects/${selectedDocumentProjectId}/documents`, {
        title,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      });
    },
    onSuccess: (created: { id?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"] });
      setCreateMode(null);
      setName("");
      setWriteRefusal(null);
      notify.success("Document created");
      if (created?.id) navigate(`/document/${created.id}`);
    },
    onError: (error: Error) => {
      if (error.message.toLowerCase().includes("select a project")) {
        setWriteRefusal(error.message);
        return;
      }
      refuseWrite(error.message);
    },
  });

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedDocumentProjectId) throw new Error("Select a Project first.");
      const objectPath = await storeUpload(file);
      return apiRequest("POST", projectFilesPath(selectedDocumentProjectId), {
        name: fileTitle(file),
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        storagePath: objectPath,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"] });
      if (selectedDocumentProjectId) {
        queryClient.invalidateQueries({ queryKey: [projectFilesPath(selectedDocumentProjectId)] });
      }
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  // The control creates a Project, and the screen says so (#245, F4).
  const createProject = useMutation({
    mutationFn: (projectName: string) =>
      apiRequest("POST", "/api/crm/projects", {
        name: projectName,
        documentationEnabled: true,
        isDocumentationOnly: true,
      }),
    onSuccess: (created: { project?: { id: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      const createdId = created?.project?.id;
      if (createdId) {
        setExpandedProjectIds((currentIds) => [...currentIds, createdId]);
        setSelectedProjectId(createdId);
      }
      setCreateMode(null);
      setName("");
      setWriteRefusal(null);
      notify.success("Project created");
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  // The register calls its expandable parents folders; on this screen each one
  // is a Project (#245, F4).
  function onFolderClick(projectId: string) {
    folderMotion.onUserExpand();
    setSelectedProjectId(projectId);
    setExpandedProjectIds((currentIds) =>
      currentIds.includes(projectId) ? currentIds.filter((id) => id !== projectId) : [...currentIds, projectId],
    );
  }

  function openCreate(mode: "document" | "project" | "upload", projectId: string | null = selectedProjectId) {
    setName("");
    setWriteRefusal(null);
    setTargetProjectId(offeredProject(offeredProjects, projectId) ?? V2_SELECT_NONE);
    setCreateMode(mode);
  }

  function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (refuseWrite()) return;
    if (createMode === "project") createProject.mutate(trimmed);
    if (createMode === "document") {
      if (!selectedDocumentProjectId) {
        setWriteRefusal("Select a Project first.");
        return;
      }
      createDocument.mutate(trimmed);
    }
  }

  // What an open Project offers above its Documents, an empty one included (F65).
  function projectActions(row: LibraryRow) {
    const entry = page?.data.find((candidate) => candidate.project.id === row.id);
    if (!entry) return null;
    const documents = entry.documents.length;
    const files = entry.files?.length ?? 0;
    const href = projectHref(entry.crmProjectId);
    return (
      <div className="df-library-folder-actions" data-testid={`v2-project-actions-${row.id}`}>
        <Button asChild variant="outline" className="df-btn">
          <Link href={entry.documentationEnabled ? `${href}/documents` : href}>
            <ArrowUpRight strokeWidth={1.6} aria-hidden />
            Open project
          </Link>
        </Button>
        {entry.documentationEnabled ? (
          <Button variant="outline" type="button" onClick={() => openCreate("document", row.id)} className="df-btn">
            <Plus strokeWidth={1.6} aria-hidden />
            New Document
          </Button>
        ) : null}
        {entry.isDocumentationOnly && canManage ? (
          <Button
            variant="outline"
            type="button"
            onClick={() => setLinkSource({ crmProjectId: entry.crmProjectId, name: row.name, documents, files })}
            className="df-btn"
          >
            <FolderInput strokeWidth={1.6} aria-hidden />
            Link to a Project
          </Button>
        ) : null}
        {documents + files === 0 ? <V2EmptyLine>No Project Documents yet.</V2EmptyLine> : null}
      </div>
    );
  }

  const filterBar = (
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
      {projectChipOptions.length === 0 && filters.project === "all" ? null : (
        <V2FilterSelect
          label="Project"
          ariaLabel="Filter by Project"
          value={filters.project}
          active={filters.project !== "all"}
          options={[{ value: "all", label: "All" }, ...projectChipOptions]}
          onChange={(project) => setFilters({ ...filters, project, page: 1 })}
        />
      )}
      {clientOptions.length === 0 ? null : (
        <V2FilterSelect
          label="Client"
          ariaLabel="Filter by Client"
          value={filters.client}
          active={filters.client !== "all"}
          options={[{ value: "all", label: "All" }, ...clientOptions]}
          onChange={(client) => setFilters({ ...filters, client, page: 1 })}
        />
      )}
      <V2FilterSelect
        label="Documentation"
        ariaLabel="Filter by documentation"
        value={filters.documentation}
        active={filters.documentation !== "enabled"}
        options={DOCUMENTATION_OPTIONS}
        onChange={(documentation) =>
          setFilters({ ...filters, documentation: documentation as DocumentationSetting, project: "all", page: 1 })
        }
      />
    </div>
  );

  if (isLoading) {
    return (
      <V2PageSkeleton
        title="Project Documentation"
        testId="v2-project-documentation"
        frame="library"
        status="Loading Project Documentation."
      >
        <SkeletonLibrary accessHeading="Client" />
      </V2PageSkeleton>
    );
  }

  if (isError && !data) {
    return (
      <div className="df-page" data-testid="v2-project-documentation">
        <V2PageHead title="Project Documentation" />
        {/* A filter whose page failed can still be changed or cleared. */}
        {activeFilters.length > 0 ? filterBar : null}
        <V2LoadFailed
          title="Project Documentation could not be loaded"
          onRetry={() => refetch()}
          testId="v2-project-documentation-load-failed"
        />
      </div>
    );
  }

  return (
    <div className="df-library" data-testid="v2-project-documentation">
      <div className="df-library-main">
        <V2PageHead
          title="Project Documentation"
          subhead={library.subhead}
          actions={
            <>
              <Button variant="outline" type="button" onClick={() => openCreate("project")} className="df-btn">
                <Plus strokeWidth={1.6} aria-hidden />
                New project
              </Button>
              <Button variant="outline" type="button" onClick={() => openCreate("upload")} className="df-btn">
                <Upload strokeWidth={1.6} aria-hidden />
                Upload File
              </Button>
              <Button variant="default" type="button" onClick={() => openCreate("document")} className="df-btn">
                <Plus strokeWidth={1.6} aria-hidden />
                New Document
              </Button>
            </>
          }
        />

        <V2FormDialog
          open={createMode === "document" || createMode === "project"}
          onOpenChange={(open) => {
            if (!open) setCreateMode(null);
          }}
          title={createMode === "project" ? "New documentation Project" : "New Document"}
          description={
            createMode === "project"
              ? "Holds Project Documents on their own, outside Projects. You can link it to a Project later."
              : "A Project Document belongs to one Project and opens in the editor once created."
          }
          submitLabel={createMode === "project" ? "Create Project" : "Create Document"}
          pending={createDocument.isPending || createProject.isPending}
          canSubmit={Boolean(name.trim()) && (createMode === "project" || Boolean(selectedDocumentProjectId))}
          onSubmit={onCreate}
          refusal={writeRefusal}
          testId={createMode === "project" ? "v2-project-documentation-new-project" : "v2-project-documentation-new-document"}
        >
          <label className="df-daily-field">
            Name
            <input
              type="text"
              value={name}
              autoFocus
              maxLength={createMode === "project" ? MAX_PROJECT_NAME : MAX_DOCUMENT_NAME}
              onChange={(event) => setName(event.target.value)}
              placeholder={createMode === "project" ? "Project name" : "Document name"}
              aria-label={createMode === "project" ? "Project name" : "Document name"}
            />
          </label>
          {createMode === "document" ? (
            <label className="df-daily-field">
              Project
              <V2FilterSelect
                label=""
                ariaLabel="Project"
                value={targetProjectId}
                options={projectOptions}
                onChange={setTargetProjectId}
              />
            </label>
          ) : null}
        </V2FormDialog>

        <V2UploadDialog
          open={createMode === "upload"}
          onOpenChange={(open) => {
            if (!open) setCreateMode(null);
          }}
          description="A Project File belongs to one Project and is listed with its Project Documents, visible to Members assigned to that Project."
          upload={(file) => uploadFile.mutateAsync(file)}
          pending={uploadFile.isPending}
          canUpload={Boolean(selectedDocumentProjectId)}
          beforeUpload={() => refuseWrite()}
          refusal={writeRefusal}
          testId="v2-project-documentation-upload"
        >
          <label className="df-daily-field">
            Project
            <V2FilterSelect
              label=""
              ariaLabel="Project"
              value={targetProjectId}
              options={projectOptions}
              onChange={setTargetProjectId}
            />
          </label>
        </V2UploadDialog>
        {writeRefusal && !createMode ? <p className="df-refusal">{writeRefusal}</p> : null}

        {filterBar}

        <V2LibraryRegister
          library={library}
          testId="v2-project-documentation-register"
          accessHeading="Client"
          plainAccess
          folderActions={projectActions}
          instantExpand={folderMotion.instantExpand}
          onFolderClick={onFolderClick}
          onClear={() => {
            setFilterQuery("");
            setFilters(clearDocumentationFilters(filters));
          }}
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
              <Button variant="outline" type="button" onClick={() => openCreate("project")} className="df-btn">
                <Plus strokeWidth={1.6} aria-hidden />
                New project
              </Button>
            </>
          }
          footer={
            library.refusal ? undefined : (
              <V2RegisterPager
                paging={paging}
                ariaLabel="Project Documentation pages"
                onPage={(next) => setFilters({ ...filters, page: next })}
                onPageSize={(pageSize) => setFilters({ ...filters, pageSize, page: 1 })}
              />
            )
          }
        />
      </div>
      {linkSource ? (
        <V2LinkDocumentationDialog
          open
          onOpenChange={(open) => {
            if (!open) setLinkSource(null);
          }}
          source={linkSource}
          readOnlyRefusal={readOnlyRefusal}
        />
      ) : null}
    </div>
  );
}
