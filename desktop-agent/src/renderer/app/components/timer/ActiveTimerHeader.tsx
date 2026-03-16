import React, { useEffect, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatTime } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { TimerControls } from './TimerControls';

export function ActiveTimerHeader() {
  const { state } = useAgent();
  const [stoppedTotal, setStoppedTotal] = useState(0);
  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';

  // stoppedTotal = server-confirmed stopped entries
  // liveElapsed = current running/paused entry (from local tick)
  const liveElapsed = status !== 'stopped' ? (timer?.elapsed ?? 0) : 0;
  const workedToday = stoppedTotal + liveElapsed;

  async function refreshTotal() {
    try {
      const result = await window.agentBridge.getWorkedToday();
      if (result.ok) setStoppedTotal(result.total);
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    refreshTotal();
    const id = setInterval(refreshTotal, 60_000);
    return () => clearInterval(id);
  }, []);

  // When timer stops, refresh to pick up the just-completed entry
  useEffect(() => {
    if (status === 'stopped') refreshTotal();
  }, [status]);

  return (
    <div className="timer-header">
      {status !== 'stopped' && (
        <div className="timer-header__info">
          <div className="timer-header__project">{timer?.projectName ?? '—'}</div>
          {timer?.taskName && (
            <div className="timer-header__task">↳ {timer.taskName}</div>
          )}
        </div>
      )}
      <div className="timer-header__right">
        {status !== 'stopped' && (
          <span className={`timer-header__elapsed timer-header__elapsed--${status}`}>
            {formatTime(timer?.elapsed ?? 0)}
          </span>
        )}
        <span className="timer-header__today">
          <span className="timer-header__today-label">Today</span>
          <span className="timer-header__today-value">{formatTime(workedToday)}</span>
        </span>
        {status !== 'stopped' && <StatusBadge status={status} />}
        {status !== 'stopped' && <TimerControls compact />}
      </div>
    </div>
  );
}
