import React from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatTime } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { TimerControls } from './TimerControls';

export function ActiveTimerHeader() {
  const { state } = useAgent();
  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';

  return (
    <div className="timer-header">
      {status !== 'stopped' && (
        <>
          <div className="timer-header__info">
            <div className="timer-header__project">{timer?.projectName ?? 'Project'}</div>
            {timer?.taskName && (
              <div className="timer-header__task">↳ {timer.taskName}</div>
            )}
          </div>
          <span className={`timer-header__elapsed timer-header__elapsed--${status}`}>
            {formatTime(timer?.elapsed ?? 0)}
          </span>
          <StatusBadge status={status} />
          <TimerControls compact />
        </>
      )}
    </div>
  );
}
