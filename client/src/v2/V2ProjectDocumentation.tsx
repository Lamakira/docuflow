import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { CrmProjectWithDetails, Document, Project, SafeUser } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { chromeRefusal } from "./chrome";
import { composeProjectDocumentation } from "./projectDocumentation";
import { projectVisibleTo } from "./projects";
import { memberName } from "./today";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { V2LibraryRegister, useFolderExpandMotion } from "./V2Library";
import { useV2Chrome } from "./V2Shell";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { Button } from "@/components/ui/button";
import { SkeletonLibrary, V2PageSkeleton } from "./V2Skeleton";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };

type LibraryPayload = {
  capabilityMiss: boolean;
  /** `/api/projects/documentable` returns Projects. Calling them folders here is
      what sent a leak investigation through `documents` and `company_documents`
      before the row turned out to be in `projects` (#245, F4). */
  projects: Project[];
  crm: CrmProjectWithDetails[];
  documents: Document[];
};

async function loadCrmProjects(): Promise<CrmProjectWithDetails[]> {
  const pageSize = 200;
  const rows: CrmProjectWithDetails[] = [];
  let page = 1;
  let total = 0;
  for (;;) {
    const res = await fetch(`/api/crm/projects?page=${page}&pageSize=${pageSize}`, {
      credentials: "include",
    });
    if (res.status === 401 || res.status === 403 || !res.ok) return rows;
    const body = (await res.json()) as ProjectsResponse;
    const batch = body.data ?? [];
    total = body.total ?? rows.length + batch.length;
    rows.push(...batch);
    if (rows.length >= total || batch.length === 0) break;
    page += 1;
  }
  return rows;
}

async function loadProjectLibrary(): Promise<LibraryPayload> {
  const documentableRes = await fetch("/api/projects/documentable", { credentials: "include" });
  if (documentableRes.status === 401 || documentableRes.status === 403) {
    return { capabilityMiss: true, projects: [], crm: [], documents: [] };
  }
  if (!documentableRes.ok) throw new Error("Failed to fetch Project Documentation");
  const projects = (await documentableRes.json()) as Project[];
  const crm = await loadCrmProjects();
  const nested = await Promise.all(
    projects.map(async (project) => {
      const res = await fetch(`/api/projects/${project.id}/documents`, { credentials: "include" });
      if (!res.ok) return [] as Document[];
      return (await res.json()) as Document[];
    }),
  );
  return {
    capabilityMiss: false,
    projects,
    crm,
    documents: nested.flat(),
  };
}

export function V2ProjectDocumentationPage() {
  const now = useMemo(() => new Date(), []);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { memberships } = useV2Chrome();
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"document" | "project" | null>(null);
  const [name, setName] = useState("");
  const [targetProjectId, setTargetProjectId] = useState<string>(V2_SELECT_NONE);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const { data, isLoading } = useQuery<LibraryPayload>({
    queryKey: ["/api/projects/documentable", "project-documentation"],
    queryFn: loadProjectLibrary,
  });
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const ownerName = useWorkspaceOwnerName();

  const crmByProjectId = new Map(
    (data?.crm ?? []).map((project) => [project.project?.id, project] as const),
  );
  const projectInputs = (data?.projects ?? []).map((project) => {
      const crm = crmByProjectId.get(project.id);
      const memberIds = crm
        ? (crm.members ?? [])
            .map((row) => row.userId || row.user?.id)
            .filter((id): id is string => Boolean(id))
        : [project.ownerId];
      return {
        id: project.id,
        documentProjectId: project.id,
        name: project.name || "Untitled Project",
        documentationEnabled: true,
        visible: projectVisibleTo({
          role: current?.workspaceRole?.toLowerCase() || null,
          userId: user?.id ?? "",
          memberIds,
          assigneeId: crm?.assigneeId ?? crm?.assignee?.id ?? project.ownerId,
        }),
        updatedAt: project.updatedAt,
      };
    });
  const library = composeProjectDocumentation({
    now,
    workspaceName,
    projects: projectInputs,
    documents: (data?.documents ?? []).map((document) => ({
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
    filterQuery,
    capabilityMiss: data?.capabilityMiss === true,
    ownerName,
  });
  const folderMotion = useFolderExpandMotion(filterQuery);

  const projectOptions = [
    { value: V2_SELECT_NONE, label: "Choose a Project" },
    ...projectInputs
      .filter((project) => project.visible)
      .map((project) => ({ value: project.id, label: project.name })),
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
        </div>

        <V2LibraryRegister
          library={library}
          testId="v2-project-documentation-register"
          instantExpand={folderMotion.instantExpand}
          onFolderClick={onFolderClick}
        />
      </div>
    </div>
  );
}
