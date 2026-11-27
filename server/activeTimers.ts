/**
 * A User's active Timers with the names a screen shows (#400, ADR-0031): the
 * Project's and the Task's, read in the Timer's own Workspace. The web chip and
 * the desktop agent list the same thing, so they read it from one place.
 */

import type { TimeEntry } from "@shared/schema";
import { storage } from "./storage";
import { inTimeEntryWorkspace } from "./modules/time/commands";

export type NamedTimer = TimeEntry & { projectName: string | null; taskName: string | null };

/** Newest first. A name that cannot be read is null, never a reason to drop the Timer. */
export async function namedActiveTimers(userId: string): Promise<NamedTimer[]> {
  const timers: NamedTimer[] = [];
  for (const entry of await storage.getActiveTimeEntries(userId)) {
    const names = await inTimeEntryWorkspace(entry, async () => {
      const crmProject = await storage.getCrmProject(entry.crmProjectId).catch(() => undefined);
      const task = entry.taskId ? await storage.getTask(entry.taskId).catch(() => undefined) : undefined;
      return {
        projectName: (crmProject as { project?: { name?: string } } | undefined)?.project?.name ?? null,
        taskName: task?.name ?? null,
      };
    });
    timers.push({ ...entry, ...names });
  }
  return timers;
}
