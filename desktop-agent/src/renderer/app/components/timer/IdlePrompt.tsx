import React, { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';

type IdlePhase = { kind: 'warning'; idleSeconds: number } | null;

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'less than a minute';
  return m === 1 ? '1 minute' : `${m} minutes`;
}

export function IdlePrompt() {
  const { state, startTimer } = useAgent();
  const [phase, setPhase] = useState<IdlePhase>(null);
  const [loading, setLoading] = useState<'break' | 'resume' | null>(null);
  const loadingRef = useRef<'break' | 'resume' | null>(null);
  loadingRef.current = loading;

  async function doResume() {
    if (loadingRef.current !== null) return;
    setLoading('resume');
    try {
      await window.agentBridge.idleResume();
    } finally {
      setLoading(null);
    }
  }

  async function doBreak() {
    if (loadingRef.current !== null) return;
    setLoading('break');
    try {
      await window.agentBridge.idleBreak();
    } finally {
      setLoading(null);
    }
  }

  // IPC events from main process
  useEffect(() => {
    const offPrompt = window.agentBridge.onIdlePrompt(({ idleSeconds }) => {
      console.log(`[IdlePrompt] prompt — idleSeconds=${idleSeconds}`);
      setPhase({ kind: 'warning', idleSeconds });
      setLoading(null);
    });
    const offDismiss = window.agentBridge.onIdleDismiss(() => {
      setPhase(null);
      setLoading(null);
    });
    return () => { offPrompt(); offDismiss(); };
  }, []);

  // Any keyboard input or mouse click outside the modal card = "I'm still working"
  // (mirrors the global-input callback in main, redundant but gives instant feedback)
  useEffect(() => {
    if (phase?.kind !== 'warning') return;

    function onUserActivity(e: Event) {
      const target = e.target as Element | null;
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

  return (
    <div className="idle-overlay">
      <div className="idle-card idle-card--warning">
        <div className="idle-card__pause-icon" aria-hidden="true">⏸</div>
        <div className="idle-card__title">Tracking paused</div>

        <div className="idle-card__body">
          No activity for <strong>{fmtDuration(phase.idleSeconds)}</strong> — timer paused automatically.
        </div>

        <div className="idle-card__instruction">
          Press any key or click to resume.
        </div>

        <div className="idle-card__actions">
          <button
            className="idle-btn idle-btn--resume"
            onClick={(e) => { e.stopPropagation(); doResume(); }}
            disabled={loading !== null}
          >
            {loading === 'resume' ? '…' : "I'm back"}
          </button>
          <button
            className="idle-btn idle-btn--break"
            onClick={(e) => { e.stopPropagation(); doBreak(); }}
            disabled={loading !== null}
          >
            {loading === 'break' ? '…' : "I'm not working"}
          </button>
        </div>
      </div>
    </div>
  );
}
