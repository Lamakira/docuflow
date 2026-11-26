import type { Project, Task } from '../renderer/app/types';

type Created<T> = Promise<{ ok: boolean; data?: T; error?: string }>;

/** The two create calls of the agent bridge; deliberately nothing that starts the Timer (#397). */
export interface CreateBridge {
  createTask(data: { crmProjectId: string; name: string }): Created<Task>;
  createProject(data: { name: string }): Created<Project>;
}

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
