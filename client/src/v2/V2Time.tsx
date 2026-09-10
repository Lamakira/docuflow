import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SafeUser, TimeEntryWithDetails } from "@shared/schema";
import { chromeRefusal } from "./chrome";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { useV2Chrome } from "./V2Shell";
import {
  composeTimeTracking,
  timeEntriesPath,
  timeStatsPath,
  type TimeEntryRowInput,
} from "./time";

type TimeEntriesResponse = { data: TimeEntryWithDetails[] };
type TimeStats = { totalDuration: number };

const ENTRY_MOTION = motionForSurface("time-entry").enterExit;

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

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

export function V2TimePage() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();
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

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
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
      <div className="df-page" data-testid="v2-time">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Time Tracking</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="df-page" data-testid="v2-time">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Time Tracking</h1>
            <p className="df-subhead">{page.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Time Entries in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-time">
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
        <div className="df-filter-bar" style={{ padding: "14px 18px 16px" }}>
          <label className="df-filter-chip">
            PROJECT
            <select
              value={selectedProjectId}
              disabled={readOnly || busy}
              aria-label="Project"
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              <option value="">Choose a Project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.client?.name
                    ? `${project.client.name} · ${project.project?.name || "Untitled Project"}`
                    : project.project?.name || "Untitled Project"}
                </option>
              ))}
            </select>
          </label>
          <label className="df-filter-chip">
            TASK
            <select
              value={selectedTaskId}
              disabled={readOnly || busy || !selectedProjectId}
              aria-label="Task"
              onChange={(event) => setSelectedTaskId(event.target.value)}
            >
              <option value="">Choose a Task</option>
              {tasks
                .filter((task) => task.status !== "archived")
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
            </select>
          </label>
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
        <label className="df-filter-chip" data-active={range === "today" ? "true" : "false"}>
          RANGE
          <select value={range} aria-label="Range" onChange={(event) => setRange(event.target.value as typeof range)}>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="df-filter-chip">
          PROJECT
          <select
            value={projectFilter}
            aria-label="Filter by Project"
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="all">All</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.project?.name || "Untitled Project"}
              </option>
            ))}
          </select>
        </label>
        <label className="df-filter-chip">
          STATUS
          <select
            value={statusFilter}
            aria-label="Filter by status"
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="running">Running</option>
            <option value="paused">Paused</option>
            <option value="stopped">Stopped</option>
          </select>
        </label>
        {isAdmin ? (
          <label className="df-filter-chip">
            MEMBER
            <select
              value={userFilter}
              aria-label="Filter by Member"
              onChange={(event) => setUserFilter(event.target.value)}
            >
              <option value="all">All</option>
              {users.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberName(member)}
                </option>
              ))}
            </select>
          </label>
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
                    <button type="button" className="df-ghost-link" onClick={() => onDelete(row.id)}>
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
                      <button type="button" className="df-ghost-link" onClick={() => onDelete(row.id)}>
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
    </div>
  );
}
