/**
 * Timer stage — the clock and its three controls.
 *
 * Stop and ✓ both close the entry; the difference is what is left on screen.
 * Stop keeps the task so one click resumes it, ✓ clears it and the screen falls
 * back to its empty state. The server has no "complete" call, so ✓ is a stop
 * plus a UI decision — see UiContext.completedKey.
 *
 * Resuming after a stop needs a CRM project id, which TimerState does not
 * carry (it has the project *name*). It is recovered from the recent-task list
 * first and from the project list second, so the play button still works after
 * the app has been restarted.
 */

import { useState } from 'react';
import { useAgent } from '../../app/stores/AgentContext';
import { useUi } from '../ui/UiContext';
import { activeKey, useActiveTask } from '../ui/useActiveTask';
import { formatElapsed, formatHM } from '../format';
import { CheckIcon, ClockIcon } from '../icons';

export function TimerPage() {
  const { state, pauseTimer, resumeTimer, stopTimer, startTimer } = useAgent();
  const { showToast, markCompleted, clearCompleted } = useUi();
  const active = useActiveTask();
  const timer = state.agentState?.timer;
  const [busy, setBusy] = useState(false);

  if (!active || !timer) {
    return (
      <div className="v2-timer">
        <div className="v2-blank">
          <span className="v2-blank__mark" aria-hidden="true"><ClockIcon size={20} /></span>
          <h1 className="v2-blank__title">Nothing tracking</h1>
          <p className="v2-blank__body">
            Pick a project on the left, then a task — tracking starts the moment you choose one.
          </p>
        </div>
      </div>
    );
  }

  const running = active.status === 'running';
  const taskLabel = active.taskName ?? 'Untitled task';

  /** Start again after a stop: TimerState has the name, not the id. */
  async function restart(): Promise<{ ok: boolean; error?: string }> {
    const recent = state.recentTasks.find(
      (r) => r.projectName === active!.projectName && r.taskId === active!.taskId,
    );
    if (recent) {
      return startTimer({
        crmProjectId: recent.crmProjectId,
        projectName: recent.projectName,
        taskId: recent.taskId ?? undefined,
        taskName: recent.taskName ?? undefined,
      });
    }
    const projects = await window.agentBridge.getProjects();
    const match = projects.ok ? projects.data.find((p) => p.name === active!.projectName) : undefined;
    if (!match) return { ok: false, error: 'Pick the task again on the left to start tracking' };
    return startTimer({
      crmProjectId: match.id,
      projectName: match.name,
      taskId: active!.taskId ?? undefined,
      taskName: active!.taskName ?? undefined,
    });
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (running) {
        const result = await pauseTimer();
        showToast(result.ok ? `Timer paused at ${formatElapsed(active!.seconds)}` : result.error ?? 'Could not pause');
        return;
      }
      if (active!.status === 'paused') {
        const result = await resumeTimer();
        showToast(result.ok ? 'Timer resumed' : result.error ?? 'Could not resume');
        return;
      }
      clearCompleted();
      const result = await restart();
      showToast(result.ok ? `Tracking “${taskLabel}”` : result.error ?? 'Could not start the timer');
    } finally {
      setBusy(false);
    }
  }

  async function close(complete: boolean) {
    if (busy || active!.status === 'stopped') return;
    setBusy(true);
    const logged = active!.seconds;
    try {
      const result = await stopTimer();
      if (!result.ok) { showToast(result.error ?? 'Could not stop the timer'); return; }
      if (complete) {
        markCompleted(activeKey(active!.taskId, active!.projectName));
        showToast(`“${taskLabel}” marked complete`);
      } else {
        showToast(`Entry logged · ${formatHM(logged)} on “${taskLabel}”`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="v2-timer">
      <span className={`v2-chip ${running ? 'v2-chip--recording' : 'v2-chip--paused'}`}>
        <span className="v2-chip__dot" />
        {running ? 'RECORDING' : 'PAUSED'}
      </span>

      <p className="v2-timer__project">{active.projectName}</p>
      <h1 className="v2-timer__task">{taskLabel}</h1>
      <p className="v2-timer__clock">{formatElapsed(active.seconds)}</p>

      <div className="v2-transport">
        <button
          className="v2-transport__side v2-transport__side--stop"
          onClick={() => void close(false)}
          disabled={busy || active.status === 'stopped'}
          aria-label="Stop and log this entry"
          title="Stop and log this entry"
        >
          <span className="v2-transport__stop-shape" />
        </button>

        <button
          className={`v2-transport__main${running ? ' v2-transport__main--running' : ''}`}
          onClick={() => void toggle()}
          disabled={busy}
          aria-label={running ? 'Pause' : 'Start'}
          title={running ? 'Pause' : 'Start'}
        >
          {running
            ? <span className="v2-transport__pause"><span /><span /></span>
            : <span className="v2-transport__play" />}
        </button>

        <button
          className="v2-transport__side v2-transport__side--complete"
          onClick={() => void close(true)}
          disabled={busy || active.status === 'stopped'}
          aria-label="Log this entry and clear the task"
          title="Log this entry and clear the task"
        >
          <CheckIcon size={19} />
        </button>
      </div>

      <div className="v2-stats">
        <div className="v2-card v2-stat">
          <span className="v2-stat__label">Session progress</span>
          <p className="v2-stat__value">{formatHM(active.seconds)}</p>
        </div>
        <div className="v2-card v2-stat">
          <span className="v2-stat__label">Worked today</span>
          <p className="v2-stat__value">{formatHM(timer.workedToday)}</p>
        </div>
      </div>
    </div>
  );
}
