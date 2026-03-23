import React from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatTime } from '../../types';

export function ActiveTimerHeader() {
  const { state } = useAgent();
  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';

  if (status === 'stopped' || !timer?.entryId) return null;

  return (
    <div className={`timer-header timer-header--${status}`}>
      <div className="timer-header__info">
        {timer.projectName && (
          <div className="timer-header__project">{timer.projectName}</div>
        )}
        {timer.taskName && (
          <div className="timer-header__task">{timer.taskName}</div>
        )}
      </div>
      <span className="timer-header__elapsed">
        {formatTime(timer?.elapsed ?? 0)}
      </span>
    </div>
  );
}
