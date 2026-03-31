import React, { useEffect, useState } from 'react';

function fmtIdle(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

export function IdlePrompt() {
  const [idleSeconds, setIdleSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState<'break' | 'resume' | null>(null);

  useEffect(() => {
    const offPrompt = window.agentBridge.onIdlePrompt(({ idleSeconds }) => {
      setIdleSeconds(idleSeconds);
      setLoading(null);
    });
    const offDismiss = window.agentBridge.onIdleDismiss(() => {
      setIdleSeconds(null);
      setLoading(null);
    });
    return () => { offPrompt(); offDismiss(); };
  }, []);

  if (idleSeconds === null) return null;

  async function handleBreak() {
    setLoading('break');
    await window.agentBridge.idleBreak();
  }

  async function handleResume() {
    setLoading('resume');
    await window.agentBridge.idleResume();
  }

  return (
    <div className="idle-overlay">
      <div className="idle-card">
        <div className="idle-card__title">It looks like you were away</div>
        <div className="idle-card__idle-time">
          Idle for <strong>{fmtIdle(idleSeconds)}</strong> — timer paused automatically
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
