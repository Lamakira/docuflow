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

/** Arc SVG countdown ring — r=36, so circumference ≈ 226 */
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

  useEffect(() => {
    const offPrompt = window.agentBridge.onIdlePrompt(({ idleSeconds, countdownSeconds }) => {
      console.log(`[IdlePrompt] prompt received — idleSeconds=${idleSeconds} countdownSeconds=${countdownSeconds}`);
      setPhase({ kind: 'warning', idleSeconds });
      setLoading(null);
      startCountdown(countdownSeconds ?? 60);
    });
    const offStopped = window.agentBridge.onIdleStopped(({ idleSeconds, idleStartedAt }) => {
      console.log(`[IdlePrompt] stopped received — idleSeconds=${idleSeconds} idleStartedAt=${idleStartedAt}`);
      stopCountdown();
      setPhase({ kind: 'stopped', idleSeconds, idleStartedAt });
    });
    const offDismiss = window.agentBridge.onIdleDismiss(() => {
      setPhase(null);
      setLoading(null);
      stopCountdown();
    });
    return () => {
      offPrompt();
      offStopped();
      offDismiss();
      stopCountdown();
    };
  }, []);

  if (phase === null) return null;

  // ── Warning phase ─────────────────────────────────────────────────────────────
  if (phase.kind === 'warning') {
    async function handleBreak() {
      setLoading('break');
      stopCountdown();
      await window.agentBridge.idleBreak();
    }
    async function handleResume() {
      setLoading('resume');
      stopCountdown();
      await window.agentBridge.idleResume();
    }

    return (
      <div className="idle-overlay">
        <div className="idle-card idle-card--warning">
          <div className="idle-card__title">Are you still working?</div>
          <div className="idle-card__subtitle">
            No activity for <strong>{fmtDuration(phase.idleSeconds)}</strong>.
            Your timer is still running.
          </div>

          <CountdownRing remaining={remaining} total={total} />

          <div className="idle-card__hint">
            Timer stops automatically when the countdown reaches zero.
          </div>

          <div className="idle-card__actions">
            <button
              className="idle-btn idle-btn--resume"
              onClick={handleResume}
              disabled={loading !== null}
            >
              {loading === 'resume' ? '…' : 'Yes, keep tracking'}
            </button>
            <button
              className="idle-btn idle-btn--break"
              onClick={handleBreak}
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
