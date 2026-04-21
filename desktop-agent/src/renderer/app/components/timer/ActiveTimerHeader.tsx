import React, { useRef } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatTime } from '../../types';

interface HeaderContext {
  projectName: string | null;
  taskName: string | null;
  elapsedToday: number;
}

export function ActiveTimerHeader() {
  const { state } = useAgent();
  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';

  // Persist the last known context so the header stays visible after the timer stops.
  // Null only before any timer has ever been started this session.
  const lastContextRef = useRef<HeaderContext | null>(null);

  if (timer && timer.entryId && status !== 'stopped') {
    lastContextRef.current = {
      projectName: timer.projectName,
      taskName: timer.taskName,
      elapsedToday: timer.elapsedToday,
    };
  }

  const ctx: HeaderContext | null =
    status !== 'stopped' && timer?.entryId
      ? { projectName: timer.projectName, taskName: timer.taskName, elapsedToday: timer.elapsedToday }
      : lastContextRef.current;

  // Nothing to show — no timer has ever run this session
  if (!ctx) return null;

  return (
    <div className={`timer-header timer-header--${status}`}>
      <div className="timer-header__info">
        {ctx.projectName && (
          <div className="timer-header__project">{ctx.projectName}</div>
        )}
        {ctx.taskName && (
          <div className="timer-header__task">{ctx.taskName}</div>
        )}
      </div>
      <span className="timer-header__elapsed">
        {formatTime(ctx.elapsedToday)}
      </span>
    </div>
  );
}
