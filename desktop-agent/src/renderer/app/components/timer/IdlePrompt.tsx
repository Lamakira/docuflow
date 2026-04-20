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

export function IdlePrompt() {
  const [phase, setPhase] = useState<IdlePhase>(null);
  const [remaining, setRemaining] = useState<number>(60);
  const [loading, setLoading] = useState<'break' | 'resume' | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCountdown(countdownSeconds: number) {
    const deadline = Date.now() + countdownSeconds * 1000;
    deadlineRef.current = deadline;
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

    const urgent = remaining <= 10;

    return (
      <div className="idle-overlay">
        <div className="idle-card">
          <div className="idle-card__title">Are you still there?</div>
          <div className="idle-card__idle-time">
            No activity for <strong>{fmtDuration(phase.idleSeconds)}</strong>
          </div>
          <div className="idle-card__running-notice">
            Your timer is still running.
          </div>
          <div className={`idle-card__countdown${urgent ? ' idle-card__countdown--urgent' : ''}`}>
            Stops automatically in <strong>{remaining}s</strong>
          </div>
          <div className="idle-card__actions">
            <button
              className="idle-btn idle-btn--break"
              onClick={handleBreak}
              disabled={loading !== null}
            >
              {loading === 'break' ? '…' : "I'm on break"}
            </button>
            <button
              className="idle-btn idle-btn--resume"
              onClick={handleResume}
              disabled={loading !== null}
            >
              {loading === 'resume' ? '…' : 'Back to work'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Stopped confirmation phase ────────────────────────────────────────────────
  return (
    <div className="idle-overlay">
      <div className="idle-card">
        <div className="idle-card__title">Timer stopped</div>
        <div className="idle-card__idle-time">
          You were away for <strong>{fmtDuration(phase.idleSeconds)}</strong>.
        </div>
        <div className="idle-card__stopped-detail">
          Inactive since <strong>{fmtTime(phase.idleStartedAt)}</strong> — this time was not counted.
        </div>
        <div className="idle-card__actions idle-card__actions--single">
          <button
            className="idle-btn idle-btn--resume"
            onClick={() => setPhase(null)}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
