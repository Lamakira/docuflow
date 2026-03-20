import { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    widgetBridge: {
      getState: () => Promise<any>;
      timerPause: () => Promise<any>;
      timerResume: () => Promise<any>;
      onStateUpdate: (cb: (state: any) => void) => void;
    };
  }
}

interface TimerState {
  status: "stopped" | "running" | "paused";
  elapsed: number;
  taskName: string | null;
  projectName: string | null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Widget() {
  const [timer, setTimer] = useState<TimerState>({
    status: "stopped",
    elapsed: 0,
    taskName: null,
    projectName: null,
  });
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const syncRef = useRef<{ elapsed: number; at: number } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pending, setPending] = useState(false);

  function applyState(raw: any) {
    const t = raw.timer ?? raw;
    setTimer({
      status: t.status,
      elapsed: t.elapsed ?? 0,
      taskName: t.taskName ?? null,
      projectName: t.projectName ?? null,
    });
    syncRef.current = { elapsed: t.elapsed ?? 0, at: Date.now() };
    setDisplayElapsed(t.elapsed ?? 0);
  }

  useEffect(() => {
    window.widgetBridge.getState().then(applyState);
    window.widgetBridge.onStateUpdate(applyState);
  }, []);

  // Local tick when running
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (timer.status === "running" && syncRef.current) {
      tickRef.current = setInterval(() => {
        if (!syncRef.current) return;
        const delta = Math.floor((Date.now() - syncRef.current.at) / 1000);
        setDisplayElapsed(syncRef.current.elapsed + delta);
      }, 1000);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [timer.status, timer.elapsed]);

  if (timer.status === "stopped") return null;

  const isRunning = timer.status === "running";

  async function handleToggle() {
    if (pending) return;
    setPending(true);
    try {
      if (isRunning) {
        await window.widgetBridge.timerPause();
      } else {
        await window.widgetBridge.timerResume();
      }
    } finally {
      setPending(false);
    }
  }

  const label = timer.taskName || timer.projectName || "Tracking…";
  const sub = timer.taskName && timer.projectName ? timer.projectName : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "rgba(15, 23, 42, 0.96)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 14,
        padding: "10px 14px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        WebkitAppRegion: "drag",
        userSelect: "none",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
        cursor: "move",
        height: "100%",
      } as React.CSSProperties}
    >
      {/* Status dot */}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          background: isRunning ? "#22c55e" : "#f59e0b",
          boxShadow: isRunning ? "0 0 8px #22c55e88" : "0 0 8px #f59e0b88",
          transition: "background 0.3s, box-shadow 0.3s",
        }}
      />

      {/* Task / project name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#f8fafc",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.3,
          }}
        >
          {label}
        </div>
        {sub && (
          <div
            style={{
              fontSize: 10,
              color: "#64748b",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.3,
              marginTop: 1,
            }}
          >
            {sub}
          </div>
        )}
      </div>

      {/* Elapsed time */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#f8fafc",
          letterSpacing: "0.04em",
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {formatTime(displayElapsed)}
      </div>

      {/* Pause / Resume button */}
      <button
        onClick={handleToggle}
        disabled={pending}
        style={{
          WebkitAppRegion: "no-drag",
          flexShrink: 0,
          width: 30,
          height: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isRunning ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
          border: `1px solid ${isRunning ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)"}`,
          borderRadius: 8,
          cursor: pending ? "wait" : "pointer",
          color: isRunning ? "#ef4444" : "#22c55e",
          fontSize: 13,
          transition: "background 0.2s, border-color 0.2s",
          opacity: pending ? 0.6 : 1,
        } as React.CSSProperties}
      >
        {isRunning ? "⏸" : "▶"}
      </button>
    </div>
  );
}

const root = document.getElementById("widget-root");
if (root) {
  createRoot(root).render(<Widget />);
}
