import React, { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatWorkedToday } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

export function WorkedToday() {
  const { state, pauseTimer, resumeTimer } = useAgent();
  const [pauseLoading, setPauseLoading] = useState(false);
  const [stoppedTotal, setStoppedTotal] = useState(0);
  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';

  const isActive = status !== 'stopped' && timer?.entryId != null;
  const liveElapsed = isActive ? (timer?.elapsed ?? 0) : 0;

  // Track entryId changes to carry over elapsed before it resets to 0
  const prevEntryIdRef = useRef<string | null | undefined>(undefined);
  const capturedElapsedRef = useRef(0);

  // Capture current elapsed during render (only when entryId hasn't changed)
  if (prevEntryIdRef.current === (timer?.entryId ?? null)) {
    capturedElapsedRef.current = liveElapsed;
  }

  const total = stoppedTotal + liveElapsed;

  async function refresh() {
    try {
      const result = await window.agentBridge.getWorkedToday();
      // Use Math.max: the daily total can only grow — never let a stale/failed
      // API response overwrite a higher value already accumulated locally.
      if (result.ok) setStoppedTotal(s => Math.max(s, result.total));
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (status === 'stopped') refresh();
  }, [status]);

  // When entry changes while a timer was running, carry over elapsed optimistically
  useEffect(() => {
    const entryId = timer?.entryId ?? null;
    const prev = prevEntryIdRef.current;
    prevEntryIdRef.current = entryId;

    if (prev !== undefined && prev !== null && entryId !== prev) {
      setStoppedTotal(s => s + capturedElapsedRef.current);
      setTimeout(refresh, 2000);
    }
  }, [timer?.entryId]);

  async function handlePauseResume() {
    setPauseLoading(true);
    if (status === 'running') await pauseTimer();
    else await resumeTimer();
    setPauseLoading(false);
  }

  return (
    <div className={`worked-today-bar${isActive ? ' worked-today-bar--active' : ''}`}>
      {isActive && (
        <div className="timer-pause-fab-wrap">
          <button
            className={`timer-pause-fab${status === 'paused' ? ' timer-pause-fab--resume' : ''}`}
            disabled={pauseLoading}
            onClick={handlePauseResume}
            title={status === 'running' ? 'Pause' : 'Resume'}
          >
            {pauseLoading ? '…' : status === 'running' ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="4" y="3" width="4" height="14" rx="1.5"/>
                <rect x="12" y="3" width="4" height="14" rx="1.5"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
                <polygon points="5,2 16,9 5,16"/>
              </svg>
            )}
          </button>
        </div>
      )}
      <div className="worked-today-bar__left">
        {isActive && <StatusBadge status={status} />}
      </div>
      <div className="worked-today-bar__right">
        <span className="worked-today-bar__label">Worked Today:</span>
        <span className="worked-today-bar__value">{formatWorkedToday(total)}</span>
      </div>
    </div>
  );
}
