/**
 * Idle pause (#293).
 *
 * Idle auto-pause always happens once input stops for the Idle timeout.
 * `idlePromptEnabled` only decides whether the Member is asked first:
 *
 *   prompt on   show the prompt with a countdown of `idleCountdownSeconds`. The
 *               Timer keeps running meanwhile. An answer is acted on; no answer
 *               by zero pauses the Timer where the idle time began, and the
 *               prompt stays up as "Tracking paused".
 *   prompt off  pause the Timer where the idle time began, without a prompt.
 *
 * Idle time is never counted: "I'm back" (or input outside the agent window)
 * drops it and carries on, "I'm not working" stops the Timer where it began.
 *
 * Ports keep this free of Electron so the flow is testable on its own.
 */

import { idleCountdownSeconds, type TrackingPolicy } from "./trackingPolicy";

export interface IdlePromptPayload {
  idleSeconds: number;
  /** Epoch ms at which the Timer pauses with no answer; null once it has paused. */
  pausesAt: number | null;
  /** Length of the countdown shown; null once the Timer has paused. */
  countdownSeconds: number | null;
}

export interface IdleFlowPorts {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  timerStatus(): string;
  /** Close the running session at `at` and tell the server the Timer paused. */
  pauseAt(at: Date): void;
  /** Keep the Timer running but drop the time since `at` (close the session there, open one now). */
  dropIdleSince(at: Date): void;
  /** Resume a paused Timer. */
  resume(): void;
  /** Stop the Timer; a running session closes at `at`. */
  stopAt(at: Date): void;
  showPrompt(payload: IdlePromptPayload): void;
  dismissPrompt(): void;
  log(message: string): void;
}

type Phase =
  | { kind: "none" }
  | { kind: "counting"; idleStartedAt: Date; handle: unknown }
  | { kind: "paused"; idleStartedAt: Date };

export type IdleOutcome = "prompted" | "paused" | "skipped";

/** Whole seconds left before the Timer pauses, never negative. */
export function countdownRemainingSeconds(pausesAt: number, now: number): number {
  return Math.max(0, Math.ceil((pausesAt - now) / 1000));
}

/** "1:05", "0:09". */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Whether this idle check crosses the Idle timeout for the first time while the Timer runs. */
export function idleTimeoutReached(input: {
  idleSeconds: number;
  thresholdSeconds: number;
  alreadyTriggered: boolean;
  timerStatus: string;
}): boolean {
  return (
    input.idleSeconds >= input.thresholdSeconds &&
    !input.alreadyTriggered &&
    input.timerStatus === "running"
  );
}

export class IdleFlow {
  private phase: Phase = { kind: "none" };

  constructor(private readonly ports: IdleFlowPorts) {}

  /** A prompt is up or counting down. */
  get active(): boolean {
    return this.phase.kind !== "none";
  }

  get counting(): boolean {
    return this.phase.kind === "counting";
  }

  get idleStartedAt(): Date | null {
    return this.phase.kind === "none" ? null : this.phase.idleStartedAt;
  }

  /** Input stopped for the Idle timeout. */
  onIdleTimeout(
    idleSeconds: number,
    policy: Pick<TrackingPolicy, "idlePromptEnabled" | "idleCountdownSeconds">,
  ): IdleOutcome {
    if (this.phase.kind !== "none" || this.ports.timerStatus() !== "running") return "skipped";
    const now = this.ports.now();
    const idleStartedAt = new Date(now - idleSeconds * 1000);

    if (!policy.idlePromptEnabled) {
      this.ports.pauseAt(idleStartedAt);
      this.ports.log(`idle.pause — prompt off, Timer paused at ${idleStartedAt.toISOString()}`);
      return "paused";
    }

    const seconds = idleCountdownSeconds(policy);
    const handle = this.ports.setTimeout(() => this.countdownEnded(), seconds * 1000);
    this.phase = { kind: "counting", idleStartedAt, handle };
    this.ports.showPrompt({ idleSeconds, pausesAt: now + seconds * 1000, countdownSeconds: seconds });
    this.ports.log(`idle.prompt — ${seconds}s countdown (idle since ${idleStartedAt.toISOString()})`);
    return "prompted";
  }

  /** "I'm back", or input outside the agent window. Returns false when no prompt was up. */
  memberBack(): boolean {
    const phase = this.phase;
    if (phase.kind === "none") return false;
    this.clear();
    const status = this.ports.timerStatus();
    if (phase.kind === "counting" && status === "running") {
      this.ports.dropIdleSince(phase.idleStartedAt);
      this.ports.log("idle.back — answered in time, idle time dropped");
    } else if (phase.kind === "paused" && status === "paused") {
      this.ports.resume();
      this.ports.log("idle.back — Timer resumed");
    }
    this.ports.dismissPrompt();
    return true;
  }

  /** "I'm not working": stop the Timer where the idle time began. Returns false when no prompt was up. */
  memberNotWorking(): boolean {
    const phase = this.phase;
    if (phase.kind === "none") return false;
    this.clear();
    const status = this.ports.timerStatus();
    if (status === "running" || status === "paused") {
      this.ports.stopAt(phase.idleStartedAt);
      this.ports.log(`idle.break — Timer stopped at ${phase.idleStartedAt.toISOString()}`);
    }
    this.ports.dismissPrompt();
    return true;
  }

  /**
   * Something else took over (sleep, screen lock, sign-out). Ends the flow
   * without acting; returns when the idle time began if the countdown was running.
   */
  cancel(): Date | null {
    const phase = this.phase;
    this.clear();
    return phase.kind === "counting" ? phase.idleStartedAt : null;
  }

  private countdownEnded(): void {
    const phase = this.phase;
    if (phase.kind !== "counting") return;
    if (this.ports.timerStatus() !== "running") {
      // Paused or stopped elsewhere meanwhile — nothing left to ask about.
      this.phase = { kind: "none" };
      this.ports.dismissPrompt();
      return;
    }
    this.ports.pauseAt(phase.idleStartedAt);
    this.phase = { kind: "paused", idleStartedAt: phase.idleStartedAt };
    const idleSeconds = Math.round((this.ports.now() - phase.idleStartedAt.getTime()) / 1000);
    this.ports.showPrompt({ idleSeconds, pausesAt: null, countdownSeconds: null });
    this.ports.log(`idle.pause — no answer, Timer paused at ${phase.idleStartedAt.toISOString()}`);
  }

  private clear(): void {
    if (this.phase.kind === "counting") this.ports.clearTimeout(this.phase.handle);
    this.phase = { kind: "none" };
  }
}
