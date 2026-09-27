/**
 * When the next capture lands (#293). One capture is ever waiting; a new
 * interval from a heartbeat re-draws it instead of letting it run out on the
 * bounds it was drawn with.
 */

import type { TrackingPolicy } from "./trackingPolicy";

export interface CaptureInterval {
  minMs: number;
  maxMs: number;
}

export interface CaptureTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

const MINUTE_MS = 60 * 1000;

export function captureIntervalFromPolicy(
  policy: Pick<TrackingPolicy, "captureIntervalMinMin" | "captureIntervalMaxMin">,
): CaptureInterval {
  const minMs = Math.max(3, policy.captureIntervalMinMin) * MINUTE_MS;
  return { minMs, maxMs: Math.max(minMs, policy.captureIntervalMaxMin * MINUTE_MS) };
}

const realTimers: CaptureTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  random: Math.random,
};

export class CaptureScheduler {
  private handle: unknown = null;

  constructor(
    private readonly fire: () => void,
    private interval: CaptureInterval,
    private readonly timers: CaptureTimers = realTimers,
  ) {}

  get pending(): boolean {
    return this.handle !== null;
  }

  get current(): CaptureInterval {
    return this.interval;
  }

  /** Arm the next capture, replacing any already waiting. Returns the delay drawn. */
  scheduleNext(): number {
    this.cancel();
    const { minMs, maxMs } = this.interval;
    const delay = minMs + this.timers.random() * (maxMs - minMs);
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      this.fire();
    }, delay);
    return delay;
  }

  cancel(): void {
    if (this.handle === null) return;
    this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  /**
   * Take new bounds. A capture already waiting is re-drawn on them; nothing is
   * armed when none was. Returns whether a waiting capture was re-drawn.
   */
  setInterval(next: CaptureInterval): boolean {
    const changed = next.minMs !== this.interval.minMs || next.maxMs !== this.interval.maxMs;
    this.interval = next;
    if (!changed || !this.pending) return false;
    this.scheduleNext();
    return true;
  }
}
