import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { PlayIcon, PauseIcon } from "./icons";
import { timerChipModel } from "./presentation";

export function V2TimerChip({ variant = "chip" }: { variant?: "chip" | "strip" }) {
  const {
    activeEntry,
    displayDuration,
    isRunning,
    isPaused,
    hasActiveEntry,
    projects,
    tasks,
    handlePause,
    handleResume,
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
  });

  function onToggle() {
    if (model.appearance === "running") handlePause();
    else if (model.appearance === "paused") handleResume();
  }

  const strip = variant === "strip";
  if (strip && model.appearance === "idle") return null;

  return (
    <button
      type="button"
      className={strip ? "df-timer-strip" : "df-chip"}
      data-appearance={model.appearance}
      data-testid={strip ? "v2-timer-strip" : "v2-timer-chip"}
      data-amber={model.holdsAmber ? "true" : "false"}
      onClick={onToggle}
      disabled={model.appearance === "idle"}
    >
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
            color: model.appearance === "running" ? "#0F1524" : "#59657A",
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
            style={{ fontSize: 9.5, color: "#59657A", textTransform: "uppercase" }}
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
          color: model.appearance === "running" ? "#0F1524" : "#59657A",
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
  );
}
