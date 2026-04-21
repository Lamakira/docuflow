import { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    widgetBridge: {
      getState: () => Promise<any>;
      timerPause: () => Promise<any>;
      timerResume: () => Promise<any>;
      dismiss: () => Promise<void>;
      openMain: () => Promise<void>;
      moveWindow: (x: number, y: number) => void;
      getWindowPos: () => Promise<[number, number]>;
      onStateUpdate: (cb: (state: any) => void) => void;
    };
  }
}

interface TimerState {
  status: "stopped" | "running" | "paused";
  elapsed: number;
  elapsedToday: number;
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

const DRAG_THRESHOLD = 4; // px — below this = click, above = drag

function Widget() {
  const [timer, setTimer] = useState<TimerState>({
    status: "stopped",
    elapsed: 0,
    elapsedToday: 0,
    taskName: null,
    projectName: null,
  });
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const syncRef = useRef<{ elapsed: number; at: number } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Custom drag state — no WebkitAppRegion used anywhere
  const mouseDownRef = useRef<{
    mouseX: number;
    mouseY: number;
    winX: number;
    winY: number;
    resolved: boolean;
  } | null>(null);
  const hasDraggedRef = useRef(false);

  function applyState(raw: any) {
    const t = raw.timer ?? raw;
    const todayElapsed = t.elapsedToday ?? t.elapsed ?? 0;
    setTimer({
      status: t.status,
      elapsed: t.elapsed ?? 0,
      elapsedToday: todayElapsed,
      taskName: t.taskName ?? null,
      projectName: t.projectName ?? null,
    });
    syncRef.current = { elapsed: todayElapsed, at: Date.now() };
    setDisplayElapsed(todayElapsed);
  }

  useEffect(() => {
    window.widgetBridge.getState().then(applyState);
    window.widgetBridge.onStateUpdate(applyState);
  }, []);

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

  // Global drag handlers — mounted once, use refs so they never go stale
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const info = mouseDownRef.current;
      if (!info || !info.resolved || e.buttons !== 1) return;
      const dx = e.screenX - info.mouseX;
      const dy = e.screenY - info.mouseY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        hasDraggedRef.current = true;
        window.widgetBridge.moveWindow(info.winX + dx, info.winY + dy);
      }
    }
    function onMouseUp() {
      const info = mouseDownRef.current;
      mouseDownRef.current = null;
      // If mouse was pressed and released without dragging → treat as click → open main
      if (info && !hasDraggedRef.current) {
        void window.widgetBridge.openMain();
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  if (timer.status === "stopped") return null;

  const isRunning = timer.status === "running";
  const label = timer.taskName || timer.projectName || "Tracking…";
  const sub = timer.taskName && timer.projectName ? timer.projectName : null;

  function showError(msg: string) {
    setActionError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setActionError(null), 3000);
  }

  // Start drag tracking — fetch window position async; click detection works even
  // if position isn't resolved yet (mouseup before resolution = treated as click)
  async function handleCardMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    hasDraggedRef.current = false;
    // Mark as pending (resolved=false) so mousemove skips until position is ready
    mouseDownRef.current = { mouseX: e.screenX, mouseY: e.screenY, winX: 0, winY: 0, resolved: false };
    const pos = await window.widgetBridge.getWindowPos();
    if (mouseDownRef.current) {
      mouseDownRef.current.winX = pos[0];
      mouseDownRef.current.winY = pos[1];
      mouseDownRef.current.resolved = true;
    }
  }

  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    try {
      const result = isRunning
        ? await window.widgetBridge.timerPause()
        : await window.widgetBridge.timerResume();
      if (result && !result.ok && result.error) showError(result.error);
    } finally {
      setPending(false);
    }
  }

  async function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    await window.widgetBridge.dismiss();
  }

  // Buttons stop mousedown propagation so card drag never starts from a button press
  function stopDragStart(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div style={{ position: "relative", height: "100%" }}>
      {/* Error tooltip */}
      {actionError && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(239,68,68,0.95)",
          color: "#fff",
          fontSize: 10,
          fontWeight: 500,
          padding: "3px 8px",
          borderRadius: 5,
          whiteSpace: "nowrap",
          pointerEvents: "none",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          zIndex: 9999,
        }}>
          {actionError}
        </div>
      )}

      {/* Strip — draggable from any non-button surface, click opens main window */}
      <div
        onMouseDown={handleCardMouseDown}
        style={{
          display: "flex",
          alignItems: "center",
          height: "100%",
          background: "rgba(13, 20, 36, 0.97)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          paddingLeft: 10,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          userSelect: "none",
          boxShadow: "0 4px 18px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.3)",
          cursor: "move",
          overflow: "hidden",
        }}
      >
        {/* Status dot */}
        <div style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          background: isRunning ? "#22c55e" : "#f59e0b",
          boxShadow: isRunning ? "0 0 5px #22c55e99" : "0 0 5px #f59e0b99",
          transition: "background 0.3s, box-shadow 0.3s",
        }} />

        {/* Task / project name */}
        <div style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#f1f5f9",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.25,
          }}>
            {label}
          </div>
          {sub && (
            <div style={{
              fontSize: 9.5,
              color: "#475569",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.2,
              marginTop: 1,
            }}>
              {sub}
            </div>
          )}
        </div>

        {/* Elapsed time */}
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#e2e8f0",
          letterSpacing: "0.06em",
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
          marginLeft: 10,
          marginRight: 8,
        }}>
          {formatTime(displayElapsed)}
        </div>

        {/* Pause / Resume — stopPropagation on mousedown prevents drag from starting */}
        <button
          onMouseDown={stopDragStart}
          onClick={handleToggle}
          disabled={pending}
          title={isRunning ? "Pause" : "Resume"}
          style={{
            flexShrink: 0,
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isRunning ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
            border: `1px solid ${isRunning ? "rgba(239,68,68,0.28)" : "rgba(34,197,94,0.28)"}`,
            borderRadius: 6,
            cursor: pending ? "wait" : "pointer",
            color: isRunning ? "#f87171" : "#4ade80",
            fontSize: 9,
            transition: "background 0.2s, border-color 0.2s",
            opacity: pending ? 0.6 : 1,
            padding: 0,
          }}
        >
          {isRunning ? "⏸" : "▶"}
        </button>

        {/* Dismiss — stopPropagation on mousedown prevents drag from starting */}
        <button
          onMouseDown={stopDragStart}
          onClick={handleDismiss}
          title="Hide widget (tracking continues)"
          style={{
            flexShrink: 0,
            width: 14,
            height: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderRadius: 3,
            cursor: "pointer",
            color: "rgba(255,255,255,0.22)",
            fontSize: 8,
            lineHeight: 1,
            marginLeft: 6,
            marginRight: 8,
            padding: 0,
            transition: "color 0.2s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.6)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.22)";
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById("widget-root");
if (root) {
  createRoot(root).render(<Widget />);
}
