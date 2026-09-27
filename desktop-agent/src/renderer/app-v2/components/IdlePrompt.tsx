/**
 * Idle prompt.
 *
 * The most loaded screen in the product: it is the app telling someone it
 * noticed they stopped. The marigold pill lands on the duration so the sentence
 * is about the clock, not about the person, and the build's "Are you still
 * working?" phrasing is dropped — it asks a question the app already knows the
 * answer to.
 *
 * Two moments (#293): while the Tracking Policy's countdown runs the Timer is
 * still going and the card says when it will pause; once it reaches zero the
 * card says the Timer paused. Idle time is not counted either way.
 *
 * Both button labels are kept exactly as the shipping build has them.
 */

import { useEffect, useRef, useState } from 'react';
import { formatCountdown } from '../../../lib/idleFlow';
import type { IdlePromptPayload } from '../../app/types';
import { useIdleCountdown } from '../../app/components/timer/useIdleCountdown';

function formatIdle(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'less than a minute';
  return m === 1 ? '1 minute' : `${m} minutes`;
}

export function IdlePrompt() {
  const [prompt, setPrompt] = useState<IdlePromptPayload | null>(null);
  const [taskName, setTaskName] = useState<string | null>(null);
  const [loading, setLoading] = useState<'break' | 'resume' | null>(null);
  const loadingRef = useRef<'break' | 'resume' | null>(null);
  loadingRef.current = loading;
  const remaining = useIdleCountdown(prompt?.pausesAt ?? null);

  async function doResume() {
    if (loadingRef.current) return;
    setLoading('resume');
    try { await window.agentBridge.idleResume(); } finally { setLoading(null); }
  }

  async function doBreak() {
    if (loadingRef.current) return;
    setLoading('break');
    try { await window.agentBridge.idleBreak(); } finally { setLoading(null); }
  }

  useEffect(() => {
    const offPrompt = window.agentBridge.onIdlePrompt((payload) => {
      setPrompt(payload);
      setLoading(null);
      void window.agentBridge.timerState().then((t) => setTaskName(t.taskName));
    });
    const offDismiss = window.agentBridge.onIdleDismiss(() => {
      setPrompt(null);
      setLoading(null);
    });
    return () => { offPrompt(); offDismiss(); };
  }, []);

  // Any keypress or click outside the card means "still here" — mirrors the
  // global input hook in the main process, and gives instant feedback.
  const open = prompt != null;
  useEffect(() => {
    if (!open) return;
    function onActivity(e: Event) {
      const target = e.target as Element | null;
      if (target?.closest?.('.v2-idle__card')) return;
      void doResume();
    }
    window.addEventListener('keydown', onActivity, { capture: true });
    window.addEventListener('mousedown', onActivity, { capture: true });
    return () => {
      window.removeEventListener('keydown', onActivity, { capture: true });
      window.removeEventListener('mousedown', onActivity, { capture: true });
    };
  }, [open]);

  if (prompt == null) return null;
  const counting = prompt.pausesAt != null;
  const on = taskName ? <> on {taskName}</> : null;

  return (
    <div className="v2-idle">
      <div className="v2-idle__card">
        <p className="v2-idle__eyebrow">
          {counting ? 'Timer still running' : <><span aria-hidden="true">❚❚</span> Tracking paused</>}
        </p>

        <h2 className="v2-idle__headline">
          No activity for <span className="v2-idle__pill">{formatIdle(prompt.idleSeconds)}</span>
        </h2>

        {counting ? (
          <>
            <p className="v2-idle__countdown" role="timer">
              Pauses in <span className="v2-idle__countdown-value">{formatCountdown(remaining ?? 0)}</span>
            </p>
            <p className="prose v2-idle__body">
              The Timer{on} pauses when this reaches zero. Press any key or click anywhere to carry
              on — the idle time is not counted.
            </p>
          </>
        ) : (
          <p className="prose v2-idle__body">
            The timer paused itself{on}. Press any key or click anywhere to pick it back up.
          </p>
        )}

        <div className="v2-idle__actions">
          <button
            className="v2-btn v2-btn--primary v2-btn--block"
            onClick={(e) => { e.stopPropagation(); void doResume(); }}
            disabled={loading !== null}
          >
            {loading === 'resume' ? '…' : "I'm back"}
          </button>
          <button
            className="v2-btn v2-btn--secondary v2-btn--block"
            onClick={(e) => { e.stopPropagation(); void doBreak(); }}
            disabled={loading !== null}
          >
            {loading === 'break' ? '…' : "I'm not working"}
          </button>
        </div>
      </div>
    </div>
  );
}
