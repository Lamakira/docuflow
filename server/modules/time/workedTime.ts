/**
 * Worked Time and Simultaneous Time (ADR-0031, GLOSSARY.md).
 *
 * Each Time Entry keeps its seconds in full: a Task counts its entries whole.
 * A Member's Worked Time counts once the time at least one of their Timers
 * ran; a Project counts once, per Member, the time any of its Timers ran.
 * Simultaneous Time is the part of Worked Time when two or more ran.
 *
 * The seconds an entry holds and its wall time can differ (idle removed,
 * heartbeats), so the counts start from the entries' seconds and take off only
 * what overlapped: with no overlap every figure is the sum it always was.
 */

export interface Interval {
  /** Milliseconds since the epoch. */
  start: number;
  end: number;
}

export interface CountedEntry {
  id: string;
  userId: string;
  crmProjectId: string;
  /** The entry's seconds inside the period, as `timePortion` gives them. */
  seconds: number;
  /**
   * When the entry's Timer ran (pauses taken out), whole; cut to the window
   * here. Empty for an entry that ran beside no other: it keeps its seconds.
   */
  intervals: Interval[];
}

export interface TimeCount {
  workedByUser: Map<string, number>;
  simultaneousByUser: Map<string, number>;
  /** Per Member, per Project: the seconds counted once. */
  projectByUser: Map<string, Map<string, number>>;
  /**
   * Each entry's part of its Member's Worked Time: overlapping time shared
   * equally between the Timers that ran together. A Member's shares add up to
   * their Worked Time.
   */
  workedShareByEntry: Map<string, number>;
}

/** The running intervals of one entry, from its Timer Commands in order. */
export function runningIntervals(
  span: { start: Date; end: Date },
  commands: Array<{ kind: string; at: Date }>,
): Interval[] {
  const spanStart = span.start.getTime();
  const spanEnd = span.end.getTime();
  if (commands.length === 0) return [{ start: spanStart, end: spanEnd }];
  const intervals: Interval[] = [];
  let open: number | null = null;
  for (const command of commands) {
    const at = command.at.getTime();
    if (command.kind === "start" || command.kind === "resume") {
      if (open === null) open = at;
    } else if (command.kind === "pause" || command.kind === "stop") {
      if (open !== null) intervals.push({ start: open, end: at });
      open = null;
    }
  }
  // A switch, the paused-expiry or an edit closes it without a command of its own.
  if (open !== null) intervals.push({ start: open, end: spanEnd });
  return intervals
    .map(({ start, end }) => ({ start: Math.max(start, spanStart), end: Math.min(end, spanEnd) }))
    .filter(({ start, end }) => end > start);
}

/** Entries whose wall time meets another entry of the same Member: the only ones that can overlap. */
export function overlappingEntryIds(
  entries: Array<{ id: string; userId: string; span: { start: Date; end: Date } }>,
): Set<string> {
  const found = new Set<string>();
  const byUser = new Map<string, typeof entries>();
  for (const entry of entries) byUser.set(entry.userId, [...(byUser.get(entry.userId) ?? []), entry]);
  for (const own of Array.from(byUser.values())) {
    const sorted = [...own].sort((a, b) => a.span.start.getTime() - b.span.start.getTime());
    let reach: { id: string; end: number } | null = null;
    for (const entry of sorted) {
      const start = entry.span.start.getTime();
      const end = entry.span.end.getTime();
      if (reach && start < reach.end) {
        found.add(reach.id);
        found.add(entry.id);
      }
      if (!reach || end > reach.end) reach = { id: entry.id, end };
    }
  }
  return found;
}

export function countTime(entries: CountedEntry[], window: { start?: Date; end?: Date } = {}): TimeCount {
  const from = window.start?.getTime() ?? Number.NEGATIVE_INFINITY;
  const to = window.end?.getTime() ?? Number.POSITIVE_INFINITY;
  const count: TimeCount = {
    workedByUser: new Map(),
    simultaneousByUser: new Map(),
    projectByUser: new Map(),
    workedShareByEntry: new Map(),
  };

  const byUser = new Map<string, CountedEntry[]>();
  for (const entry of entries) byUser.set(entry.userId, [...(byUser.get(entry.userId) ?? []), entry]);

  for (const [userId, own] of Array.from(byUser.entries())) {
    const sweep = sweepOverlaps(own, from, to);
    const seconds = (list: CountedEntry[]) => list.reduce((sum, entry) => sum + entry.seconds, 0);
    const toSeconds = (ms: number) => Math.round(ms / 1000);

    const excess = own.reduce((sum, entry) => sum + (sweep.measure.get(entry.id) ?? 0), 0) - sweep.union;
    count.workedByUser.set(userId, Math.max(0, seconds(own) - toSeconds(excess)));
    count.simultaneousByUser.set(userId, toSeconds(sweep.simultaneous));

    const projects = new Map<string, number>();
    for (const projectId of Array.from(new Set(own.map((entry) => entry.crmProjectId)))) {
      const onProject = own.filter((entry) => entry.crmProjectId === projectId);
      const measured = onProject.reduce((sum, entry) => sum + (sweep.measure.get(entry.id) ?? 0), 0);
      const projectExcess = measured - (sweep.projectUnion.get(projectId) ?? 0);
      projects.set(projectId, Math.max(0, seconds(onProject) - toSeconds(projectExcess)));
    }
    count.projectByUser.set(userId, projects);

    for (const entry of own) {
      const shared = (sweep.measure.get(entry.id) ?? 0) - (sweep.share.get(entry.id) ?? 0);
      count.workedShareByEntry.set(entry.id, Math.max(0, entry.seconds - toSeconds(shared)));
    }
  }
  return count;
}

/** One Member's intervals, cut to the window and swept boundary to boundary. */
function sweepOverlaps(own: CountedEntry[], from: number, to: number) {
  const pieces: Array<{ id: string; projectId: string; start: number; end: number }> = [];
  for (const entry of own) {
    for (const interval of entry.intervals) {
      const start = Math.max(interval.start, from);
      const end = Math.min(interval.end, to);
      if (end > start) pieces.push({ id: entry.id, projectId: entry.crmProjectId, start, end });
    }
  }
  const boundaries = Array.from(new Set(pieces.flatMap((piece) => [piece.start, piece.end]))).sort((a, b) => a - b);
  const measure = new Map<string, number>();
  const share = new Map<string, number>();
  const projectUnion = new Map<string, number>();
  let union = 0;
  let simultaneous = 0;
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const length = end - start;
    const running = pieces.filter((piece) => piece.start <= start && piece.end >= end);
    const ids = Array.from(new Set(running.map((piece) => piece.id)));
    if (ids.length === 0) continue;
    union += length;
    if (ids.length >= 2) simultaneous += length;
    for (const id of ids) {
      measure.set(id, (measure.get(id) ?? 0) + length);
      share.set(id, (share.get(id) ?? 0) + length / ids.length);
    }
    for (const projectId of Array.from(new Set(running.map((piece) => piece.projectId)))) {
      projectUnion.set(projectId, (projectUnion.get(projectId) ?? 0) + length);
    }
  }
  return { measure, share, projectUnion, union, simultaneous };
}
