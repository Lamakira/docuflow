import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { DragDropContext, Draggable, Droppable, type DraggableProvided, type DropResult } from "@hello-pangea/dnd";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { createColumnHelper, rowSortingFeature, tableFeatures, useTable, type SortingState } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CrmClient, CrmProjectWithDetails, CrmTag } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { tagsPath } from "./dossier";
import { meterTone, swatchStyle } from "./palette";
import { matchV2Route } from "./presentation";
import {
  combinedStatusForProjectStatus,
  composeProjectBoard,
  newProjectPayload,
  projectBudgetPercent,
  readProjectBudget,
  EMPTY_PROJECT_BUDGET_DRAFT,
  composeProjectRegister,
  clearProjectFilters,
  projectFilterLabels,
  projectRegisterPath,
  projectsAllPath,
  projectsKanbanPath,
  projectVisibleTo,
  readProjectFilters,
  writeProjectFilters,
  PROJECT_BOARD_COLUMNS,
  PROJECT_DUE_OPTIONS,
  PROJECT_SORTS,
  PROJECT_STATUS_OPTIONS,
  PROJECT_TYPE_OPTIONS,
  type ProjectBoardCard,
  type ProjectRegisterFilters,
  type ProjectRegisterRow,
  type ProjectRegisterRowInput,
  type ProjectSort,
} from "./projects";
import { composePaging } from "./paging";
import { formatHours, memberName, mobileProjectMeta } from "./today";
import { useV2Chrome } from "./V2Shell";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect } from "./V2Select";
import { V2RegisterPager } from "./V2RegisterPager";
import { Button } from "@/components/ui/button";
import { SkeletonBoard, SkeletonRegister, V2PageSkeleton } from "./V2Skeleton";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type WorkspacePeople = {
  memberships: Array<{ userId: string; firstName: string | null; lastName: string | null; email: string; archived: boolean }>;
};

const SEARCH_SETTLE_MS = 250;

/** Switching view keeps the filters, so coming back to the register finds them. */
function withView(search: string, view: "board" | null): string {
  const params = new URLSearchParams(search);
  if (view) params.set("view", view);
  else params.delete("view");
  params.delete("new");
  const query = params.toString();
  return query ? `?${query}` : "";
}
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
    budgetPercent: projectBudgetPercent(project),
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

const projectTableFeatures = tableFeatures({ rowSortingFeature });
const projectColumn = createColumnHelper<typeof projectTableFeatures, ProjectRegisterRow>();

function isSortable(id: string): id is ProjectSort {
  return (PROJECT_SORTS as readonly string[]).includes(id);
}

/**
 * The desktop register (#275): TanStack Table holds the columns and the sort
 * state, the server holds the order — `manualSorting` trusts the page as it
 * arrives. The whole row opens the Dossier; the name is also a link, for the
 * keyboard and for opening in a new tab.
 */
function ProjectRegisterTable({
  rows,
  sort,
  dir,
  onSort,
  onOpen,
}: {
  rows: ProjectRegisterRow[];
  sort: ProjectSort | "";
  dir: "asc" | "desc";
  onSort: (sort: ProjectSort | "", dir: "asc" | "desc") => void;
  onOpen: (row: ProjectRegisterRow) => void;
}) {
  const sorting: SortingState = sort ? [{ id: sort, desc: dir === "desc" }] : [];
  const columns = useMemo(
    () =>
      projectColumn.columns([
        projectColumn.accessor("name", {
          header: "PROJECT / CLIENT",
          cell: ({ row }) => (
            <span style={{ minWidth: 0, display: "block" }}>
              <Link
                href={row.original.href}
                className="df-row-title df-row-link"
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}
              >
                {row.original.name}
              </Link>
              <span className="df-mono df-meta" style={{ display: "block" }}>
                {row.original.clientLabel} · {row.original.kindLabel}
                {row.original.tags.length > 0 ? ` · ${row.original.tags.join(" · ").toUpperCase()}` : ""}
              </span>
            </span>
          ),
        }),
        projectColumn.accessor("status", {
          header: "STATUS",
          cell: ({ row }) => (
            <span className="df-status-word" data-swatch="" style={swatchStyle(row.original.statusColor)}>{row.original.status}</span>
          ),
        }),
        projectColumn.accessor("lead", {
          header: "PROJECT MANAGER",
          enableSorting: false,
          cell: ({ row }) => <span style={{ fontWeight: 500, fontSize: 13.5 }}>{row.original.lead}</span>,
        }),
        projectColumn.accessor("budgetPercent", {
          id: "budget",
          header: "BUDGET USED",
          cell: ({ row }) =>
            row.original.budgetPercent == null ? (
              <span className="df-mono df-meta">—</span>
            ) : (
              <span className="df-meter-row">
                <span className="df-meter">
                  {/* Per-instance: the fill width is this project's budget share. */}
                  <span
                    className="df-meter-fill"
                    data-tone={meterTone(row.original.budgetPercent, row.original.status)}
                    style={{ width: `${Math.min(100, row.original.budgetPercent)}%` }}
                  />
                </span>
                <span className="df-mono" style={{ fontSize: 11, width: 36 }}>
                  {row.original.budgetPercent}%
                </span>
              </span>
            ),
        }),
        projectColumn.accessor("trackedMtd", {
          id: "tracked",
          header: "TRACKED MTD",
          enableSorting: false,
          cell: ({ row }) => <span className="df-mono" style={{ fontSize: 12 }}>{row.original.trackedMtd}</span>,
        }),
      ]),
    [],
  );

  const table = useTable({
    features: projectTableFeatures,
    columns,
    data: rows,
    manualSorting: true,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (first && isSortable(first.id)) onSort(first.id, first.desc ? "desc" : "asc");
      else onSort("", "asc");
    },
  });

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, row: ProjectRegisterRow) {
    if ((event.target as HTMLElement).closest("a, button")) return;
    if (event.metaKey || event.ctrlKey) {
      window.open(row.href, "_blank", "noopener,noreferrer");
      return;
    }
    onOpen(row);
  }

  return (
    <Table className="df-table" data-testid="v2-projects-table">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="df-table-head-row">
            {group.headers.map((header) => {
              const sortable = header.column.getCanSort();
              const direction = header.column.getIsSorted();
              return (
                <TableHead
                  key={header.id}
                  className="df-table-head"
                  data-column={header.column.id}
                  aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}
                >
                  {header.isPlaceholder ? null : sortable ? (
                    <button
                      type="button"
                      className="df-table-sort"
                      data-sorted={direction || "none"}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <table.FlexRender header={header} />
                      <span aria-hidden="true">
                        {direction === "asc" ? "↑" : direction === "desc" ? "↓" : ""}
                      </span>
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            className="df-table-row"
            data-selected={row.original.selected ? "true" : "false"}
            data-testid={`v2-project-row-${row.original.id}`}
            onClick={(event) => onRowClick(event, row.original)}
          >
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className="df-table-cell" data-column={cell.column.id}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function V2ProjectsPage() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const boardView = new URLSearchParams(search).get("view") === "board";
  const filters = readProjectFilters(search);
  const boardRef = useRef<HTMLDivElement>(null);
  const [filterQuery, setFilterQuery] = useState(filters.q);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(
    () => new URLSearchParams(window.location.search).get("new") === "1",
  );
  const [name, setName] = useState("");
  const [budgetDraft, setBudgetDraft] = useState(EMPTY_PROJECT_BUDGET_DRAFT);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonth(now), [now]);
  const dayEnd = useMemo(() => endOfDay(now), [now]);
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  function setFilters(next: ProjectRegisterFilters) {
    setLocation(`/projects${writeProjectFilters(search, next)}`, { replace: true });
  }

  // The search box answers each keystroke; the URL, and so the server page,
  // follows once typing settles.
  useEffect(() => {
    if (filterQuery === filters.q) return;
    const timer = window.setTimeout(() => setFilters({ ...filters, q: filterQuery, page: 1 }), SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [filterQuery]);

  const registerPath = projectRegisterPath(filters, now);
  const {
    data: projectsResponse,
    isLoading: registerLoading,
    isError: registerError,
  } = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", "register-page", registerPath],
    enabled: !boardView,
    placeholderData: keepPreviousData,
    queryFn: () => loadProjectList(registerPath),
  });
  const isLoading = !boardView && registerLoading;
  const isError = !boardView && registerError;
  const { data: clients = [] } = useQuery<CrmClient[]>({
    queryKey: ["/api/crm/clients"],
    enabled: !boardView,
  });
  const { data: people } = useQuery<WorkspacePeople>({
    queryKey: ["/api/workspace/memberships"],
    enabled: !boardView,
  });
  const total = projectsResponse?.total ?? projectsResponse?.data.length ?? 0;
  const paging = composePaging({
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    noun: { one: "PROJECT", many: "PROJECTS" },
  });

  // A shared link past the last page lands on the last one instead of nothing.
  useEffect(() => {
    if (!projectsResponse || filters.page <= paging.pageCount) return;
    setFilters({ ...filters, page: paging.pageCount });
  }, [projectsResponse, filters.page, paging.pageCount]);
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
  const clientOptions = [...clients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((client) => ({ value: client.id, label: client.name }));
  const leadOptions = (people?.memberships ?? [])
    .filter((person) => !person.archived)
    .map((person) => ({ value: person.userId, label: memberName(person) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const activeFilters = projectFilterLabels(filters, {
    clients: new Map(clientOptions.map((option) => [option.value, option.label])),
    leads: new Map(leadOptions.map((option) => [option.value, option.label])),
    tags: new Map(workspaceTags.map((tag) => [tag.id, tag.name])),
  });
  // The server already narrowed these rows; the composer only names what did it.
  const register = composeProjectRegister({
    workspaceName,
    projects: (projectsResponse?.data ?? []).map((project) =>
      toRegisterProject(project, monthByProject.get(project.id) ?? 0, {
        userId: user?.id ?? "",
        role: current?.workspaceRole ?? null,
      }),
    ),
    filterQuery: "",
    statusFilter: "all",
    tagFilter: "all",
    activeFilters,
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
      await queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", "register-page"] });
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
    mutationFn: (payload: NonNullable<ReturnType<typeof newProjectPayload>>) =>
      apiRequest("POST", "/api/crm/projects", payload),
    onSuccess: (response: { crmProject?: { id?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: [projectsAllPath()] });
      queryClient.invalidateQueries({ queryKey: [projectsKanbanPath()] });
      const createdId = response?.crmProject?.id ?? null;
      setSelectedId(createdId);
      setName("");
      setBudgetDraft(EMPTY_PROJECT_BUDGET_DRAFT);
      setCreating(false);
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      setWriteRefusal(error.message || "Failed to create Project");
    },
  });

  const budgetIssue = readProjectBudget(budgetDraft).issue;

  function onCreate() {
    const payload = newProjectPayload(name, budgetDraft);
    if (!payload) return;
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
    createProject.mutate(payload);
  }

  if (isLoading || (boardView && boardLoading)) {
    return (
      <V2PageSkeleton title="Projects" testId="v2-projects" status="Loading Projects for this Workspace.">
        {boardView ? (
          <SkeletonBoard columns={PROJECT_BOARD_COLUMNS.map((column) => column.label)} />
        ) : (
          <SkeletonRegister
            className="df-projects-register"
            heads={["PROJECT / CLIENT", "STATUS", "PROJECT MANAGER", "BUDGET USED", "TRACKED MTD"]}
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
          <Button
            variant="default"
            type="button"
            onClick={() => {
              setName("");
              setBudgetDraft(EMPTY_PROJECT_BUDGET_DRAFT);
              setWriteRefusal(null);
              setCreating(true);
            }}
            className="df-btn"
          >
            New Project
          </Button>
        </div>
      </header>

      <V2FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New Project"
        description="A Project is the delivery work Tasks and Time Entries hang from. Its budget can wait for its Dossier's Settings, like everything else past its name."
        submitLabel="Create Project"
        pending={createProject.isPending}
        canSubmit={newProjectPayload(name, budgetDraft) !== null}
        onSubmit={onCreate}
        refusal={budgetIssue ?? writeRefusal}
        testId="v2-projects-new"
      >
        <label className="df-daily-field">
          NAME
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            aria-label="Project name"
          />
        </label>
        <div className="df-field-pair">
          <label className="df-daily-field">
            BUDGET HOURS
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={budgetDraft.hours}
              onChange={(event) => setBudgetDraft((draft) => ({ ...draft, hours: event.target.value }))}
              placeholder="No budget"
              aria-label="Budget hours"
            />
          </label>
          <label className="df-daily-field">
            MINUTES
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              step={1}
              value={budgetDraft.minutes}
              onChange={(event) => setBudgetDraft((draft) => ({ ...draft, minutes: event.target.value }))}
              placeholder="0"
              aria-label="Budget minutes"
            />
          </label>
        </div>
      </V2FormDialog>
      {writeRefusal && !creating ? <p className="df-refusal">{writeRefusal}</p> : null}

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
          <>
            <V2FilterSelect
              label="STATUS"
              ariaLabel="Filter by Project Status"
              value={filters.status}
              active={filters.status !== "all"}
              options={[{ value: "all", label: "ALL" }, ...PROJECT_STATUS_OPTIONS]}
              onChange={(status) => setFilters({ ...filters, status, page: 1 })}
            />
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
            {leadOptions.length === 0 ? null : (
              <V2FilterSelect
                label="PROJECT MANAGER"
                ariaLabel="Filter by Project Manager"
                value={filters.lead}
                active={filters.lead !== "all"}
                options={[{ value: "all", label: "ALL" }, ...leadOptions]}
                onChange={(lead) => setFilters({ ...filters, lead, page: 1 })}
              />
            )}
            {workspaceTags.length === 0 ? null : (
              <V2FilterSelect
                label="TAG"
                ariaLabel="Filter by Tag"
                value={filters.tag}
                active={filters.tag !== "all"}
                options={[
                  { value: "all", label: "ALL" },
                  ...workspaceTags.map((tag) => ({ value: tag.id, label: tag.name.toUpperCase() })),
                ]}
                onChange={(tag) => setFilters({ ...filters, tag, page: 1 })}
              />
            )}
            <V2FilterSelect
              label="TYPE"
              ariaLabel="Filter by Project type"
              value={filters.type}
              active={filters.type !== "all"}
              options={[{ value: "all", label: "ALL" }, ...PROJECT_TYPE_OPTIONS]}
              onChange={(type) => setFilters({ ...filters, type, page: 1 })}
            />
            <V2FilterSelect
              label="DUE"
              ariaLabel="Filter by due date"
              value={filters.due}
              active={filters.due !== "all"}
              options={[{ value: "all", label: "ANY" }, ...PROJECT_DUE_OPTIONS]}
              onChange={(due) => setFilters({ ...filters, due, page: 1 })}
            />
          </>
        )}
        <div className="df-segment" role="group" aria-label="Project view">
          <button
            type="button"
            data-active={boardView ? "false" : "true"}
            onClick={() => setLocation(`/projects${withView(search, null)}`)}
          >
            REGISTER
          </button>
          <button
            type="button"
            data-active={boardView ? "true" : "false"}
            onClick={() => setLocation(`/projects${withView(search, "board")}`)}
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
        {register.empty ? (
          <div className="df-empty-state">
            <p className="df-empty">{register.emptyCopy}</p>
            {register.filtered ? (
              <Button
                variant="outline"
                type="button"
                className="df-btn"
                onClick={() => {
                  setFilterQuery("");
                  setFilters(clearProjectFilters(filters));
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : layout.stackedRegister ? (
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
              <span className="df-project-mobile">
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div className="df-row-title">{row.name}</div>
                  <div className="df-mono df-meta">{mobileProjectMeta(row)}</div>
                </span>
              </span>
            </Link>
          ))
        ) : (
          <ProjectRegisterTable
            rows={register.rows}
            sort={filters.sort}
            dir={filters.dir}
            onSort={(sort, dir) => setFilters({ ...filters, sort, dir, page: 1 })}
            onOpen={(row) => {
              setSelectedId(row.id);
              setLocation(row.href);
            }}
          />
        )}
        <V2RegisterPager
          paging={paging}
          ariaLabel="Projects pages"
          onPage={(page) => setFilters({ ...filters, page })}
          onPageSize={(pageSize) => setFilters({ ...filters, pageSize, page: 1 })}
        />
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
