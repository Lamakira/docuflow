import React, { useEffect, useRef, useState } from 'react';
import { formatCountdown } from '../../../../lib/idleFlow';
import type { IdlePromptPayload } from '../../types';
import { useIdleCountdown } from './useIdleCountdown';

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'less than a minute';
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/**
 * While the Tracking Policy's countdown runs the Timer is still going and the
 * card says when it pauses; at zero it pauses and the card says so (#293).
 */
export function IdlePrompt() {
  const [prompt, setPrompt] = useState<IdlePromptPayload | null>(null);
  const [loading, setLoading] = useState<'break' | 'resume' | null>(null);
  const loadingRef = useRef<'break' | 'resume' | null>(null);
  loadingRef.current = loading;
  const remaining = useIdleCountdown(prompt?.pausesAt ?? null);

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
    const offPrompt = window.agentBridge.onIdlePrompt((payload) => {
      console.log(`[IdlePrompt] prompt — idleSeconds=${payload.idleSeconds} pausesAt=${payload.pausesAt ?? 'paused'}`);
      setPrompt(payload);
      setLoading(null);
    });
    const offDismiss = window.agentBridge.onIdleDismiss(() => {
      setPrompt(null);
      setLoading(null);
    });
    return () => { offPrompt(); offDismiss(); };
  }, []);

  // Any keyboard input or mouse click outside the modal card = "I'm still working"
  // (mirrors the global-input callback in main, redundant but gives instant feedback)
  const open = prompt !== null;
  useEffect(() => {
    if (!open) return;

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
  }, [open]);

  if (prompt === null) return null;
  const counting = prompt.pausesAt != null;

  return (
    <div className="idle-overlay">
      <div className="idle-card idle-card--warning">
        <div className="idle-card__pause-icon" aria-hidden="true">{counting ? '⏱' : '⏸'}</div>
        <div className="idle-card__title">{counting ? 'Are you still working?' : 'Tracking paused'}</div>

        {counting ? (
          <>
            <div className="idle-card__body">
              No activity for <strong>{fmtDuration(prompt.idleSeconds)}</strong> — the timer pauses in{' '}
              <strong className="idle-card__countdown" role="timer">{formatCountdown(remaining ?? 0)}</strong>.
            </div>
            <div className="idle-card__instruction">
              Press any key or click to carry on. Idle time is not counted.
            </div>
          </>
        ) : (
          <>
            <div className="idle-card__body">
              No activity for <strong>{fmtDuration(prompt.idleSeconds)}</strong> — timer paused automatically.
            </div>
            <div className="idle-card__instruction">
              Press any key or click to resume.
            </div>
          </>
        )}

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
