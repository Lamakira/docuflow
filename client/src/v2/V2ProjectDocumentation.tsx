import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { CrmClient, Document, Project, SafeUser } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import {
  clearDocumentationFilters,
  composeProjectDocumentation,
  documentationFilterLabels,
  documentationRegisterPath,
  readDocumentationFilters,
  writeDocumentationFilters,
  DOCUMENTATION_OPTIONS,
  type DocumentationSetting,
  type ProjectDocumentationFilters,
} from "./projectDocumentation";
import { composePaging } from "./paging";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { V2LibraryRegister, useFolderExpandMotion } from "./V2Library";
import { useV2Chrome } from "./V2Shell";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { V2RegisterPager } from "./V2RegisterPager";
import { Button } from "@/components/ui/button";
import { SkeletonLibrary, V2PageSkeleton } from "./V2Skeleton";

/**
 * `/api/projects/documentable` pages Projects. Calling them folders here is
 * what sent a leak investigation through `documents` and `company_documents`
 * before the row turned out to be in `projects` (#245, F4).
 */
type DocumentationPage = {
  data: Array<{
    project: Project;
    documentationEnabled: boolean;
    documents: Array<Pick<Document, "id" | "title" | "projectId" | "parentId" | "createdById" | "createdAt" | "updatedAt">>;
  }>;
  total: number;
  projects: Array<{ id: string; name: string; documentationEnabled: boolean }>;
};

type LibraryPayload = { capabilityMiss: boolean; page: DocumentationPage | null };

const SEARCH_SETTLE_MS = 250;

async function loadDocumentationPage(path: string): Promise<LibraryPayload> {
  const res = await fetch(path, { credentials: "include" });
  if (res.status === 401 || res.status === 403) return { capabilityMiss: true, page: null };
  if (!res.ok) throw new Error("Failed to fetch Project Documentation");
  return { capabilityMiss: false, page: (await res.json()) as DocumentationPage };
}

export function V2ProjectDocumentationPage() {
  const now = useMemo(() => new Date(), []);
  const search = useSearch();
  const [, navigate] = useLocation();
  const { memberships } = useV2Chrome();
  const filters = readDocumentationFilters(search);
  const [filterQuery, setFilterQuery] = useState(filters.q);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"document" | "project" | null>(null);
  const [name, setName] = useState("");
  const [targetProjectId, setTargetProjectId] = useState<string>(V2_SELECT_NONE);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

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
  const { data, isLoading } = useQuery<LibraryPayload>({
    queryKey: ["/api/projects/documentable", "register-page", registerPath],
    placeholderData: keepPreviousData,
    queryFn: () => loadDocumentationPage(registerPath),
  });
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: clients = [] } = useQuery<CrmClient[]>({ queryKey: ["/api/crm/clients"] });
  const ownerName = useWorkspaceOwnerName();

  const page = data?.page ?? null;
  const paging = composePaging({
    page: filters.page,
    pageSize: filters.pageSize,
    total: page?.total ?? 0,
    noun: { one: "PROJECT", many: "PROJECTS" },
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
  const activeFilters = documentationFilterLabels(filters, {
    projects: new Map(choices.map((project) => [project.id, project.name])),
    clients: new Map(clientOptions.map((option) => [option.value, option.label])),
  });

  // The server already scoped the page to what the reader may see.
  const projectInputs = (page?.data ?? []).map((entry) => ({
    id: entry.project.id,
    documentProjectId: entry.project.id,
    name: entry.project.name || "Untitled Project",
    documentationEnabled: entry.documentationEnabled,
    visible: true,
    updatedAt: entry.project.updatedAt,
  }));
  const library = composeProjectDocumentation({
    now,
    workspaceName,
    projects: projectInputs,
    activeFilters,
    documents: (page?.data ?? []).flatMap((entry) => entry.documents).map((document) => ({
      id: document.id,
      title: document.title,
      projectId: document.projectId,
      parentId: document.parentId,
      updatedAt: document.updatedAt,
      createdAt: document.createdAt,
      createdBy: document.createdById
        ? users.find((member) => member.id === document.createdById) ?? null
        : null,
    })),
    expandedProjectIds,
    selectedProjectId,
    filterQuery: filters.q,
    capabilityMiss: data?.capabilityMiss === true,
    ownerName,
  });
  const folderMotion = useFolderExpandMotion(filterQuery);

  const projectOptions = [
    { value: V2_SELECT_NONE, label: "Choose a Project" },
    ...choices
      .filter((project) => project.documentationEnabled)
      .map((project) => ({ value: project.id, label: project.name || "Untitled Project" })),
  ];
  const selectedDocumentProjectId = targetProjectId === V2_SELECT_NONE ? null : targetProjectId;

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

  // The control creates a row in `projects`, and the screen says so (#245, F4).
  const createProject = useMutation({
    mutationFn: (projectName: string) =>
      apiRequest("POST", "/api/crm/projects", {
        name: projectName,
        documentationEnabled: true,
        isDocumentationOnly: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      setCreateMode(null);
      setName("");
      setWriteRefusal(null);
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

  function openCreate(mode: "document" | "project") {
    setName("");
    setWriteRefusal(null);
    setTargetProjectId(selectedProjectId ?? V2_SELECT_NONE);
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

  if (isLoading) {
    return (
      <V2PageSkeleton
        title="Project Documentation"
        testId="v2-project-documentation"
        frame="library"
        status="Loading Project Documentation."
      >
        <SkeletonLibrary />
      </V2PageSkeleton>
    );
  }

  return (
    <div className="df-library" data-testid="v2-project-documentation">
      <div className="df-library-main">
        <header className="df-today-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="df-title">Project Documentation</h1>
            <p className="df-subhead">{library.subhead}</p>
          </div>
          <div className="df-library-actions">
            <Button variant="outline" type="button" onClick={() => openCreate("project")} className="df-btn">
              New project
            </Button>
            <Button variant="default" type="button" onClick={() => openCreate("document")} className="df-btn">
              New Document
            </Button>
          </div>
        </header>

        <V2FormDialog
          open={createMode !== null}
          onOpenChange={(open) => {
            if (!open) setCreateMode(null);
          }}
          title={createMode === "project" ? "New Project" : "New Document"}
          description={
            createMode === "project"
              ? "A documentation-only Project: a row in Projects that holds Project Documents and never enters the pipeline."
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
            NAME
            <input
              type="text"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder={createMode === "project" ? "Project name" : "Document name"}
              aria-label={createMode === "project" ? "Project name" : "Document name"}
            />
          </label>
          {createMode === "document" ? (
            <label className="df-daily-field">
              PROJECT
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
        {writeRefusal && !createMode ? <p className="df-refusal">{writeRefusal}</p> : null}

        <div className="df-filter-bar">
          <label className="df-filter-input">
            <Search width={14} height={14} strokeWidth={1.4} style={{ color: "var(--df-archive-slate)" }} />
            <input
              type="search"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Filter this library"
              aria-label="Filter this library"
            />
          </label>
          {projectChipOptions.length === 0 && filters.project === "all" ? null : (
            <V2FilterSelect
              label="PROJECT"
              ariaLabel="Filter by Project"
              value={filters.project}
              active={filters.project !== "all"}
              options={[{ value: "all", label: "ALL" }, ...projectChipOptions]}
              onChange={(project) => setFilters({ ...filters, project, page: 1 })}
            />
          )}
          {clientOptions.length === 0 ? null : (
            <V2FilterSelect
              label="CLIENT"
              ariaLabel="Filter by Client"
              value={filters.client}
              active={filters.client !== "all"}
              options={[{ value: "all", label: "ALL" }, ...clientOptions]}
              onChange={(client) => setFilters({ ...filters, client, page: 1 })}
            />
          )}
          <V2FilterSelect
            label="DOCUMENTATION"
            ariaLabel="Filter by documentation"
            value={filters.documentation}
            active={filters.documentation !== "enabled"}
            options={DOCUMENTATION_OPTIONS}
            onChange={(documentation) =>
              setFilters({ ...filters, documentation: documentation as DocumentationSetting, project: "all", page: 1 })
            }
          />
        </div>

        <V2LibraryRegister
          library={library}
          testId="v2-project-documentation-register"
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
                  setFilters(clearDocumentationFilters(filters));
                }}
              >
                Clear filters
              </Button>
            ) : null
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
    </div>
  );
}
