/**
 * Floating activity bar — v2.
 *
 * Behaviour is carried over from the shipping widget unchanged: the nine-dot
 * grip is the only drag initiator, every other region opens the main window,
 * the dismiss button hides the bar while tracking continues, and the local tick
 * interpolates between state pushes so the readout never stalls.
 *
 * Only the presentation is new.
 */

import { useEffect, useRef, useState } from 'react';
import { PlayIcon, PauseIcon, XMarkIcon } from './icons';
import './styles/widget.css';

interface WidgetTimer {
  status: 'stopped' | 'running' | 'paused';
  elapsed: number;
  elapsedToday: number;
  taskName: string | null;
  projectName: string | null;
}

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

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Below this a press is a click, above it a drag. */
const DRAG_THRESHOLD = 4;

export function Widget() {
  const [timer, setTimer] = useState<WidgetTimer>({
    status: 'stopped', elapsed: 0, elapsedToday: 0, taskName: null, projectName: null,
  });
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const syncRef = useRef<{ elapsed: number; at: number } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseDownRef = useRef<{ mouseX: number; mouseY: number; winX: number; winY: number; resolved: boolean } | null>(null);
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
    if (timer.status === 'running' && syncRef.current) {
      tickRef.current = setInterval(() => {
        if (!syncRef.current) return;
        const delta = Math.floor((Date.now() - syncRef.current.at) / 1000);
        setDisplayElapsed(syncRef.current.elapsed + delta);
      }, 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [timer.status, timer.elapsed]);

  // Mounted once; reads through refs so the handlers never go stale.
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
      if (info && !hasDraggedRef.current) void window.widgetBridge.openMain();
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  if (timer.status === 'stopped') return null;

  const isRunning = timer.status === 'running';
  const label = timer.taskName || timer.projectName || 'Tracking…';
  const sub = isRunning
    ? (timer.taskName && timer.projectName ? timer.projectName : null)
    : ['Paused', timer.taskName ? timer.projectName : null].filter(Boolean).join(' · ');

  function showError(msg: string) {
    setActionError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setActionError(null), 3000);
  }

  async function handleGripMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    hasDraggedRef.current = false;
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

  const openMain = () => void window.widgetBridge.openMain();

  return (
    <div className="w2__stage">
      {actionError && <div className="w2__error">{actionError}</div>}

      <div className={`w2${isRunning ? '' : ' w2--paused'}`}>
        <div className="w2__grip" onMouseDown={handleGripMouseDown} title="Drag to move">
          {Array.from({ length: 9 }).map((_, i) => <i key={i} />)}
        </div>

        <span className="w2__dot" onClick={openMain} />

        <div className="w2__label" onClick={openMain}>
          <div className="w2__task">{label}</div>
          {sub && <div className="w2__sub">{sub}</div>}
        </div>

        <span className="w2__time" onClick={openMain}>{formatTime(displayElapsed)}</span>

        <button
          className="w2__toggle"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleToggle}
          disabled={pending}
          title={isRunning ? 'Pause' : 'Resume'}
        >
          {isRunning ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
        </button>

        <button
          className="w2__dismiss"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); void window.widgetBridge.dismiss(); }}
          title="Hide widget (tracking continues)"
          aria-label="Hide widget"
        >
          <XMarkIcon size={10} />
        </button>
      </div>
    </div>
  );
}
