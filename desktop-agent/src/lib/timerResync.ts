/**
 * Whether a server timer snapshot may overwrite local state.
 *
 * A poll sent before a timer command reached the server can resolve after the
 * command synced; its answer predates the command and would undo it (a pause
 * flickering back to running for one poll). Only a snapshot requested after the
 * last command synced, with nothing still queued, reflects the server's state.
 *
 * Times are monotonic (performance.now()): the wall clock can step back (NTP after
 * wake) and would make every snapshot look older than the last command.
 */
export function timerSyncApplies(input: {
  /** When the request that produced the snapshot was sent (performance.now()). */
  requestedAtMono: number;
  /** Timer commands still waiting to sync. */
  pendingCommands: number;
  /** performance.now() when the last timer command synced in this process, null when none did. */
  lastCommandSyncedMono: number | null;
}): boolean {
  if (input.pendingCommands > 0) return false;
  if (input.lastCommandSyncedMono !== null && input.requestedAtMono <= input.lastCommandSyncedMono) return false;
  return true;
}
