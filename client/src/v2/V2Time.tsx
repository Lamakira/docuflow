import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CrmProjectWithDetails, SafeUser, TimeEntryWithDetails } from "@shared/schema";
import { chromeRefusal } from "./chrome";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { TIME_TAB_IDS, type TimeTabId } from "./presentation";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import {
  composeProjectTasks,
  taskPath,
  tasksPath,
  type ProjectTask,
} from "./tasks";
import {
  composeTimeStats,
  composeTimeTracking,
  timeEntriesPath,
  timePeriodLabel,
  timePeriodRange,
  timeStatsPath,
  timeTabs,
  endOfDayLocal as endOfDay,
  startOfDayLocal as startOfDay,
  TIME_PERIODS,
  type TimeEntryRowInput,
  type TimePeriod,
  type TimeStatsResponse,
} from "./time";

type TimeEntriesResponse = { data: TimeEntryWithDetails[] };
type TimeStats = { totalDuration: number };
type TasksResponse = { data: ProjectTask[] };

const ENTRY_MOTION = motionForSurface("time-entry").enterExit;
const STATS_MOTION = motionForSurface("time-stats-period").enterExit;

function startOfWeek(value: Date): Date {
  const start = startOfDay(value);
  const weekday = start.getDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  start.setDate(start.getDate() - offset);
  return start;
}

function toRow(entry: TimeEntryWithDetails): TimeEntryRowInput {
  return {
    id: entry.id,
    startTime: entry.startTime,
    duration: entry.duration,
    status: entry.status,
    userId: entry.userId,
    crmProjectId: entry.crmProjectId,
    taskId: entry.taskId,
    description: entry.description,
    user: entry.user,
    crmProject: entry.crmProject,
    task: entry.task,
  };
}

/** The Workspace a Member is reading, and whether it accepts writes. */
function useWorkspaceCondition() {
  const { memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  return {
    workspaceName: current?.workspaceName ?? "this Workspace",
    readOnly: current?.condition === "Read-only",
  };
}

export function V2TimePage() {
  const params = useParams<{ tab?: string }>();
  const requested = params.tab ?? "entries";
  const tab: TimeTabId = (TIME_TAB_IDS as readonly string[]).includes(requested)
    ? (requested as TimeTabId)
    : "entries";
  const tabs = timeTabs(tab);

  return (
    <div className="df-page" data-testid="v2-time">
      <nav className="df-tabs" aria-label="Time Tracking">
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="df-tab"
            data-active={item.active ? "true" : "false"}
            data-testid={`v2-time-tab-${item.id}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "stats" ? <TimeStatsPane /> : null}
      {tab === "projects" ? <ProjectTasksPane /> : null}
      {tab === "entries" ? <TimeEntriesPane /> : null}
    </div>
  );
}

function TimeEntriesPane() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { layout } = useV2Chrome();
  const { workspaceName, readOnly } = useWorkspaceCondition();
  const {
    projects,
    tasks,
    selectedProjectId,
    selectedTaskId,
    setSelectedProjectId,
    setSelectedTaskId,
    isRunning,
    isPaused,
    hasActiveEntry,
    displayDuration,
    activeEntry,
    taskStartBlockedReason,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
  } = useTimeTracker();

  const [range, setRange] = useState<"today" | "week" | "all">("today");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [leavingIds, setLeavingIds] = useState<string[]>([]);
  const knownIds = useRef<Set<string> | null>(null);

  const isAdmin = user?.role === "admin";

  const rangeDates = useMemo(() => {
    if (range === "all") return { startDate: null, endDate: null };
    if (range === "week") return { startDate: startOfWeek(now), endDate: endOfDay(now) };
    return { startDate: startOfDay(now), endDate: endOfDay(now) };
  }, [now, range]);

  const filters = {
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: projectFilter === "all" ? null : projectFilter,
    status: statusFilter === "all" ? null : statusFilter,
    userId: isAdmin && userFilter !== "all" ? userFilter : null,
  };
  const entriesUrl = timeEntriesPath(filters);
  // The Workday chip counts today, whatever range the register is filtered to.
  const statsUrl = timeStatsPath({
    startDate: startOfDay(now),
    endDate: endOfDay(now),
    userId: filters.userId,
  });

  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: entriesResponse, isLoading, isError } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time-tracking/entries", entriesUrl],
    queryFn: async () => {
      const res = await fetch(entriesUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Time Entries");
      return res.json();
    },
  });
  const { data: stats } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", statsUrl],
    queryFn: async () => {
      const res = await fetch(statsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Time stats");
      return res.json();
    },
  });

  const page = composeTimeTracking({
    now,
    workspaceName,
    currentUserId: user?.id ?? "",
    isAdmin,
    isRunning,
    displayDuration,
    activeEntryId: activeEntry?.id ?? null,
    entries: (entriesResponse?.data ?? []).map(toRow),
    workdaySeconds: stats?.totalDuration ?? 0,
  });

  if (!isLoading && !isError && knownIds.current === null) {
    knownIds.current = new Set(page.rows.map((row) => row.id));
  }

  useEffect(() => {
    if (!knownIds.current) return;
    for (const row of page.rows) knownIds.current.add(row.id);
  }, [page.rows]);

  const busy = hasActiveEntry;
  const startBlocked = Boolean(taskStartBlockedReason);

  const deleteEntry = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/time-tracking/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/stats"] });
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      setWriteRefusal(
        readOnly
          ? chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" })
          : chromeRefusal({ kind: "generic", message: error.message }),
      );
    },
  });

  function refuseWrite() {
    setWriteRefusal(chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }));
  }

  function onDelete(id: string) {
    if (readOnly) {
      refuseWrite();
      return;
    }
    if (ENTRY_MOTION === "instant" || leavingIds.includes(id)) {
      deleteEntry.mutate(id);
      return;
    }
    setLeavingIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  function onRowGone(id: string) {
    if (!leavingIds.includes(id)) return;
    deleteEntry.mutate(id, {
      onSettled: () => setLeavingIds((current) => current.filter((rowId) => rowId !== id)),
    });
  }

  function onPrimary() {
    if (readOnly) {
      refuseWrite();
      return;
    }
    if (isRunning) {
      handlePause();
      return;
    }
    if (isPaused) {
      handleResume();
      return;
    }
    handleStart();
  }

  function onStop() {
    if (readOnly) {
      refuseWrite();
      return;
    }
    handleStop();
  }

  if (isLoading) {
    return (
      <>
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Time Tracking</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Time Tracking</h1>
            <p className="df-subhead">{page.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Time Entries in this Workspace could not be loaded.</p>
      </>
    );
  }

  return (
    <>
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Time Tracking</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
        <span className="df-count-chip">{page.workdayHours}</span>
      </header>

      <section className="df-card" data-testid="v2-time-timer">
        <div className="df-card-head">
          <h2 className="df-card-title">Timer</h2>
          <span className="df-mono df-meta">{isRunning ? "RUNNING" : isPaused ? "PAUSED" : "IDLE"}</span>
        </div>
        <div className="df-toolbar" data-align="start">
          <V2FilterSelect
            label="PROJECT"
            ariaLabel="Project"
            value={selectedProjectId || V2_SELECT_NONE}
            disabled={readOnly || busy}
            onChange={(next) => setSelectedProjectId(next === V2_SELECT_NONE ? "" : next)}
            options={[
              { value: V2_SELECT_NONE, label: "Choose a Project" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.client?.name
                  ? `${project.client.name} · ${project.project?.name || "Untitled Project"}`
                  : project.project?.name || "Untitled Project",
              })),
            ]}
          />
          <V2FilterSelect
            label="TASK"
            ariaLabel="Task"
            value={selectedTaskId || V2_SELECT_NONE}
            disabled={readOnly || busy || !selectedProjectId}
            onChange={(next) => setSelectedTaskId(next === V2_SELECT_NONE ? "" : next)}
            options={[
              { value: V2_SELECT_NONE, label: "Choose a Task" },
              ...tasks
                .filter((task) => task.status !== "archived")
                .map((task) => ({ value: task.id, label: task.name })),
            ]}
          />
          <button
            type="button"
            className="df-ink-btn"
            data-primary={page.pagePrimary}
            disabled={readOnly || (!busy && startBlocked)}
            onClick={onPrimary}
          >
            {isRunning ? "Pause" : isPaused ? "Resume" : "Start"}
          </button>
          {hasActiveEntry ? (
            <button type="button" className="df-ink-btn" disabled={readOnly} onClick={onStop}>
              Stop
            </button>
          ) : null}
        </div>
      </section>

      <div className="df-filter-bar">
        <V2FilterSelect
          label="RANGE"
          ariaLabel="Range"
          value={range}
          active={range === "today"}
          onChange={(next) => setRange(next as typeof range)}
          options={[
            { value: "today", label: "Today" },
            { value: "week", label: "This week" },
            { value: "all", label: "All" },
          ]}
        />
        <V2FilterSelect
          label="PROJECT"
          ariaLabel="Filter by Project"
          value={projectFilter}
          onChange={setProjectFilter}
          options={[
            { value: "all", label: "All" },
            ...projects.map((project) => ({
              value: project.id,
              label: project.project?.name || "Untitled Project",
            })),
          ]}
        />
        <V2FilterSelect
          label="STATUS"
          ariaLabel="Filter by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All" },
            { value: "running", label: "Running" },
            { value: "paused", label: "Paused" },
            { value: "stopped", label: "Stopped" },
          ]}
        />
        {isAdmin ? (
          <V2FilterSelect
            label="MEMBER"
            ariaLabel="Filter by Member"
            value={userFilter}
            onChange={setUserFilter}
            options={[
              { value: "all", label: "All" },
              ...users.map((member) => ({ value: member.id, label: memberName(member) })),
            ]}
          />
        ) : null}
      </div>

      {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

      <section className="df-card df-time-register" data-testid="v2-time-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>WHEN</span>
            <span>PROJECT</span>
            <span>TASK</span>
            <span>WHO</span>
            <span>STATUS</span>
            <span style={{ textAlign: "right" }}>DURATION</span>
            <span />
          </div>
        )}
        {page.empty ? (
          <p className="df-empty">{page.emptyCopy}</p>
        ) : (
          page.rows.map((row) => (
            <div
              key={row.id}
              className="df-register-row df-time-row"
              data-amber={row.holdsAmber ? "true" : "false"}
              data-motion={
                leavingIds.includes(row.id) || (knownIds.current !== null && !knownIds.current.has(row.id))
                  ? ENTRY_MOTION
                  : "none"
              }
              data-state={leavingIds.includes(row.id) ? "leaving" : "in"}
              data-testid={`v2-time-row-${row.id}`}
              onTransitionEnd={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.propertyName !== "opacity" && event.propertyName !== "transform") return;
                onRowGone(row.id);
              }}
            >
              {layout.stackedRegister ? (
                <span className="df-project-mobile">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.project}</div>
                    <div className="df-mono df-meta">
                      {row.when} · {row.task} · {row.status}
                    </div>
                  </span>
                  <span className="df-mono df-time-clock">{row.duration}</span>
                  {row.canDelete ? (
                    <button type="button" className="df-ghost-btn" onClick={() => onDelete(row.id)}>
                      Remove
                    </button>
                  ) : null}
                </span>
              ) : (
                <>
                  <span className="df-mono df-meta">{row.when}</span>
                  <span className="df-row-title">{row.project}</span>
                  <span className="df-mono df-meta">{row.task}</span>
                  <span>{row.who}</span>
                  <span className="df-status">{row.status}</span>
                  <span className="df-mono df-time-clock" style={{ textAlign: "right" }}>
                    {row.duration}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {row.canDelete ? (
                      <button type="button" className="df-ghost-btn" onClick={() => onDelete(row.id)}>
                        Remove
                      </button>
                    ) : null}
                  </span>
                </>
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}

/**
 * Time stats — the Workday totals the v1 `/time-tracking/dashboard` reported.
 * Changing the period is the one novelty on this ticket: the figures crossfade
 * on opacity so the numbers do not jump, and the bars never parade in.
 */
function TimeStatsPane() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { workspaceName } = useWorkspaceCondition();
  const [period, setPeriod] = useState<TimePeriod>("week");

  const canSeeEveryone = user?.role === "admin";
  const periodRange = useMemo(() => timePeriodRange(period, now), [period, now]);
  const statsUrl = timeStatsPath({
    startDate: periodRange.startDate,
    endDate: periodRange.endDate,
  });

  const { data, isLoading, isError } = useQuery<TimeStatsResponse>({
    queryKey: ["/api/time-tracking/stats", statsUrl],
    queryFn: async () => {
      const res = await fetch(statsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Time stats");
      return res.json();
    },
  });

  const page = composeTimeStats({
    period,
    workspaceName,
    canSeeEveryone,
    stats: data ?? null,
  });

  return (
    <>
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Time stats</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
        <V2FilterSelect
          label="PERIOD"
          ariaLabel="Period"
          value={period}
          onChange={(next) => setPeriod(next as TimePeriod)}
          options={TIME_PERIODS.map((option) => ({
            value: option,
            label: timePeriodLabel(option),
          }))}
          testId="v2-time-stats-period"
        />
      </header>

      {isError ? (
        <p className="df-empty">Time stats for this Workspace could not be loaded.</p>
      ) : (
        <div
          key={period}
          className="df-time-stats"
          data-motion={STATS_MOTION}
          data-testid="v2-time-stats"
        >
          <section className="df-card">
            <div className="df-card-head">
              <h2 className="df-card-title">{page.periodLabel}</h2>
            </div>
            <div className="df-stat-band">
              {page.figures.map((figure) => (
                <div key={figure.label} className="df-stat">
                  <div className="df-mono df-meta">{figure.label}</div>
                  <div className="df-stat-value">{isLoading ? "—" : figure.value}</div>
                  <div className="df-mono df-meta">{figure.meta}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="df-card" data-testid="v2-time-stats-projects">
            <div className="df-card-head">
              <h2 className="df-card-title">By Project</h2>
            </div>
            {page.byProject.empty ? (
              <p className="df-empty">{isLoading ? "Loading…" : page.byProject.emptyCopy}</p>
            ) : (
              <div className="df-stat-bars">
                {page.byProject.rows.map((row) => (
                  <div key={row.id} className="df-stat-bar">
                    <div className="df-stat-bar-head">
                      <span className="df-row-title">{row.name}</span>
                      <span className="df-mono df-meta">
                        {row.hours} · {row.share}%
                      </span>
                    </div>
                    <span className="df-meter df-meter-wide">
                      <span
                        className="df-stat-bar-fill df-meter-fill"
                        style={{ width: `${Math.min(100, row.share ?? 0)}%` }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {page.showMembers ? (
            <section className="df-card" data-testid="v2-time-stats-members">
              <div className="df-card-head">
                <h2 className="df-card-title">By Member</h2>
              </div>
              {page.byMember.empty ? (
                <p className="df-empty">{isLoading ? "Loading…" : page.byMember.emptyCopy}</p>
              ) : (
                <div className="df-stat-bars">
                  {page.byMember.rows.map((row) => (
                    <div key={row.id} className="df-kv">
                      <span>{row.name}</span>
                      <span className="df-mono">{row.hours}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

/**
 * Projects & Tasks — the v1 `/time-tracking/projects` manager. It writes the
 * same `/api/tasks` records the Dossier Tasks list reads, so a Task created
 * here is the same Task there.
 */
function ProjectTasksPane() {
  const { workspaceName, readOnly } = useWorkspaceCondition();
  const [search, setSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [taskName, setTaskName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const { data: projectsResponse, isLoading: projectsLoading } = useQuery<{ data: CrmProjectWithDetails[] }>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500", { credentials: "include" }).then((res) => res.json()),
  });

  const tasksUrl = selectedProjectId ? tasksPath(selectedProjectId, { includeArchived: true }) : null;
  const { data: tasksResponse, isLoading: tasksLoading } = useQuery<TasksResponse>({
    queryKey: ["/api/tasks", tasksUrl],
    enabled: Boolean(tasksUrl),
    queryFn: async () => {
      const res = await fetch(tasksUrl as string, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Tasks");
      return res.json();
    },
  });

  const page = composeProjectTasks({
    workspaceName,
    readOnly,
    search,
    selectedProjectId,
    projects: projectsResponse?.data ?? [],
    tasks: tasksResponse?.data ?? [],
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  }

  function onWriteError(error: Error) {
    setWriteRefusal(
      readOnly
        ? chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" })
        : chromeRefusal({ kind: "generic", message: error.message }),
    );
  }

  const createTask = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/tasks", { crmProjectId: selectedProjectId, name }),
    onSuccess: () => {
      invalidate();
      setTaskName("");
      setWriteRefusal(null);
    },
    onError: onWriteError,
  });

  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProjectTask> }) =>
      apiRequest("PATCH", taskPath(id), data),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setWriteRefusal(null);
    },
    onError: onWriteError,
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", taskPath(id)),
    onSuccess: () => {
      invalidate();
      setConfirmDeleteId(null);
      setWriteRefusal(null);
    },
    onError: onWriteError,
  });

  /** Shows the refusal and reports that the write must not proceed. */
  function showRefusalIfReadOnly(): boolean {
    if (!readOnly) return false;
    setWriteRefusal(page.refusal);
    return true;
  }

  function onCreate() {
    const name = taskName.trim();
    if (!name || !selectedProjectId || showRefusalIfReadOnly()) return;
    createTask.mutate(name);
  }

  function onRename(id: string) {
    const name = editingName.trim();
    if (!name || showRefusalIfReadOnly()) return;
    updateTask.mutate({ id, data: { name } });
  }

  function onSetStatus(id: string, status: string) {
    if (showRefusalIfReadOnly()) return;
    updateTask.mutate({ id, data: { status } });
  }

  function onDelete(id: string) {
    if (showRefusalIfReadOnly()) return;
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    deleteTask.mutate(id);
  }

  return (
    <>
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Projects &amp; Tasks</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
      </header>

      {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

      <div className="df-task-manager">
        <section className="df-card" data-testid="v2-time-projects">
          <div className="df-card-head">
            <h2 className="df-card-title">Projects</h2>
          </div>
          <div className="df-toolbar" data-align="start">
            <label className="df-filter-input">
              <input
                type="search"
                value={search}
                placeholder="Search Projects…"
                aria-label="Search Projects"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          {page.projectsEmpty ? (
            <p className="df-empty">{projectsLoading ? "Loading…" : page.projectsEmptyCopy}</p>
          ) : (
            <div className="df-task-projects">
              {page.projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="df-register-row df-task-project"
                  data-selected={project.selected ? "true" : "false"}
                  data-testid={`v2-time-project-${project.id}`}
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setEditingId(null);
                    setConfirmDeleteId(null);
                  }}
                >
                  <span className="df-row-title">{project.name}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="df-card" data-testid="v2-time-tasks">
          {page.selectedProjectName === null ? (
            <p className="df-empty">{page.chooseCopy}</p>
          ) : (
            <>
              <div className="df-card-head">
                <h2 className="df-card-title">{page.selectedProjectName}</h2>
                <span className="df-mono df-meta">{page.active.rows.length} OPEN</span>
              </div>
              <div className="df-toolbar" data-align="start">
                <label className="df-filter-input">
                  <input
                    value={taskName}
                    placeholder="New Task name…"
                    aria-label="New Task name"
                    disabled={!page.canWrite}
                    onChange={(event) => setTaskName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onCreate();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="df-ink-btn"
                  disabled={!taskName.trim() || createTask.isPending}
                  onClick={onCreate}
                >
                  Add Task
                </button>
              </div>

              {page.active.empty ? (
                <p className="df-empty">{tasksLoading ? "Loading…" : page.active.emptyCopy}</p>
              ) : (
                page.active.rows.map((row) => (
                  <div
                    key={row.id}
                    className="df-register-row df-task-row"
                    data-testid={`v2-time-task-${row.id}`}
                  >
                    {editingId === row.id ? (
                      <>
                        <input
                          className="df-task-rename"
                          value={editingName}
                          aria-label="Task name"
                          autoFocus
                          onChange={(event) => setEditingName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") onRename(row.id);
                            if (event.key === "Escape") setEditingId(null);
                          }}
                        />
                        <span className="df-row-actions">
                          <button type="button" className="df-ink-btn" onClick={() => onRename(row.id)}>
                            Save
                          </button>
                          <button type="button" className="df-ghost-btn" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="df-row-title">{row.name}</span>
                        <span className="df-status-word">{row.status}</span>
                        {page.canWrite ? (
                          <span className="df-row-actions">
                            <button
                              type="button"
                              className="df-ghost-btn"
                              onClick={() => {
                                setEditingId(row.id);
                                setEditingName(row.name);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              className="df-ghost-btn"
                              onClick={() => onSetStatus(row.id, "archived")}
                            >
                              Archive
                            </button>
                            <button
                              type="button"
                              className="df-ghost-btn"
                              data-danger={confirmDeleteId === row.id ? "true" : "false"}
                              onClick={() => onDelete(row.id)}
                            >
                              {confirmDeleteId === row.id ? "Confirm delete" : "Delete"}
                            </button>
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>
                ))
              )}

              {page.archived.count > 0 ? (
                <>
                  <div className="df-register-head df-task-archived-head">
                    <span>ARCHIVED ({page.archived.count})</span>
                  </div>
                  {page.archived.rows.map((row) => (
                    <div
                      key={row.id}
                      className="df-register-row df-task-row"
                      data-archived="true"
                      data-testid={`v2-time-task-${row.id}`}
                    >
                      <span className="df-row-title">{row.name}</span>
                      <span className="df-status-word">{row.status}</span>
                      {page.canWrite ? (
                        <span className="df-row-actions">
                          <button
                            type="button"
                            className="df-ghost-btn"
                            onClick={() => onSetStatus(row.id, "open")}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            className="df-ghost-btn"
                            data-danger={confirmDeleteId === row.id ? "true" : "false"}
                            onClick={() => onDelete(row.id)}
                          >
                            {confirmDeleteId === row.id ? "Confirm delete" : "Delete"}
                          </button>
                        </span>
                      ) : null}
                    </div>
                  ))}
                </>
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}
