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

/** A timer command before main gives it a `clientCommandId`. */
export type TimerCommandDraft = Pick<PendingTimerCommand, "type" | "entryId" | "effectiveAt">;

/** The entry a heartbeat names: only while the Timer runs here. */
export function heartbeatTimeEntryId(
  timerStatus: string,
  activeEntryId: string | null,
): string | null {
  return timerStatus === "running" ? activeEntryId : null;
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
  /** End any idle flow; returns when the idle time began if its countdown was running. */
  cancelIdle(): Date | null;
  pauseLocally(at: Date): void;
  enqueue(command: TimerCommandDraft): void;
}

/**
 * Pause for sleep or screen lock, dated where the idle countdown began if one
 * was running, else now. Returns the pause time, or null when nothing ran.
 */
export function pauseForSystemAway(ports: SystemAwayPorts): Date | null {
  const entryId = ports.activeEntryId();
  if (ports.timerStatus() !== "running" || !entryId) return null;
  const at = ports.cancelIdle() ?? ports.now();
  ports.pauseLocally(at);
  ports.enqueue(pauseCommandAt(entryId, at));
  return at;
}
