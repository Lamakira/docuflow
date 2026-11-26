import type { AgentBridge, Project, Task } from '../renderer/app/types';

/** The two create calls of the agent bridge; deliberately nothing that starts the Timer (#397). */
export type CreateBridge = Pick<AgentBridge, 'createTask' | 'createProject'>;

export type CreateOutcome =
  | { ok: false; error: string }
  | { ok: true; kind: 'task'; task: Task; toast: string }
  | { ok: true; kind: 'project'; project: Project; toast: string };

/**
 * Create a Task in the open Project, or a Project when none is open.
 * Creating only creates; starting stays its own gesture, a click on the row (#397).
 */
export async function createFromTimerPanel(
  name: string,
  openProject: Project | null,
  bridge: CreateBridge,
): Promise<CreateOutcome> {
  if (openProject) {
    const result = await bridge.createTask({ crmProjectId: openProject.id, name });
    if (!result.ok || !result.data) return { ok: false, error: result.error ?? 'Could not create the task' };
    return { ok: true, kind: 'task', task: result.data, toast: `Task “${result.data.name}” created` };
  }
  const result = await bridge.createProject({ name });
  if (!result.ok || !result.data) return { ok: false, error: result.error ?? 'Could not create the project' };
  return { ok: true, kind: 'project', project: result.data, toast: `Project “${result.data.name}” created` };
}

/**
 * Apply a task read without losing a Task created while it was in flight.
 *
 * A read issued before a create can answer after it, and then lacks the new
 * Task. Cached Tasks created here at or after `issuedAt` and missing from the
 * read are kept, first; everything else follows the server. `createdAt` holds,
 * per Task id, when this panel added it.
 */
export function mergeTaskRead(
  cached: Task[],
  read: Task[],
  createdAt: Record<string, number>,
  issuedAt: number,
): Task[] {
  const inRead = new Set(read.map((t) => t.id));
  const kept = cached.filter((t) => !inRead.has(t.id) && (createdAt[t.id] ?? -Infinity) >= issuedAt);
  return [...kept, ...read];
}
