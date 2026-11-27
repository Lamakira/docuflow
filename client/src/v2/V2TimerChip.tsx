import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Task } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { PlayIcon, PauseIcon, StopIcon } from "./icons";
import { timerChipCommands } from "./chrome";
import { formatElapsedClock, timerChipModel } from "./presentation";
import { useStartTimer } from "./V2StartTimer";
import { notify } from "./notify";
import { isTimerProject, projectTasksHref } from "./time";

export function V2TimerChip({
  variant = "chip",
  workspaceLabel = null,
}: {
  variant?: "chip" | "strip";
  workspaceLabel?: string | null;
}) {
  const [, navigate] = useLocation();
  const {
    activeEntry,
    taskTodayDuration,
    isRunning,
    isPaused,
    hasActiveEntry,
    projects,
    tasks,
    selectedProjectId,
    taskStartBlockedReason,
    timers,
    handlePause,
    handleResume,
    handleStop,
    handlePauseTimer,
    handleResumeTimer,
    handleStopTimer,
    handleStopAll,
  } = useTimeTracker();
  // Start asks add or switch first (ADR-0031); it answers true only once the server took the Timer.
  const { start: handleStart, dialog: startDialog } = useStartTimer();
  const [timersOpen, setTimersOpen] = useState(false);

  const project = projects.find((item) => item.id === activeEntry?.crmProjectId);
  const projectName = project?.project?.name || null;
  const clientName = project?.client?.name || null;
  const projectLabel =
    clientName && projectName ? `${clientName} · ${projectName}` : projectName;
  const task = tasks.find((item) => item.id === activeEntry?.taskId);
  const model = timerChipModel({
    isRunning,
    isPaused,
    hasActiveEntry,
    displayDuration: taskTodayDuration,
    projectLabel,
    taskLabel: task?.name ?? null,
    workspaceLabel,
  });
  const commands = timerChipCommands(model.appearance);

  async function onPrimary() {
    if (commands.primary === "pause") {
      if (await handlePause()) notify.success("Timer paused");
      return;
    }
    if (commands.primary === "resume") {
      if (await handleResume()) notify.success("Timer resumed");
      return;
    }
    // A Project kept from a Timer stopped elsewhere may be a sale, or gone.
    const selected = projects.find((item) => item.id === selectedProjectId);
    if (taskStartBlockedReason === "no_project" || !selectedProjectId || (selected && !isTimerProject(selected))) {
      notify.info("Choose a Project before starting the Timer.");
      return;
    }
    if (taskStartBlockedReason === "no_tasks") {
      notify.info("This Project has no Task yet.", {
        action: { label: "Add a Task", onClick: () => navigate(projectTasksHref(selectedProjectId)) },
        duration: 8000,
      });
      return;
    }
    if (taskStartBlockedReason === "no_task_selected" || taskStartBlockedReason === "loading") {
      notify.info("Choose a Task before starting the Timer.");
      return;
    }
    if (await handleStart()) notify.success("Timer started");
  }

  async function onStop() {
    if (await handleStop()) notify.success("Timer stopped");
  }

  const extraTimers = timers.length - 1;
  const projectNamesOf = (crmProjectId: string) => {
    const row = projects.find((item) => item.id === crmProjectId);
    return { projectName: row?.project?.name || "Project", clientName: row?.client?.name || null };
  };

  const strip = variant === "strip";
  if (strip && model.appearance === "idle") return null;

  return (
    <div
      className={strip ? "df-timer-strip" : "df-chip"}
      data-appearance={model.appearance}
      data-testid={strip ? "v2-timer-strip" : "v2-timer-chip"}
      data-amber={model.holdsAmber ? "true" : "false"}
    >
      <button type="button" className="df-chip-main" onClick={onPrimary} aria-label={timerLabel(commands.primary)}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: model.holdsAmber ? "var(--df-amber)" : "var(--df-placeholder)",
            flex: "none",
          }}
        />
        <span className="df-chip-text" style={{ minWidth: 0, flex: strip ? 1 : undefined }}>
          <span
            className={model.appearance === "running" ? undefined : "df-nav"}
            style={{
              fontWeight: 500,
              fontSize: strip ? 12 : model.appearance === "paused" ? 12 : 11.5,
              color: model.appearance === "running" ? "var(--df-case-ink)" : "var(--df-archive-slate)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: strip ? "none" : 180,
            }}
          >
            {model.title}
          </span>
          {model.appearance === "running" && model.subtitle ? (
            <span
              className="df-mono"
              style={{ fontSize: 9.5, color: "var(--df-archive-slate)" }}
            >
              {model.subtitle}
            </span>
          ) : null}
        </span>
        <span
          className="df-mono"
          style={{
            fontWeight: 700,
            fontSize: strip ? 15 : 14,
            minWidth: 74,
            textAlign: "right",
            color: model.appearance === "running" ? "var(--df-case-ink)" : "var(--df-archive-slate)",
          }}
        >
          {model.clock}
        </span>
        {model.appearance === "running" ? (
          <>
            {strip ? null : <span style={{ width: 1, height: 20, background: "var(--df-amber)", opacity: 0.4 }} />}
            <PauseIcon />
          </>
        ) : model.appearance === "paused" ? (
          <PlayIcon />
        ) : null}
      </button>
      {commands.stop ? (
        <button type="button" className="df-chip-stop" onClick={onStop} aria-label="Stop Timer" data-testid="v2-timer-stop">
          <StopIcon />
        </button>
      ) : null}
      {/* After Stop, not between Pause and Stop: a click meant for the list stopped a Timer. */}
      {extraTimers > 0 ? (
        <Popover open={timersOpen} onOpenChange={setTimersOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="df-chip-count"
              aria-label={`Show all ${timers.length} Timers`}
              data-testid="v2-timer-count"
            >
              +{extraTimers}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="df-v2 df-timers-popover" data-testid="v2-timers-popover">
            <ul className="df-timers-list">
              {timers.map((timer) => (
                <TimerRow
                  key={timer.id}
                  timer={timer}
                  {...projectNamesOf(timer.crmProjectId)}
                  onPause={async () => {
                    if (await handlePauseTimer(timer.id)) notify.success("Timer paused");
                  }}
                  onResume={async () => {
                    if (await handleResumeTimer(timer.id)) notify.success("Timer resumed");
                  }}
                  onStop={async () => {
                    if (await handleStopTimer(timer.id)) notify.success("Timer stopped");
                  }}
                />
              ))}
            </ul>
            <Button
              variant="outline"
              type="button"
              className="df-btn df-timers-stop-all"
              onClick={async () => {
                if (await handleStopAll()) {
                  setTimersOpen(false);
                  notify.success("Timers stopped");
                }
              }}
            >
              Stop all
            </Button>
          </PopoverContent>
        </Popover>
      ) : null}
      {startDialog}
    </div>
  );
}

type ChipTimer = ReturnType<typeof useTimeTracker>["timers"][number];

/** One Timer in the list: its Project, Task and clock, with its own pause or resume and stop. */
function TimerRow({
  timer,
  projectName,
  clientName,
  onPause,
  onResume,
  onStop,
}: {
  timer: ChipTimer;
  projectName: string;
  clientName: string | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const running = timer.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const { data: tasks } = useQuery<{ data: Task[] }>({
    queryKey: ["/api/tasks", timer.crmProjectId],
    queryFn: () => fetch(`/api/tasks?crmProjectId=${timer.crmProjectId}`).then((r) => r.json()),
  });
  const taskName = tasks?.data?.find((item) => item.id === timer.taskId)?.name ?? null;
  const elapsed =
    (timer.duration || 0) +
    (running && timer.lastActivityAt ? Math.max(0, Math.floor((now - new Date(timer.lastActivityAt).getTime()) / 1000)) : 0);
  return (
    <li className="df-timers-row" data-status={timer.status}>
      {/* The Project on one line and its Task under it: in one line both ended in an ellipsis. */}
      <span className="df-timers-label" title={[clientName, projectName, taskName].filter(Boolean).join(" · ")}>
        <span className="df-timers-name">{projectName}</span>
        <span className="df-timers-task">{taskName ?? clientName ?? "No Task"}</span>
      </span>
      <span className="df-mono df-timers-clock">{formatElapsedClock(elapsed)}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="df-timers-action"
        onClick={running ? onPause : onResume}
        aria-label={`${running ? "Pause" : "Resume"} Timer on ${taskName ?? projectName}`}
      >
        {running ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="df-timers-action"
        onClick={onStop}
        aria-label={`Stop Timer on ${taskName ?? projectName}`}
      >
        <StopIcon />
      </Button>
    </li>
  );
}

function timerLabel(command: "start" | "pause" | "resume" | "stop"): string {
  if (command === "start") return "Start Timer";
  if (command === "pause") return "Pause Timer";
  if (command === "resume") return "Resume Timer";
  return "Stop Timer";
}
