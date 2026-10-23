/**
 * How a failed timer command is treated by the sync drain (#333).
 *
 * A command that never reached the server stays queued, so a pause made at
 * sleep still reaches it on wake when the network is not back yet. A refusal
 * stays a permanent failure.
 */

/** Tag on errors thrown when the server could not be reached at all. */
export const NETWORK_UNAVAILABLE = "network_unavailable";

const CONFLICT_MESSAGES = ["not running", "not paused", "already stopped", "not found"];

export function timerCommandFailure(error: unknown): "conflict" | "retry" | "fail" {
  const msg: string = (error as any)?.message ?? "";
  if (CONFLICT_MESSAGES.some((m) => msg.includes(m))) return "conflict";
  const status = (error as any)?.status;
  if ((error as any)?.code === NETWORK_UNAVAILABLE || status === 502 || status === 503 || status === 504) {
    return "retry";
  }
  return "fail";
}
