import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import { DragDropContext, Draggable, Droppable, type DraggableProvided, type DropResult } from "@hello-pangea/dnd";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CrmProjectWithDetails, CrmTag } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { tagsPath } from "./dossier";
import { meterTone, swatchStyle } from "./palette";
import { matchV2Route } from "./presentation";
import {
  combinedStatusForProjectStatus,
  composeProjectBoard,
  composeProjectRegister,
  projectsAllPath,
  projectsKanbanPath,
  projectVisibleTo,
  PROJECT_BOARD_COLUMNS,
  type ProjectBoardCard,
  type ProjectRegisterRowInput,
} from "./projects";
import { formatHours, memberName, mobileProjectMeta } from "./today";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect } from "./V2Select";
import { Button } from "@/components/ui/button";
import { SkeletonBoard, SkeletonRegister, V2PageSkeleton } from "./V2Skeleton";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type TimeStats = {
  byProject: Array<{ crmProjectId: string; totalDuration: number }>;
};

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function statsUrl(start: Date, end: Date): string {
  const params = new URLSearchParams({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  });
  return `/api/time-tracking/stats?${params.toString()}`;
}

async function loadProjectList(path: string): Promise<ProjectsResponse> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch Projects");
  return res.json();
}

function isBoardCardClick(
  event: Pick<MouseEvent, "button" | "shiftKey" | "altKey" | "clientX" | "clientY">,
  origin: { x: number; y: number } | null,
): boolean {
  if (!origin) return false;
  if (event.button !== 0 || event.shiftKey || event.altKey) return false;
  return Math.abs(event.clientX - origin.x) <= 5 && Math.abs(event.clientY - origin.y) <= 5;
}

function leadName(project: CrmProjectWithDetails): string | null {
  const member = project.members?.find((row) => row.user);
  if (member?.user) return memberName(member.user);
  if (project.assignee) return memberName(project.assignee);
  return null;
}

function toRegisterProject(
  project: CrmProjectWithDetails,
  monthSeconds: number,
  viewer: { userId: string; role: string | null },
): ProjectRegisterRowInput {
  const budgeted = project.budgetedHours ?? 0;
  const actual = project.actualHours ?? 0;
  const memberIds = (project.members ?? [])
    .map((row) => row.userId || row.user?.id)
    .filter((id): id is string => Boolean(id));
  return {
    id: project.id,
    name: project.project?.name || "Untitled Project",
    clientName: project.client?.name ?? null,
    projectType: project.projectType,
    projectStatus: project.projectStatus,
    leadName: leadName(project),
    budgetPercent: budgeted > 0 ? Math.round((actual / budgeted) * 100) : null,
    trackedMtd: formatHours(monthSeconds),
    tags: (project.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name })),
    visible: projectVisibleTo({
      role: viewer.role,
      userId: viewer.userId,
      memberIds,
      assigneeId: project.assigneeId ?? project.assignee?.id ?? null,
    }),
  };
}

export function V2LegacyProjectPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const legacyProjectId = match.kind === "legacy-project" ? match.legacyProjectId : "";

  const { data, isFetched } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects/by-project", legacyProjectId],
    enabled: Boolean(legacyProjectId),
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects/by-project/${legacyProjectId}`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch Project");
      return res.json();
    },
  });

  if (!legacyProjectId) return <Redirect to="/projects" />;
  if (isFetched) {
    return <Redirect to={data?.id ? `/projects/${data.id}` : "/projects"} />;
  }

  return (
    <div className="df-page" data-testid="v2-projects">
      <h1 className="df-title">Projects</h1>
      <p className="df-subhead">Opening this Project…</p>
    </div>
  );
}

function ProjectBoardCardView({
  card,
  provided,
  locked,
  onOpen,
}: {
  card: ProjectBoardCard;
  provided: DraggableProvided;
  locked: boolean;
  onOpen: (href: string) => void;
}) {
  const origin = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    origin.current = { x: event.clientX, y: event.clientY };
  }

  function onClick(event: MouseEvent<HTMLElement>) {
    if (!isBoardCardClick(event, origin.current)) return;
    origin.current = null;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      window.open(card.href, "_blank", "noopener,noreferrer");
      return;
    }
    onOpen(card.href);
  }

  return (
    <article
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className="df-opportunity-card"
      data-locked={locked ? "true" : "false"}
      data-testid={`v2-project-card-${card.id}`}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className="df-row-title">{card.name}</div>
      {card.clientLabel ? <div className="df-opportunity-card-client">{card.clientLabel}</div> : null}
      {card.movable ? null : (
        <div className="df-project-card-opportunity" title="Still an Opportunity. Move it on Opportunities.">
          OPPORTUNITY
        </div>
      )}
    </article>
  );
}

export function V2ProjectsPage() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const boardView = new URLSearchParams(search).get("view") === "board";
  const boardRef = useRef<HTMLDivElement>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(
    () => new URLSearchParams(window.location.search).get("new") === "1",
  );
  const [name, setName] = useState("");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonth(now), [now]);
  const dayEnd = useMemo(() => endOfDay(now), [now]);
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const { data: projectsResponse, isLoading, isError } = useQuery<ProjectsResponse>({
    queryKey: [projectsAllPath()],
    queryFn: () => loadProjectList(projectsAllPath()),
  });
  const {
    data: kanbanResponse,
    isLoading: boardLoading,
    isError: boardError,
  } = useQuery<ProjectsResponse>({
    queryKey: [projectsKanbanPath()],
    enabled: boardView,
    queryFn: () => loadProjectList(projectsKanbanPath()),
  });
  const { data: monthStats } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", "projects-register", monthStart.toISOString()],
    queryFn: () => fetch(statsUrl(monthStart, dayEnd), { credentials: "include" }).then((res) => res.json()),
  });

  const { data: workspaceTags = [] } = useQuery<CrmTag[]>({
    queryKey: [tagsPath()],
    queryFn: () => apiRequest("GET", tagsPath()),
  });

  const monthByProject = new Map((monthStats?.byProject ?? []).map((row) => [row.crmProjectId, row.totalDuration]));
  const register = composeProjectRegister({
    workspaceName,
    projects: (projectsResponse?.data ?? []).map((project) =>
      toRegisterProject(project, monthByProject.get(project.id) ?? 0, {
        userId: user?.id ?? "",
        role: current?.workspaceRole ?? null,
      }),
    ),
    filterQuery,
    statusFilter,
    tagFilter,
    selectedId,
  });
  const viewer = {
    userId: user?.id ?? "",
    role: current?.workspaceRole ?? null,
  };
  const boardSource = kanbanResponse?.data ?? [];
  const board = composeProjectBoard({
    workspaceName,
    projects: boardSource.map((project) => {
      const memberIds = (project.members ?? [])
        .map((row) => row.userId || row.user?.id)
        .filter((id): id is string => Boolean(id));
      return {
        id: project.id,
        name: project.project?.name || "Untitled Project",
        clientName: project.client?.name ?? null,
        projectType: project.projectType ?? null,
        status: project.status,
        projectStatus: project.projectStatus,
        visible: projectVisibleTo({
          role: viewer.role,
          userId: viewer.userId,
          memberIds,
          assigneeId: project.assigneeId ?? project.assignee?.id ?? null,
        }),
      };
    }),
    filterQuery,
    changingId,
  });

  const moveProject = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/crm/projects/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: [projectsKanbanPath()] });
      const previous = queryClient.getQueryData<ProjectsResponse>([projectsKanbanPath()]);
      if (previous) {
        queryClient.setQueryData<ProjectsResponse>([projectsKanbanPath()], {
          ...previous,
          data: previous.data.map((row) =>
            row.id === id ? { ...row, status: status as CrmProjectWithDetails["status"] } : row,
          ),
        });
      }
      setChangingId(id);
      setWriteRefusal(null);
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData([projectsKanbanPath()], context.previous);
      }
      setChangingId(null);
      setWriteRefusal(error.message || "Failed to move Project");
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [projectsKanbanPath()] });
      await queryClient.invalidateQueries({ queryKey: [projectsAllPath()] });
      window.setTimeout(() => setChangingId(null), 180);
    },
  });

  function onMove(id: string, status: string) {
    if (readOnly) {
      setWriteRefusal(
        chromeRefusal({
          kind: "workspace-condition",
          workspaceName,
          condition: "Read-only",
        }),
      );
      return;
    }
    moveProject.mutate({ id, status });
  }

  function onDragEnd(result: DropResult) {
    boardRef.current?.setAttribute("data-dragging", "false");
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    // A column is a Project Status; HTTP writes the combined lifecycle.
    onMove(draggableId, combinedStatusForProjectStatus(destination.droppableId));
  }

  const createProject = useMutation({
    mutationFn: (projectName: string) => apiRequest("POST", "/api/crm/projects", { name: projectName }),
    onSuccess: (response: { crmProject?: { id?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: [projectsAllPath()] });
      queryClient.invalidateQueries({ queryKey: [projectsKanbanPath()] });
      const createdId = response?.crmProject?.id ?? null;
      setSelectedId(createdId);
      setName("");
      setCreating(false);
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      setWriteRefusal(error.message || "Failed to create Project");
    },
  });

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName) return;
    if (readOnly) {
      setWriteRefusal(
        chromeRefusal({
          kind: "workspace-condition",
          workspaceName,
          condition: "Read-only",
        }),
      );
      return;
    }
    createProject.mutate(projectName);
  }

  if (isLoading || (boardView && boardLoading)) {
    return (
      <V2PageSkeleton title="Projects" testId="v2-projects" status="Loading Projects for this Workspace.">
        {boardView ? (
          <SkeletonBoard columns={PROJECT_BOARD_COLUMNS.map((column) => column.label)} />
        ) : (
          <SkeletonRegister
            className="df-projects-register"
            heads={["PROJECT / CLIENT", "STATUS", "LEAD", "BUDGET USED", "TRACKED MTD"]}
          />
        )}
      </V2PageSkeleton>
    );
  }

  if (isError || (boardView && boardError)) {
    return (
      <div className="df-page" data-testid="v2-projects">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Projects</h1>
            <p className="df-subhead">{register.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Projects in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-projects">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Projects</h1>
          <p className="df-subhead">{register.subhead}</p>
        </div>
        <div className="df-library-actions">
          <Button variant="default" type="button" onClick={() => setCreating((open) => !open)} className="df-btn">
            New Project
          </Button>
        </div>
      </header>

      {creating ? (
        <form className="df-filter-bar" onSubmit={onCreate}>
          <label className="df-filter-input">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project name"
              aria-label="Project name"
            />
          </label>
          <Button variant="default" type="submit" disabled={createProject.isPending || !name.trim()} className="df-btn">
            Create
          </Button>
        </form>
      ) : null}
      {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

      <div className="df-filter-bar">
        <label className="df-filter-input">
          <input
            type="search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter Projects"
            aria-label="Filter Projects"
          />
        </label>
        {boardView ? null : (
          <V2FilterSelect
            label="STATUS"
            ariaLabel="Filter by Project Status"
            value={statusFilter}
            active={statusFilter !== "all"}
            options={[
              { value: "all", label: "ALL" },
              { value: "planned", label: "PLANNED" },
              { value: "active", label: "ACTIVE" },
              { value: "on_hold", label: "ON HOLD" },
              { value: "in_review", label: "IN REVIEW" },
              { value: "completed", label: "COMPLETED" },
              { value: "archived", label: "ARCHIVED" },
            ]}
            onChange={setStatusFilter}
          />
        )}
        {boardView || workspaceTags.length === 0 ? null : (
          <V2FilterSelect
            label="TAG"
            ariaLabel="Filter by Tag"
            value={tagFilter}
            active={tagFilter !== "all"}
            options={[
              { value: "all", label: "ALL" },
              ...workspaceTags.map((tag) => ({ value: tag.id, label: tag.name.toUpperCase() })),
            ]}
            onChange={setTagFilter}
          />
        )}
        <div className="df-segment" role="group" aria-label="Project view">
          <button
            type="button"
            data-active={boardView ? "false" : "true"}
            onClick={() => setLocation("/projects")}
          >
            REGISTER
          </button>
          <button
            type="button"
            data-active={boardView ? "true" : "false"}
            onClick={() => setLocation("/projects?view=board")}
          >
            BOARD
          </button>
        </div>
      </div>

      {boardView ? (
        <>
          {board.empty ? <p className="df-empty">{board.emptyCopy}</p> : null}
          <DragDropContext
            onDragStart={() => boardRef.current?.setAttribute("data-dragging", "true")}
            onDragEnd={onDragEnd}
          >
            <div
              ref={boardRef}
              className="df-opportunity-pipeline"
              data-stacked={layout.stackedRegister ? "true" : "false"}
              data-dragging="false"
              data-testid="v2-projects-board"
            >
              {board.columns.map((column) => (
                <section
                  key={column.id}
                  className="df-card df-opportunity-column"
                  data-staged="true"
                  // Per-instance: the column's Project Status colour, read by the pill and the tint.
                  style={{ "--df-stage": column.color } as CSSProperties}
                >
                  <div className="df-card-head">
                    <h2 className="df-card-title">
                      <span className="df-stage-pill" data-ink={column.ink}>
                        {column.label}
                      </span>
                    </h2>
                    <span className="df-count-chip">{column.cards.length}</span>
                  </div>
                  <Droppable droppableId={column.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="df-opportunity-drop"
                        data-over={snapshot.isDraggingOver ? "true" : "false"}
                      >
                        {column.cards.map((card, index) => (
                          <Draggable
                            key={card.id}
                            draggableId={card.id}
                            index={index}
                            isDragDisabled={readOnly || !card.movable}
                          >
                            {(drag) => (
                              <ProjectBoardCardView
                                card={card}
                                provided={drag}
                                locked={readOnly || !card.movable}
                                onOpen={setLocation}
                              />
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </section>
              ))}
            </div>
          </DragDropContext>
        </>
      ) : null}

      {boardView ? null : (
      <section className="df-card df-projects-register" data-testid="v2-projects-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>PROJECT / CLIENT</span>
            <span>STATUS</span>
            <span>LEAD</span>
            <span>BUDGET USED</span>
            <span style={{ textAlign: "right" }}>TRACKED MTD</span>
          </div>
        )}
        {register.empty ? (
          <p className="df-empty">{register.emptyCopy}</p>
        ) : (
          register.rows.map((row) => (
            <Link
              key={row.id}
              href={row.href}
              className="df-register-row"
              data-selected={row.selected ? "true" : "false"}
              data-testid={`v2-project-row-${row.id}`}
              onPointerDown={() => setSelectedId(row.id)}
              onClick={() => setSelectedId(row.id)}
            >
              {layout.stackedRegister ? (
                <span className="df-project-mobile">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.name}</div>
                    <div className="df-mono df-meta">{mobileProjectMeta(row)}</div>
                  </span>
                </span>
              ) : (
                <>
                  <span style={{ minWidth: 0 }}>
                    <div className="df-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.name}
                    </div>
                    <div className="df-mono df-meta">
                      {row.clientLabel} · {row.kindLabel}
                      {row.tags.length > 0 ? ` · ${row.tags.join(" · ").toUpperCase()}` : ""}
                    </div>
                  </span>
                  <span>
                    <span className="df-status-word" data-swatch="" style={swatchStyle(row.statusColor)}>{row.status}</span>
                  </span>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>{row.lead}</span>
                  <span>
                    {row.budgetPercent == null ? (
                      <span className="df-mono df-meta">—</span>
                    ) : (
                      <span className="df-meter-row">
                        <span className="df-meter">
                          {/* Per-instance: the fill width is this project's budget share. */}
                          <span
                            className="df-meter-fill"
                            data-tone={meterTone(row.budgetPercent, row.status)}
                            style={{ width: `${Math.min(100, row.budgetPercent)}%` }}
                          />
                        </span>
                        <span className="df-mono" style={{ fontSize: 11, width: 36 }}>
                          {row.budgetPercent}%
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="df-mono" style={{ fontSize: 12, textAlign: "right" }}>
                    {row.trackedMtd}
                  </span>
                </>
              )}
            </Link>
          ))
        )}
        <div className="df-library-foot">
          <span>
            {register.count} {register.count === 1 ? "PROJECT" : "PROJECTS"}
          </span>
        </div>
      </section>
      )}
    </div>
  );
}

export function V2ProjectRecordRedirect() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  if (match.kind === "dossier") return <Redirect to={`/projects/${match.projectId}`} />;
  return <Redirect to="/projects" />;
}
