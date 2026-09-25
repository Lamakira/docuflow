import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { PlayIcon, PauseIcon, StopIcon } from "./icons";
import { timerChipCommands } from "./chrome";
import { timerChipModel } from "./presentation";

export function V2TimerChip({
  variant = "chip",
  workspaceLabel = null,
  onToast,
}: {
  variant?: "chip" | "strip";
  workspaceLabel?: string | null;
  onToast?: (message: string) => void;
}) {
  const {
    activeEntry,
    displayDuration,
    isRunning,
    isPaused,
    hasActiveEntry,
    projects,
    tasks,
    selectedProjectId,
    taskStartBlockedReason,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
  } = useTimeTracker();

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
    displayDuration,
    projectLabel,
    taskLabel: task?.name ?? null,
    workspaceLabel,
  });
  const commands = timerChipCommands(model.appearance);

  function onPrimary() {
    if (commands.primary === "pause") {
      handlePause();
      onToast?.("Timer paused");
      return;
    }
    if (commands.primary === "resume") {
      handleResume();
      onToast?.("Timer resumed");
      return;
    }
    if (taskStartBlockedReason === "no_project" || !selectedProjectId) {
      onToast?.("Choose a Project before starting the Timer.");
      return;
    }
    if (taskStartBlockedReason === "no_tasks") {
      onToast?.("Create a Task before starting the Timer.");
      return;
    }
    if (taskStartBlockedReason === "no_task_selected" || taskStartBlockedReason === "loading") {
      onToast?.("Choose a Task before starting the Timer.");
      return;
    }
    handleStart();
    onToast?.("Timer started");
  }

  function onStop() {
    handleStop();
    onToast?.("Timer stopped");
  }

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
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, minWidth: 0, flex: strip ? 1 : undefined }}>
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
              style={{ fontSize: 9.5, color: "var(--df-archive-slate)", textTransform: "uppercase" }}
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
    </div>
  );
}

function timerLabel(command: "start" | "pause" | "resume" | "stop"): string {
  if (command === "start") return "Start Timer";
  if (command === "pause") return "Pause Timer";
  if (command === "resume") return "Resume Timer";
  return "Stop Timer";
}
