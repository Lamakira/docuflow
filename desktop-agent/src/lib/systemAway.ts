/**
 * Pauses when the Member left (#333).
 *
 * A pause made because the machine slept, the screen locked or the Member was
 * idle reaches the server dated when the Member left, not when the command
 * arrives, so the server's total equals the desktop's. While the Timer is
 * paused here, heartbeats name no entry, so the server accrues nothing
 * whatever order commands and heartbeats arrive in.
 *
 * Ports keep this free of Electron so it is testable on its own.
 */

import type { PendingTimerCommand } from "./SqliteQueue";
import { isLocalEntryId } from "./simultaneousTimers";

/** A timer command before main gives it a `clientCommandId`. */
export type TimerCommandDraft = Pick<PendingTimerCommand, "type" | "entryId" | "effectiveAt">;

/**
 * The entry a heartbeat names: only while the Timer runs here, and never a
 * local placeholder (the server checks it as a UUID). Every running Timer is
 * named in `timeEntryIds` (lib/simultaneousTimers.ts).
 */
export function heartbeatTimeEntryId(
  timerStatus: string,
  activeEntryId: string | null,
): string | null {
  return timerStatus === "running" && !isLocalEntryId(activeEntryId) ? activeEntryId : null;
}

export function pauseCommandAt(entryId: string, at: Date): TimerCommandDraft {
  return { type: "pause", entryId, effectiveAt: at.toISOString() };
}

export function stopCommandAt(entryId: string, at: Date): TimerCommandDraft {
  return { type: "stop", entryId, effectiveAt: at.toISOString() };
}

/**
 * "I'm back" after idle time: the server pauses where the idle time began and
 * resumes now, so its total equals the desktop's.
 */
export function droppedIdleCommands(entryId: string, idleSince: Date): TimerCommandDraft[] {
  return [pauseCommandAt(entryId, idleSince), { type: "resume", entryId }];
}

export interface SystemAwayPorts {
  now(): Date;
  timerStatus(): string;
  activeEntryId(): string | null;
  /** Every running Timer (#400). Absent: the active entry alone, as with one Timer. */
  runningEntryIds?(): string[];
  /** End any idle flow; returns when the idle time began if its countdown was running. */
  cancelIdle(): Date | null;
  /** Pause every running Timer here at `at`. */
  pauseLocally(at: Date): void;
  enqueue(command: TimerCommandDraft): void;
}

/**
 * Pause for sleep or screen lock, dated where the idle countdown began if one
 * was running, else now: every running Timer, one pause command each
 * (ADR-0031). Returns the pause time, or null when nothing ran.
 */
export function pauseForSystemAway(ports: SystemAwayPorts): Date | null {
  if (ports.timerStatus() !== "running") return null;
  const activeEntryId = ports.activeEntryId();
  const entryIds = ports.runningEntryIds ? ports.runningEntryIds() : activeEntryId ? [activeEntryId] : [];
  if (entryIds.length === 0) return null;
  const at = ports.cancelIdle() ?? ports.now();
  ports.pauseLocally(at);
  for (const entryId of entryIds) ports.enqueue(pauseCommandAt(entryId, at));
  return at;
}
