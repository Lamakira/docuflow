/**
 * The task the Timer screen is about.
 *
 * Stopping keeps the context: the panel still shows the task, the stage still
 * shows its clock at zero, and one click resumes. Completing it with ✓ is the
 * only thing that clears the screen — hence the completedKey check.
 *
 * The agent's store does not help here. `clearTimer()` wipes the project and
 * task names along with the entry, so after a stop TimerState knows nothing.
 * The last start is recovered from AgentContext's recent-task list, which also
 * carries the CRM project id the restart needs. That list is in-memory, so a
 * relaunch after a stop lands on the empty state — which is the honest answer
 * at that point anyway.
 */

import { useAgent } from '../../app/stores/AgentContext';
import type { TimerStatus } from '../../app/types';
import { useUi } from './UiContext';

export interface ActiveTask {
  projectName: string;
  taskName: string | null;
  taskId: string | null;
  status: TimerStatus;
  /** Seconds on this entry today — what the big clock shows. */
  seconds: number;
}

/** Stable identity for an entry across a stop, used by completedKey. */
export function activeKey(taskId: string | null, projectName: string | null): string {
  return `${taskId ?? '-'}::${projectName ?? '-'}`;
}

export function useActiveTask(): ActiveTask | null {
  const { state } = useAgent();
  const { completedKey } = useUi();
  const timer = state.agentState?.timer;
  const last = state.recentTasks[0];

  const task: ActiveTask | null = timer?.projectName
    ? {
        projectName: timer.projectName,
        taskName: timer.taskName,
        taskId: timer.taskId,
        status: timer.status,
        seconds: timer.elapsedToday,
      }
    : last
      ? { projectName: last.projectName, taskName: last.taskName, taskId: last.taskId, status: 'stopped', seconds: 0 }
      : null;

  if (!task) return null;
  if (completedKey && completedKey === activeKey(task.taskId, task.projectName)) return null;
  return task;
}
