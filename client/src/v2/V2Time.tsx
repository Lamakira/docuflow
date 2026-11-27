import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CrmProjectWithDetails, SafeUser, TimeEntryWithDetails } from "@shared/schema";
import { canManageAdministration } from "./administration";
import { chromeRefusal } from "./chrome";
import { isStandingRefusal, notify } from "./notify";
import { useRefreshFailure } from "./useRefreshFailure";
import { motionForSurface } from "./motion";
import { composePaging } from "./paging";
import { memberName } from "./today";
import { TIME_TAB_IDS, timeTabHref, type TimeTabId } from "./presentation";
import { useToday } from "./useToday";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { V2ProjectPicker } from "./V2ProjectPicker";
import { V2RegisterPager } from "./V2RegisterPager";
import { V2TaskTable } from "./V2TaskTable";
import {
  composeProjectTasks,
  fullProjectName,
  TASK_BATCH_PATH,
  taskPath,
  tasksPath,
  type ProjectTask,
} from "./tasks";
import {
  composeTimeStats,
  composeTimeTracking,
  filterProjectOptions,
  isTimerProject,
  knownFilterId,
  projectTasksHref,
  rangeTotalLabel,
  readChosenProject,
  readTimeFilters,
  readTimePeriod,
  secondsSinceRead,
  timeEntriesPath,
  timePeriodLabel,
  timePeriodRange,
  timeStatsPath,
  timerProjectOptions,
  timerProjects,
  timeTabs,
  endOfDayLocal as endOfDay,
  startOfDayLocal as startOfDay,
  TIME_FILTERS_DEFAULT,
  TIME_PERIODS,
  TIME_RANGE_OPTIONS,
  TIME_STATUS_OPTIONS,
  widerTimeRange,
  writeChosenProject,
  writeTimeFilters,
  writeTimePeriod,
  type TimeEntryRowInput,
  type TimeFilters,
  type TimePeriod,
  type TimeStatsResponse,
} from "./time";
import { TimeRemovals } from "./timeRemovals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TASK_BATCH_ALL_DUPLICATES, planTaskBatch, taskBatchNotice, taskLines } from "@shared/taskBatch";
import { V2CompactEmpty, V2EmptyState, V2LoadFailed, V2RecordEmpty } from "./V2EmptyState";
import { SkeletonRegister, SkeletonSection, V2PageSkeleton } from "./V2Skeleton";
import { V2PageHead } from "./V2PageHead";

type TimeEntry = TimeEntryWithDetails & { secondsInPeriod?: number };
type TimeEntriesResponse = {
  data: TimeEntry[];
  total?: number;
  totals?: { duration: number; idle: number };
};
type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type TimeStats = { totalDuration: number };
type TasksResponse = { data: ProjectTask[] };

const ENTRY_MOTION = motionForSurface("time-entry").enterExit;
const STATS_MOTION = motionForSurface("time-stats-period").enterExit;
/** How long a removed row stays drawn while it fades; the removal itself waits on nothing here. */
const LEAVE_MS = 200;
const UNDO_MS = 6000;
const REREAD_MS = 60_000;

function startOfWeek(value: Date): Date {
  const start = startOfDay(value);
  const weekday = start.getDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  start.setDate(start.getDate() - offset);
  return start;
}

function toRow(entry: TimeEntry): TimeEntryRowInput {
  return {
    id: entry.id,
    startTime: entry.startTime,
    endTime: entry.endTime,
    lastActivityAt: entry.lastActivityAt,
    secondsInPeriod: entry.secondsInPeriod,
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
    workspaceRole: current?.workspaceRole ?? "",
    readOnly: current?.condition === "Read-only",
    ready: memberships !== undefined,
  };
}

/** The Projects the reader may see, on the Time tracker's own query. */
function useTimeProjects() {
  const query = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: async () => {
      const res = await fetch("/api/crm/projects?pageSize=500", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Projects");
      return res.json();
    },
  });
  // Another screen on this key may have cached a refusal's body.
  const list = Array.isArray(query.data?.data) ? query.data.data : null;
  const failed = query.isError || (query.isSuccess && list === null);
  return {
    list,
    /** Every Project is in the list, so an id outside it is unknown. */
    complete: list !== null && (query.data?.total ?? list.length) <= list.length,
    failed,
    state: list ? ("ready" as const) : failed ? ("failed" as const) : ("loading" as const),
    refetch: query.refetch,
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
  const now = useToday();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { layout } = useV2Chrome();
  const { workspaceName, workspaceRole, readOnly, ready } = useWorkspaceCondition();
  const canManage = ready && canManageAdministration(workspaceRole);
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
    startMutationPending,
    pauseMutationPending,
    resumeMutationPending,
    stopMutationPending,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
  } = useTimeTracker();

  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [leavingIds, setLeavingIds] = useState<string[]>([]);
  const knownIds = useRef<Set<string> | null>(null);

  const timeProjects = useTimeProjects();
  const { data: users } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const asked = readTimeFilters(search);
  const filters: TimeFilters = {
    ...asked,
    project: knownFilterId(asked.project, timeProjects.complete ? timeProjects.list : null),
    member: canManage ? knownFilterId(asked.member, users ?? null) : "all",
  };
  const { range } = filters;

  function setFilters(next: TimeFilters) {
    navigate(`${timeTabHref("entries")}${writeTimeFilters(search, next)}`, { replace: true });
  }

  const rangeDates = useMemo(() => {
    if (range === "all") return { startDate: null, endDate: null };
    if (range === "week") return { startDate: startOfWeek(now), endDate: endOfDay(now) };
    return { startDate: startOfDay(now), endDate: endOfDay(now) };
  }, [now, range]);

  const entriesUrl = timeEntriesPath({
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: filters.project === "all" ? null : filters.project,
    status: filters.status === "all" ? null : filters.status,
    userId: filters.member === "all" ? null : filters.member,
    page: filters.page,
    pageSize: filters.pageSize,
  });
  // The chip counts the reader's own day, whatever the register is filtered to.
  const statsUrl = timeStatsPath({
    startDate: startOfDay(now),
    endDate: endOfDay(now),
    userId: user?.id ?? null,
  });

  // Every visit re-reads; the cached rows show while it does, and a filter's
  // first read keeps the rows before it rather than the skeleton.
  const {
    data: entriesResponse,
    dataUpdatedAt: entriesReadAt,
    isLoading,
    isError,
    isPlaceholderData,
    refetch,
  } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time-tracking/entries", entriesUrl],
    enabled: ready,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(entriesUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Time Entries");
      return res.json();
    },
    staleTime: 0,
    refetchInterval: isRunning ? REREAD_MS : false,
  });
  const { data: stats, dataUpdatedAt: statsReadAt } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", statsUrl],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const res = await fetch(statsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Time stats");
      return res.json();
    },
    staleTime: 0,
    refetchInterval: isRunning ? REREAD_MS : false,
  });
  useRefreshFailure(isError && Boolean(entriesResponse), "Time Entries could not be refreshed.", "v2-time-refresh-failed");

  // A Timer started, paused or stopped elsewhere reaches this tab by the active
  // entry alone: the figures read before it are read again.
  const activeState = `${activeEntry?.id ?? ""}:${activeEntry?.status ?? ""}`;
  const seenState = useRef(activeState);
  useEffect(() => {
    if (seenState.current === activeState) return;
    seenState.current = activeState;
    queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/entries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/stats"] });
  }, [activeState]);

  const [, redraw] = useState(0);
  const [removals] = useState(
    () =>
      new TimeRemovals({
        send: (id) => apiRequest("DELETE", `/api/time-tracking/${id}`),
        show: ({ key }, { undo, end }) =>
          notify.success("Time Entry removed", {
            id: key,
            description: "Its Activity Evidence goes with it.",
            duration: UNDO_MS,
            action: { label: "Undo", onClick: undo },
            onAutoClose: end,
            onDismiss: end,
          }),
        hide: notify.dismiss,
        onSent: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/entries"] });
          queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/stats"] });
          queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/screenshots"] });
        },
        onFailed: (id, error) => notify.error(error, { fallback: "Time Entry could not be removed.", id: `v2-time-removal-failed-${id}` }),
        onChange: () => redraw((count) => count + 1),
      }),
  );
  // Leaving the page sends what is pending; a closed tab sends nothing.
  useEffect(() => () => removals.flush(), [removals]);

  const serverRows = entriesResponse?.data ?? [];
  const shownRows = serverRows.filter((entry) => !removals.isHidden(entry.id) || leavingIds.includes(entry.id));
  const hiddenRows = serverRows.filter((entry) => removals.isHidden(entry.id));
  const total = Math.max(0, (entriesResponse?.total ?? serverRows.length) - hiddenRows.length);
  const totalSeconds = Math.max(
    0,
    (entriesResponse?.totals?.duration ?? 0) -
      hiddenRows.reduce((sum, entry) => sum + (entry.secondsInPeriod ?? entry.duration ?? 0), 0),
  );
  const paging = composePaging({
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    noun: { one: "entry", many: "entries" },
  });

  // A shared link past the last page lands on the last one instead of nothing.
  useEffect(() => {
    if (!entriesResponse || isPlaceholderData || filters.page <= paging.pageCount) return;
    setFilters({ ...filters, page: paging.pageCount });
  }, [entriesResponse, isPlaceholderData, filters.page, paging.pageCount]);

  // Cheap "ever recorded" probe, asked only when the register is empty: the
  // newest one Time Entry the reader may see, in any period (#325).
  const probeEver = ready && !isLoading && !isError && serverRows.length === 0;
  const { data: everResponse } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time-tracking/entries", "ever"],
    enabled: probeEver,
    queryFn: async () => {
      const res = await fetch(timeEntriesPath({ limit: 1 }), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Time Entries");
      return res.json();
    },
  });
  const offered = useMemo(() => timerProjectOptions(timeProjects.list ?? []), [timeProjects.list]);
  const filterOptions = useMemo(
    () => [{ id: "all", label: "All", meta: null }, ...filterProjectOptions(timeProjects.list ?? [])],
    [timeProjects.list],
  );

  const page = composeTimeTracking({
    now,
    currentUserId: user?.id ?? "",
    isAdmin: canManage,
    isRunning,
    displayDuration,
    activeEntryId: activeEntry?.id ?? null,
    entries: shownRows.map(toRow),
    workdaySeconds: (stats?.totalDuration ?? 0) + secondsSinceRead(statsReadAt, Date.now(), isRunning, displayDuration),
    liveSeconds: secondsSinceRead(entriesReadAt, Date.now(), isRunning, displayDuration),
    periodStart: rangeDates.startDate,
    range,
    everRecorded: everResponse ? everResponse.data.length > 0 : null,
    hasProjects: timeProjects.list ? offered.length > 0 : true,
    canCreateProject: !readOnly,
    facetsActive: filters.project !== "all" || filters.status !== "all" || filters.member !== "all",
    facetLabels: [
      ...(filters.project !== "all"
        ? [`Project: ${filterOptions.find((option) => option.id === filters.project)?.label ?? "-"}`]
        : []),
      ...(filters.status !== "all"
        ? [`Status: ${TIME_STATUS_OPTIONS.find((option) => option.value === filters.status)?.label ?? "-"}`]
        : []),
      ...(filters.member !== "all" ? [`Member: ${memberName((users ?? []).find((member) => member.id === filters.member) ?? {})}`] : []),
    ],
  });

  if (entriesResponse && knownIds.current === null) {
    knownIds.current = new Set(page.rows.map((row) => row.id));
  }

  useEffect(() => {
    if (!knownIds.current) return;
    for (const row of page.rows) knownIds.current.add(row.id);
  }, [page.rows]);

  const loadFailed = isError && !entriesResponse;
  const busy = hasActiveEntry;
  // Idle, a Project kept from a Timer stopped elsewhere may be a sale: the Timer does not offer it.
  const kept = projects.find((project) => project.id === selectedProjectId);
  const timerProjectId = busy || !kept || isTimerProject(kept) ? selectedProjectId : "";
  const keptName = kept ? fullProjectName(kept) : undefined;
  const startBlocked = Boolean(taskStartBlockedReason) || !timerProjectId;
  const noTask = !busy && Boolean(timerProjectId) && taskStartBlockedReason === "no_tasks";
  const pending = startMutationPending || pauseMutationPending || resumeMutationPending || stopMutationPending;

  function refuseWrite() {
    setWriteRefusal(chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }));
  }

  function onDelete(id: string) {
    if (readOnly) {
      refuseWrite();
      return;
    }
    if (removals.isHidden(id)) return;
    setWriteRefusal(null);
    removals.remove(id);
    setLeavingIds((current) => [...current, id]);
    window.setTimeout(() => setLeavingIds((current) => current.filter((rowId) => rowId !== id)), LEAVE_MS);
  }

  function onPrimary() {
    if (readOnly) {
      refuseWrite();
      return;
    }
    if (busy) handleStop();
    else handleStart();
  }

  function onPauseResume() {
    if (readOnly) {
      refuseWrite();
      return;
    }
    if (isRunning) handlePause();
    else handleResume();
  }

  if (!ready || isLoading) {
    return (
      <V2PageSkeleton title="Time Tracking" hasSubhead={false} frame="fragment" status="Loading Time Entries for this Workspace.">
        <SkeletonSection title="Timer" lines={2} />
        <SkeletonRegister
          className="df-time-register"
          heads={["When", "Project", "Task", "Who", "Status", "Duration"]}
        />
      </V2PageSkeleton>
    );
  }

  return (
    <>
      <V2PageHead title="Time Tracking" chip={page.workdayHours} />

      <section className="df-card" data-testid="v2-time-timer">
        <div className="df-card-head">
          <h2 className="df-card-title">Timer</h2>
          <span className="df-mono df-meta">{isRunning ? "RUNNING" : isPaused ? "PAUSED" : "IDLE"}</span>
        </div>
        <div className="df-toolbar" data-align="start">
          <V2ProjectPicker
            variant="chip"
            label="Project"
            value={timerProjectId}
            valueLabel={busy ? (keptName ?? "This Project") : "Choose a Project"}
            disabled={readOnly || busy}
            onChange={(next) => {
              if (next === selectedProjectId) return;
              setSelectedProjectId(next);
              setSelectedTaskId("");
            }}
            options={offered}
            state={timeProjects.state}
            testId="v2-time-timer-project"
          />
          <V2FilterSelect
            label="Task"
            ariaLabel="Task"
            value={selectedTaskId || V2_SELECT_NONE}
            disabled={readOnly || busy || !timerProjectId}
            onChange={(next) => setSelectedTaskId(next === V2_SELECT_NONE ? "" : next)}
            options={[
              { value: V2_SELECT_NONE, label: "Choose a Task" },
              ...tasks
                .filter((task) => task.status !== "archived")
                .map((task) => ({ value: task.id, label: task.name })),
            ]}
          />
          <Button variant="default" type="button" data-primary={page.pagePrimary} disabled={readOnly || pending || (!busy && startBlocked)} onClick={onPrimary} className="df-btn">
            {busy ? "Stop" : "Start"}
          </Button>
          {busy ? (
            <Button variant="outline" type="button" disabled={readOnly || pending} onClick={onPauseResume} className="df-btn">
              {isRunning ? "Pause" : "Resume"}
            </Button>
          ) : null}
        </div>
        {noTask ? (
          <p className="df-note" data-testid="v2-time-timer-no-task">
            This Project has no Task yet.{" "}
            {readOnly ? null : (
              <Link href={projectTasksHref(timerProjectId)} className="df-cta">
                Add a Task
              </Link>
            )}
          </p>
        ) : null}
        {page.timerHint ? (
          <p className="df-note" data-testid="v2-time-timer-hint">
            {page.timerHint.href ? (
              <>
                <Link href={page.timerHint.href} className="df-cta">
                  {page.timerHint.linkLabel}
                </Link>
                {page.timerHint.copy.slice(page.timerHint.linkLabel.length)}
              </>
            ) : (
              page.timerHint.copy
            )}
          </p>
        ) : null}
      </section>

      <div className="df-filter-bar">
        <V2FilterSelect
          label="Range"
          ariaLabel="Range"
          value={range}
          active={range !== TIME_FILTERS_DEFAULT.range}
          onChange={(next) => setFilters({ ...filters, range: next as TimeFilters["range"], page: 1 })}
          options={TIME_RANGE_OPTIONS}
        />
        <V2ProjectPicker
          variant="chip"
          label="Project"
          ariaLabel="Filter by Project"
          value={filters.project}
          valueLabel="All"
          active={filters.project !== "all"}
          onChange={(project) => setFilters({ ...filters, project, page: 1 })}
          options={filterOptions}
          state={timeProjects.state}
          testId="v2-time-filter-project"
        />
        <V2FilterSelect
          label="Status"
          ariaLabel="Filter by status"
          value={filters.status}
          active={filters.status !== "all"}
          onChange={(status) => setFilters({ ...filters, status, page: 1 })}
          options={TIME_STATUS_OPTIONS}
        />
        {canManage ? (
          <V2FilterSelect
            label="Member"
            ariaLabel="Filter by Member"
            value={filters.member}
            active={filters.member !== "all"}
            onChange={(member) => setFilters({ ...filters, member, page: 1 })}
            options={[
              { value: "all", label: "All" },
              ...(users ?? []).map((member) => ({ value: member.id, label: memberName(member) })),
            ]}
          />
        ) : null}
      </div>

      {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

      <section className="df-card df-time-register" data-testid="v2-time-register">
        {layout.stackedRegister || loadFailed || page.emptyState ? null : (
          <div className="df-register-head df-desktop-only">
            <span>When</span>
            <span>Project</span>
            <span>Task</span>
            <span>Who</span>
            <span>Status</span>
            <span style={{ textAlign: "right" }}>Duration</span>
            <span />
          </div>
        )}
        {loadFailed ? (
          <V2LoadFailed
            title="Time Entries could not be loaded"
            onRetry={() => refetch()}
            testId="v2-time-load-failed"
          />
        ) : page.emptyState ? (
          <V2RecordEmpty
            model={page.emptyState}
            icon="time"
            action={
              page.emptyAction ? (
                <Button asChild variant="default" className="df-btn">
                  <Link href={page.emptyAction.href}>{page.emptyAction.label}</Link>
                </Button>
              ) : undefined
            }
            onClear={() => setFilters({ ...filters, project: "all", status: "all", member: "all", page: 1 })}
            onWiden={
              widerTimeRange(range) ? () => setFilters({ ...filters, range: widerTimeRange(range)!, page: 1 }) : undefined
            }
            testIds={{ none: "v2-time-register-empty", filtered: "v2-time-register-filtered", range: "v2-time-register-range" }}
          />
        ) : (
          page.rows.map((row) => {
            const leaving = removals.isHidden(row.id);
            return (
            <div
              key={row.id}
              className="df-register-row df-time-row"
              data-amber={row.holdsAmber ? "true" : "false"}
              data-motion={
                leaving || (knownIds.current !== null && !knownIds.current.has(row.id))
                  ? ENTRY_MOTION
                  : "none"
              }
              data-state={leaving ? "leaving" : "in"}
              data-testid={`v2-time-row-${row.id}`}
            >
              {layout.stackedRegister ? (
                <span className="df-project-mobile">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.project}</div>
                    <div className="df-mono df-meta">
                      {row.when} · {row.task} · {row.status}
                    </div>
                  </span>
                  <span className="df-time-duration">
                    <span className="df-mono df-time-clock">{row.duration}</span>
                    {row.inPeriod ? <span className="df-meta">{row.inPeriod}</span> : null}
                  </span>
                  {row.canDelete ? (
                    <Button variant="outline" type="button" onClick={() => onDelete(row.id)} className="df-btn">
                      <Trash2 strokeWidth={1.6} aria-hidden />
                      Remove
                    </Button>
                  ) : null}
                </span>
              ) : (
                <>
                  <span className="df-mono df-meta">{row.when}</span>
                  <span className="df-row-title">{row.project}</span>
                  <span className="df-time-task">{row.task}</span>
                  <span className="df-time-person">{row.who}</span>
                  <span className="df-mono df-meta df-time-entry-status">{row.status}</span>
                  <span className="df-time-duration">
                    <span className="df-mono df-time-clock">{row.duration}</span>
                    {row.inPeriod ? <span className="df-meta">{row.inPeriod}</span> : null}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {row.canDelete ? (
                      <Button variant="outline" type="button" onClick={() => onDelete(row.id)} className="df-btn">
                        <Trash2 strokeWidth={1.6} aria-hidden />
                        Remove
                      </Button>
                    ) : null}
                  </span>
                </>
              )}
            </div>
            );
          })
        )}
        {loadFailed || page.empty ? null : (
          <V2RegisterPager
            paging={{ ...paging, label: `${paging.label} · ${rangeTotalLabel(totalSeconds, range)}` }}
            ariaLabel="Time Entries pages"
            onPage={(next) => setFilters({ ...filters, page: next })}
            onPageSize={(pageSize) => setFilters({ ...filters, pageSize, page: 1 })}
          />
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
  const now = useToday();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { workspaceName, workspaceRole, readOnly, ready } = useWorkspaceCondition();
  const period = readTimePeriod(search);

  const canSeeEveryone = canManageAdministration(workspaceRole);
  const periodRange = useMemo(() => timePeriodRange(period, now), [period, now]);
  const statsUrl = timeStatsPath({
    startDate: periodRange.startDate,
    endDate: periodRange.endDate,
  });

  const { data, isLoading, isError, refetch } = useQuery<TimeStatsResponse>({
    queryKey: ["/api/time-tracking/stats", statsUrl],
    queryFn: async () => {
      const res = await fetch(statsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Time stats");
      return res.json();
    },
    staleTime: 0,
  });
  useRefreshFailure(isError && Boolean(data), "Time stats could not be refreshed.", "v2-time-stats-refresh-failed");

  // Same probe as Time Entries (shared cache key): asked only when the period
  // shows no Time Entry, to tell a never-used Workspace from an empty period.
  const probeEver = !isLoading && !isError && (data?.entriesCount ?? 0) === 0;
  const { data: everResponse } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time-tracking/entries", "ever"],
    enabled: probeEver,
    queryFn: async () => {
      const res = await fetch(timeEntriesPath({ limit: 1 }), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Time Entries");
      return res.json();
    },
  });
  const timeProjects = useTimeProjects();

  const page = composeTimeStats({
    period,
    workspaceName,
    canSeeEveryone,
    stats: data ?? null,
    everRecorded: everResponse ? everResponse.data.length > 0 : null,
    hasProjects: timeProjects.list ? timerProjects(timeProjects.list).length > 0 : true,
    canCreateProject: !readOnly,
  });

  if (!ready) {
    return (
      <V2PageSkeleton title="Time stats" frame="fragment" status="Loading Time stats for this Workspace.">
        <SkeletonSection title={timePeriodLabel(period)} tiles={4} />
        <SkeletonSection title="By Project" lines={3} />
        <SkeletonSection title="By Member" lines={3} />
      </V2PageSkeleton>
    );
  }

  return (
    <>
      <V2PageHead
        title="Time stats"
        subhead={page.subhead}
        actions={
          <V2FilterSelect
            label="Period"
            ariaLabel="Period"
            value={period}
            onChange={(next) =>
              navigate(`${timeTabHref("stats")}${writeTimePeriod(search, next as TimePeriod)}`, { replace: true })
            }
            options={TIME_PERIODS.map((option) => ({
              value: option,
              label: timePeriodLabel(option),
            }))}
            testId="v2-time-stats-period"
          />
        }
      />

      {isError && !data ? (
        <V2LoadFailed
          title="Time stats could not be loaded"
          onRetry={() => refetch()}
          testId="v2-time-stats-load-failed"
        />
      ) : page.neverRecorded ? (
        <V2EmptyState
          icon="time"
          title={page.neverRecorded.title}
          copy={page.neverRecorded.copy}
          action={
            page.neverRecordedAction ? (
              <Button asChild variant="default" className="df-btn">
                <Link href={page.neverRecordedAction.href}>{page.neverRecordedAction.label}</Link>
              </Button>
            ) : undefined
          }
          testId="v2-time-stats-empty"
        />
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
                  <div className="df-stat-value">{isLoading ? "-" : figure.value}</div>
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
              isLoading ? <p className="df-note">Loading…</p> : <V2CompactEmpty>{page.byProject.emptyCopy}</V2CompactEmpty>
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
                      {/* Per-instance: the fill width is this project's share of tracked time. */}
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
                isLoading ? <p className="df-note">Loading…</p> : <V2CompactEmpty>{page.byMember.emptyCopy}</V2CompactEmpty>
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
  const query = useSearch();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [taskName, setTaskName] = useState("");
  /** Why the typed list was not sent, shown under the field it is about. */
  const [listRefusal, setListRefusal] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const timeProjects = useTimeProjects();
  const projects = useMemo(() => timerProjects(timeProjects.list ?? []), [timeProjects.list]);
  const projectsLoading = timeProjects.state === "loading";
  const projectsFailed = timeProjects.state === "failed";
  const chosenId = readChosenProject(query);
  const selectedProjectId = projects.some((project) => project.id === chosenId) ? chosenId : null;
  useRefreshFailure(
    timeProjects.failed && timeProjects.list !== null,
    "Projects could not be refreshed.",
    "v2-time-projects-refresh-failed",
  );

  const tasksUrl = selectedProjectId ? tasksPath(selectedProjectId, { includeArchived: true }) : null;
  const {
    data: tasksResponse,
    isLoading: tasksLoading,
    isError: tasksError,
    refetch: refetchTasks,
  } = useQuery<TasksResponse>({
    queryKey: ["/api/tasks", tasksUrl],
    enabled: Boolean(tasksUrl),
    queryFn: async () => {
      const res = await fetch(tasksUrl as string, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Tasks");
      return res.json();
    },
    staleTime: 0,
  });
  useRefreshFailure(tasksError && Boolean(tasksResponse), "Tasks could not be refreshed.", "v2-time-tasks-refresh-failed");

  const page = composeProjectTasks({
    workspaceName,
    readOnly,
    search,
    selectedProjectId,
    projects,
    tasks: tasksResponse?.data ?? [],
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  }

  function onWriteError(error: Error) {
    if (!readOnly && !isStandingRefusal(error)) return notify.error(error);
    setWriteRefusal(
      readOnly
        ? chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" })
        : chromeRefusal({ kind: "generic", message: error.message }),
    );
  }

  const createTask = useMutation({
    mutationFn: (lines: string[]) =>
      apiRequest("POST", TASK_BATCH_PATH, { crmProjectId: selectedProjectId, names: lines }),
    onSuccess: (result: { data: unknown[]; skipped: number }) => {
      if (result.data.length === 0) {
        setListRefusal(TASK_BATCH_ALL_DUPLICATES);
        return;
      }
      invalidate();
      setTaskName("");
      setWriteRefusal(null);
      setListRefusal(null);
      notify.success(taskBatchNotice(result.data.length, result.skipped));
    },
    onError: onWriteError,
  });

  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProjectTask> }) =>
      apiRequest("PATCH", taskPath(id), data),
    onSuccess: (_result, { data }) => {
      invalidate();
      setEditingId(null);
      setWriteRefusal(null);
      if (data.name) notify.success("Task renamed");
    },
    onError: onWriteError,
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", taskPath(id)),
    onSuccess: () => {
      invalidate();
      setConfirmDeleteId(null);
      setWriteRefusal(null);
      notify.success("Task deleted");
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
    if (!taskName.trim() || !selectedProjectId || showRefusalIfReadOnly()) return;
    const lines = taskLines(taskName);
    const check = planTaskBatch(lines);
    if (!check.ok) {
      setListRefusal(check.message);
      return;
    }
    setListRefusal(null);
    createTask.mutate(lines);
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

  const header = (
    <V2PageHead title="Projects & Tasks" />
  );

  if (projectsFailed) {
    return (
      <>
        {header}
        <V2LoadFailed
          title="Projects could not be loaded"
          onRetry={() => timeProjects.refetch()}
          testId="v2-time-projects-load-failed"
        />
      </>
    );
  }

  // No Project at all: one full-width state instead of two panes (#325).
  if (!projectsLoading && page.noProjects && page.projectsEmptyState) {
    return (
      <>
        {header}
        <V2EmptyState
          icon="projects"
          title={page.projectsEmptyState.title}
          copy={page.projectsEmptyState.copy}
          action={
            page.canWrite ? (
              <Button asChild variant="default" className="df-btn">
                <Link href="/projects?new=1">New Project</Link>
              </Button>
            ) : undefined
          }
          testId="v2-time-projects-empty"
        />
      </>
    );
  }

  return (
    <>
      {header}

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
          {projectsLoading && page.projectsEmpty ? (
            <p className="df-note">Loading…</p>
          ) : page.projectsEmptyState ? (
            <V2RecordEmpty
              model={page.projectsEmptyState}
              icon="projects"
              action={
                page.canWrite ? (
                  <Button asChild variant="default" className="df-btn">
                    <Link href="/projects?new=1">New Project</Link>
                  </Button>
                ) : undefined
              }
              onClear={() => setSearch("")}
              testIds={{ none: "v2-time-projects-empty" }}
            />
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
                    navigate(`${timeTabHref("projects")}${writeChosenProject(query, project.id)}`, { replace: true });
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

        {page.selectedProjectName === null && !page.showChoose ? null : (
        <section className="df-card" data-testid="v2-time-tasks">
          {page.selectedProjectName === null ? (
            <V2EmptyState icon="tasks" title="No Project chosen" copy={page.chooseCopy} />
          ) : (
            <>
              <div className="df-card-head">
                <h2 className="df-card-title">{page.selectedProjectName}</h2>
                <span className="df-mono df-meta">{page.active.rows.length} open</span>
              </div>
              <div className="df-toolbar" data-align="start">
                <label className="df-filter-input">
                  <Textarea
                    value={taskName}
                    rows={1}
                    placeholder="New Task names, one per line…"
                    aria-label="New Task names, one per line"
                    disabled={!page.canWrite}
                    onChange={(event) => setTaskName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      if (!createTask.isPending) onCreate();
                    }}
                  />
                </label>
                <Button variant="default" type="button" disabled={!taskName.trim() || createTask.isPending} onClick={onCreate} className="df-btn">
                  <Plus strokeWidth={1.6} aria-hidden />
                  Add Task
                </Button>
              </div>
              {listRefusal ? (
                <p className="df-refusal" role="alert" data-testid="v2-time-task-list-refusal">
                  {listRefusal}
                </p>
              ) : null}

              {tasksError && !tasksResponse ? (
                <V2LoadFailed
                  title="Tasks could not be loaded"
                  onRetry={() => refetchTasks()}
                  testId="v2-time-tasks-load-failed"
                />
              ) : (
              <V2TaskTable
                rows={page.rows}
                canWrite={page.canWrite}
                loading={tasksLoading}
                emptyCopy={page.active.emptyState?.copy ?? ""}
                emptyTitle={page.active.emptyState?.title ?? "No Tasks"}
                editingId={editingId}
                editingName={editingName}
                confirmDeleteId={confirmDeleteId}
                setEditingName={setEditingName}
                onStartRename={(row) => {
                  setEditingId(row.id);
                  setEditingName(row.name);
                }}
                onRename={onRename}
                onCancelRename={() => setEditingId(null)}
                onSetStatus={onSetStatus}
                onDelete={onDelete}
                onCancelDelete={() => setConfirmDeleteId(null)}
              />
              )}
            </>
          )}
        </section>
        )}
      </div>
    </>
  );
}
