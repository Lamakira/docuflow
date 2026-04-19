import React, { useEffect, useRef, useState } from 'react';

function fmtIdle(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

export function IdlePrompt() {
  const [idleSeconds, setIdleSeconds] = useState<number | null>(null);
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
      setIdleSeconds(idleSeconds);
      setLoading(null);
      startCountdown(countdownSeconds ?? 60);
    });
    const offDismiss = window.agentBridge.onIdleDismiss(() => {
      setIdleSeconds(null);
      setLoading(null);
      stopCountdown();
    });
    return () => {
      offPrompt();
      offDismiss();
      stopCountdown();
    };
  }, []);

  if (idleSeconds === null) return null;

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
        <div className="idle-card__title">It looks like you were away</div>
        <div className="idle-card__idle-time">
          Idle for <strong>{fmtIdle(idleSeconds)}</strong>
        </div>
        <div className={`idle-card__countdown${urgent ? ' idle-card__countdown--urgent' : ''}`}>
          Timer stops in <strong>{remaining}s</strong>
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
