import React, { useEffect, useRef, useState } from 'react';

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

export function IdlePrompt() {
  const [phase, setPhase] = useState<IdlePhase>(null);
  const [remaining, setRemaining] = useState<number>(60);
  const [total, setTotal] = useState<number>(60);
  const [loading, setLoading] = useState<'break' | 'resume' | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
              onClick={doResume}
              disabled={loading !== null}
            >
              {loading === 'resume' ? '…' : 'Yes, keep tracking'}
            </button>
            <button
              className="idle-btn idle-btn--break"
              onClick={doBreak}
              disabled={loading !== null}
            >
              {loading === 'break' ? '…' : 'Stop — I was on a break'}
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
        <div className="idle-card__stopped-icon" aria-hidden="true">⏹</div>
        <div className="idle-card__title">Timer stopped</div>
        <div className="idle-card__stopped-summary">
          <span className="idle-card__stopped-row">
            Inactive since <strong>{fmtTime(phase.idleStartedAt)}</strong>
          </span>
          <span className="idle-card__stopped-row idle-card__stopped-row--muted">
            {fmtDuration(phase.idleSeconds)} of inactivity was not counted.
          </span>
        </div>
        <div className="idle-card__actions">
          <button
            className="idle-btn idle-btn--resume"
            onClick={() => setPhase(null)}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
