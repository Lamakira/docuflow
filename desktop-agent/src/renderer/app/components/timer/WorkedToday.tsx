import React, { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatTime } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { TimerControls } from './TimerControls';

export function WorkedToday() {
  const { state } = useAgent();
  const [stoppedTotal, setStoppedTotal] = useState(0);
  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';

  const liveElapsed = status !== 'stopped' ? (timer?.elapsed ?? 0) : 0;

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
      if (result.ok) setStoppedTotal(result.total);
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

  return (
    <div className="worked-today-bar">
      <div className="worked-today-bar__left">
        {status !== 'stopped' && <StatusBadge status={status} />}
      </div>
      <div className="worked-today-bar__right">
        <span className="worked-today-bar__label">Worked Today</span>
        <span className="worked-today-bar__value">{formatTime(total)}</span>
        {status !== 'stopped' && <TimerControls compact />}
      </div>
    </div>
  );
}
