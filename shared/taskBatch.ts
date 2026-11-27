/**
 * Several Tasks at once, one per line (#399). The web screens check a list
 * with these rules before sending it, and `POST /api/tasks/batch` applies them
 * again with the Project's existing Task names, so both answer the same way.
 */

export const TASK_NAME_MAX = 255;

/** Non-empty lines one submission may carry. */
export const TASK_BATCH_MAX = 50;

export type TaskBatchPlan =
  | { ok: true; names: string[]; skipped: number }
  | { ok: false; message: string };

/**
 * The lines of a typed or pasted list, blank ones kept, so a line number is
 * the one the person sees in the field.
 */
export function taskLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** How two Task names are compared: trimmed, case-insensitive. */
function taskNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * One Task per non-empty line, trimmed. A line repeated in the list, or
 * matching an existing Task of the Project (open or archived), is skipped and
 * counted. All or nothing: over the limit, or one line too long, and nothing
 * is created.
 */
export function planTaskBatch(lines: readonly string[], existingNames: readonly string[] = []): TaskBatchPlan {
  const filled = lines
    .map((line, index) => ({ name: line.trim(), line: index + 1 }))
    .filter((entry) => entry.name.length > 0);

  if (filled.length === 0) return { ok: false, message: "Name at least one Task." };
  if (filled.length > TASK_BATCH_MAX) {
    return {
      ok: false,
      message: `Create at most ${TASK_BATCH_MAX} Tasks at a time. This list has ${filled.length}.`,
    };
  }

  const tooLong = filled.find((entry) => entry.name.length > TASK_NAME_MAX);
  if (tooLong) {
    return {
      ok: false,
      message: `Line ${tooLong.line} is longer than ${TASK_NAME_MAX} characters. Shorten it, then create the Tasks again.`,
    };
  }

  const seen = new Set(existingNames.map(taskNameKey));
  const names: string[] = [];
  let skipped = 0;
  for (const { name } of filled) {
    const key = taskNameKey(name);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  return { ok: true, names, skipped };
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The success line. One Task alone keeps the single-Task wording. */
export function taskBatchNotice(created: number, skipped: number): string {
  if (created === 1 && skipped === 0) return "Task created";
  const made = `${count(created, "Task")} created`;
  return skipped > 0 ? `${made}, ${count(skipped, "duplicate")} skipped` : made;
}

/** When every line is already on the Project, nothing is created and the list stays. */
export const TASK_BATCH_ALL_DUPLICATES =
  "Every Task in this list is already on this Project, so none was created. Add a name the Project does not have yet.";
