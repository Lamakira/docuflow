import React, { useRef, useState } from 'react';
import { useAgent } from '../../stores/AgentContext';
import { formatTime } from '../../types';

interface HeaderContext {
  projectName: string | null;
  taskName: string | null;
  elapsedToday: number;
  taskId: string | null;
}

export function ActiveTimerHeader() {
  const { state, resumeTimer, startTimer } = useAgent();
  const timer = state.agentState?.timer;
  const status = timer?.status ?? 'stopped';
  const [pending, setPending] = useState(false);

  // Persist the last known context so the header stays visible after the timer stops.
  // Null only before any timer has ever been started this session.
  const lastContextRef = useRef<HeaderContext | null>(null);

  if (timer && timer.entryId && status !== 'stopped') {
    lastContextRef.current = {
      projectName: timer.projectName,
      taskName: timer.taskName,
      elapsedToday: timer.elapsedToday,
      taskId: timer.taskId,
    };
  }

  const ctx: HeaderContext | null =
    status !== 'stopped' && timer?.entryId
      ? { projectName: timer.projectName, taskName: timer.taskName, elapsedToday: timer.elapsedToday, taskId: timer.taskId }
      : lastContextRef.current;

  // Nothing to show — no timer has ever run this session
  if (!ctx) return null;

  // Play button is shown only when stopped and there is a recent task to restart from
  const canRestart = status === 'stopped' && state.recentTasks.length > 0;

  async function handlePlay() {
    if (pending) return;
    setPending(true);
    try {
      if (status === 'paused') {
        await resumeTimer();
      } else if (canRestart) {
        // Prefer the task that matches the last running context, fall back to most recent
        const recent =
          state.recentTasks.find((r) => r.taskId === ctx?.taskId) ??
          state.recentTasks[0];
        if (!recent) return;
        await startTimer({
          crmProjectId: recent.crmProjectId,
          taskId: recent.taskId ?? undefined,
          taskName: recent.taskName ?? undefined,
          projectName: recent.projectName,
          description: recent.description ?? undefined,
          taskDurationToday: ctx?.elapsedToday,
        });
      }
    } finally {
      setPending(false);
    }
  }

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
      {canRestart && (
        <button
          className="timer-header__play-btn"
          onClick={handlePlay}
          disabled={pending}
          title="Restart timer"
        >
          {pending ? '…' : '▶'}
        </button>
      )}
    </div>
  );
}
