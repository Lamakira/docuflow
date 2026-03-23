import React, { useState } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatWorkedToday } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

export function WorkedToday() {
  const { state, pauseTimer, resumeTimer } = useAgent();
  const [pauseLoading, setPauseLoading] = useState(false);
  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';
  const isActive = status !== 'stopped' && timer?.entryId != null;

  // workedToday is session-derived and pushed from main on every state update
  const total = timer?.workedToday ?? 0;

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
