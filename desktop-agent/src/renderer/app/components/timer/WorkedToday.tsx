import React, { useEffect, useState } from 'react';
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
