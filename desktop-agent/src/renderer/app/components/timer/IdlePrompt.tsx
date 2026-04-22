import React, { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';

type IdlePhase =
  | { kind: 'warning'; idleSeconds: number }
  | { kind: 'stopped'; idleSeconds: number; idleStartedAt: string }
  | null;

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'less than a minute';
  return m === 1 ? '1 minute' : `${m} minutes`;
}

function fmtTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Arc SVG countdown ring — r=36, circumference ≈ 226 */
function CountdownRing({ remaining, total }: { remaining: number; total: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const progress = total > 0 ? remaining / total : 0;
  const dash = circ * progress;
  const urgent = remaining <= 10;
  const color = urgent ? '#f87171' : '#6366f1';
  return (
    <svg className="idle-ring" viewBox="0 0 88 88" aria-hidden="true">
      <circle cx="44" cy="44" r={r} className="idle-ring__track" />
      <circle
        cx="44" cy="44" r={r}
        className="idle-ring__fill"
        stroke={color}
        strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset="0"
        transform="rotate(-90 44 44)"
      />
      <text x="44" y="44" className={`idle-ring__label${urgent ? ' idle-ring__label--urgent' : ''}`} style={{ fill: color }}>
        {remaining}s
      </text>
    </svg>
  );
}

function fmtAgo(seconds: number): string {
  if (seconds < 60) return 'just now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return m === 1 ? '1 min ago' : `${m} min ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0
    ? (h === 1 ? '1 hr ago' : `${h} hr ago`)
    : `${h}h ${rem}m ago`;
}

export function IdlePrompt() {
  const { state, startTimer } = useAgent();
  const [phase, setPhase] = useState<IdlePhase>(null);
  const [remaining, setRemaining] = useState<number>(60);
  const [total, setTotal] = useState<number>(60);
  const [loading, setLoading] = useState<'break' | 'resume' | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [stoppedAgoSeconds, setStoppedAgoSeconds] = useState(0);
  const deadlineRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedAtRef = useRef<number | null>(null);
  const stoppedTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirror loading in a ref so the input-listener closure always sees the current value
  const loadingRef = useRef<'break' | 'resume' | null>(null);
  loadingRef.current = loading;

  function startCountdown(countdownSeconds: number) {
    const deadline = Date.now() + countdownSeconds * 1000;
    deadlineRef.current = deadline;
    setTotal(countdownSeconds);
    setRemaining(countdownSeconds);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const secs = Math.max(0, Math.ceil((deadlineRef.current! - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0) {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      }
    }, 500);
  }

  function stopCountdown() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    deadlineRef.current = null;
  }

  // Lifted to component level so the input-listener useEffect can reference them stably
  async function doResume() {
    if (loadingRef.current !== null) return;
    setLoading('resume');
    stopCountdown();
    await window.agentBridge.idleResume();
  }

  async function doBreak() {
    if (loadingRef.current !== null) return;
    setLoading('break');
    stopCountdown();
    await window.agentBridge.idleBreak();
  }

  async function doStoppedResume() {
    if (resumeLoading) return;
    const recent = state.recentTasks[0];
    if (!recent) { setPhase(null); return; }
    setResumeLoading(true);
    await startTimer({
      crmProjectId: recent.crmProjectId,
      taskId: recent.taskId ?? undefined,
      taskName: recent.taskName ?? undefined,
      projectName: recent.projectName,
      description: recent.description ?? undefined,
    });
    setResumeLoading(false);
    setPhase(null);
  }

  // IPC events from main process
  useEffect(() => {
    const offPrompt = window.agentBridge.onIdlePrompt(({ idleSeconds, countdownSeconds }) => {
      console.log(`[IdlePrompt] prompt — idleSeconds=${idleSeconds} countdownSeconds=${countdownSeconds}`);
      setPhase({ kind: 'warning', idleSeconds });
      setLoading(null);
      startCountdown(countdownSeconds ?? 60);
    });
    const offStopped = window.agentBridge.onIdleStopped(({ idleSeconds, idleStartedAt }) => {
      console.log(`[IdlePrompt] stopped — idleSeconds=${idleSeconds} idleStartedAt=${idleStartedAt}`);
      stopCountdown();
      setPhase({ kind: 'stopped', idleSeconds, idleStartedAt });
    });
    const offDismiss = window.agentBridge.onIdleDismiss(() => {
      setPhase(null);
      setLoading(null);
      stopCountdown();
    });
    return () => { offPrompt(); offStopped(); offDismiss(); stopCountdown(); };
  }, []);

  // Live "Stopped X min ago" ticker — anchored to idleStartedAt (when tracking retroactively stopped),
  // NOT to when the modal appeared. Without this anchor the initial value is always "just now"
  // even if the user comes back 15 minutes after tracking stopped.
  useEffect(() => {
    if (phase?.kind !== 'stopped') {
      if (stoppedTickRef.current) { clearInterval(stoppedTickRef.current); stoppedTickRef.current = null; }
      stoppedAtRef.current = null;
      return;
    }
    const epoch = new Date(phase.idleStartedAt).getTime();
    stoppedAtRef.current = epoch;
    setStoppedAgoSeconds(Math.floor((Date.now() - epoch) / 1000));
    stoppedTickRef.current = setInterval(() => {
      if (stoppedAtRef.current !== null) {
        setStoppedAgoSeconds(Math.floor((Date.now() - stoppedAtRef.current) / 1000));
      }
    }, 1000);
    return () => {
      if (stoppedTickRef.current) { clearInterval(stoppedTickRef.current); stoppedTickRef.current = null; }
    };
  }, [phase?.kind]);

  // Any keyboard input or mouse click outside the modal card = "I'm still working"
  useEffect(() => {
    if (phase?.kind !== 'warning') return;

    function onUserActivity(e: Event) {
      const target = e.target as Element | null;
      // Clicks inside the card use the explicit buttons — don't double-fire
      if (target?.closest?.('.idle-card')) return;
      doResume();
    }

    window.addEventListener('keydown', onUserActivity, { capture: true });
    window.addEventListener('mousedown', onUserActivity, { capture: true });
    return () => {
      window.removeEventListener('keydown', onUserActivity, { capture: true });
      window.removeEventListener('mousedown', onUserActivity, { capture: true });
    };
  }, [phase?.kind]);

  if (phase === null) return null;

  // ── Warning phase ─────────────────────────────────────────────────────────────
  if (phase.kind === 'warning') {
    return (
      <div className="idle-overlay">
        <div className="idle-card idle-card--warning">
          <div className="idle-card__title">Are you still working?</div>

          {/* Instruction — tells user what to do to stay tracked */}
          <div className="idle-card__instruction">
            Clicking or typing anywhere means you are working.
          </div>

          <CountdownRing remaining={remaining} total={total} />

          {/* Context — moved below ring, less dominant */}
          <div className="idle-card__idle-note">
            No activity for <strong>{fmtDuration(phase.idleSeconds)}</strong> — timer still running.
          </div>

          <div className="idle-card__actions">
            <button
              className="idle-btn idle-btn--resume"
              onClick={(e) => { e.stopPropagation(); doResume(); }}
              disabled={loading !== null}
            >
              {loading === 'resume' ? '…' : 'Yes, keep tracking'}
            </button>
            <button
              className="idle-btn idle-btn--break"
              onClick={(e) => { e.stopPropagation(); doBreak(); }}
              disabled={loading !== null}
            >
              {loading === 'break' ? '…' : 'No, I\'m not working'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Stopped confirmation phase ────────────────────────────────────────────────
  return (
    <div className="idle-overlay">
      <div className="idle-card idle-card--stopped">
        <div className="idle-card__stopped-icon" aria-hidden="true">⏸</div>
        <div className="idle-card__title">Tracking paused</div>

        {/* Layer A — live: how long ago tracking stopped (updates every second) */}
        <div className="idle-card__stopped-headline">
          Stopped {fmtAgo(stoppedAgoSeconds)}
        </div>

        {/* Layer B — historical: when it happened and how much was excluded */}
        <div className="idle-card__stopped-facts">
          <div>
            Inactive since <strong>{fmtTime(phase.idleStartedAt)}</strong>
          </div>
          <div className="idle-card__stopped-facts--muted">
            {fmtDuration(phase.idleSeconds)} of idle time excluded
          </div>
        </div>

        <div className="idle-card__actions">
          {state.recentTasks.length > 0 ? (
            <>
              <button
                className="idle-btn idle-btn--resume-strong"
                onClick={doStoppedResume}
                disabled={resumeLoading}
              >
                {resumeLoading ? '…' : 'Resume tracking'}
              </button>
              <button
                className="idle-btn idle-btn--ghost"
                onClick={() => setPhase(null)}
                disabled={resumeLoading}
              >
                Got it
              </button>
            </>
          ) : (
            <button
              className="idle-btn idle-btn--break"
              onClick={() => setPhase(null)}
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
