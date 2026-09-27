/**
 * Tracking Policy as the Device holds it (#293).
 *
 * Every heartbeat answer carries the Workspace's Tracking Policy. The Device
 * reads active hours on its own clock, and keeps the last policy it received so
 * a start without the server applies that rather than hard-coded defaults.
 *
 * No Node or Electron imports: the renderer reads the copy helpers below.
 */

export interface TrackingPolicy {
  screenshotsEnabled: boolean;
  captureIntervalMinMin: number;
  captureIntervalMaxMin: number;
  activeHoursEnabled: boolean;
  /** "HH:mm", Device local clock. */
  activeHoursStart: string;
  /** "HH:mm", Device local clock. Earlier than the start means the window spans midnight. */
  activeHoursEnd: string;
  /** Ask the Member (with a countdown) before the idle pause. Off pauses without asking. */
  idlePromptEnabled: boolean;
  /** Minutes without input before the Timer pauses (1–60). */
  idleTimeoutMinutes: number;
  /** Seconds the idle prompt counts down before the Timer pauses (15–120). */
  idleCountdownSeconds: number;
}

/** Mirrors the server's DEFAULT_SCREENSHOT_POLICY. Used only when no policy was ever received. */
export const DEFAULT_TRACKING_POLICY: TrackingPolicy = {
  screenshotsEnabled: true,
  captureIntervalMinMin: 3,
  captureIntervalMaxMin: 5,
  activeHoursEnabled: false,
  activeHoursStart: "08:00",
  activeHoursEnd: "18:00",
  idlePromptEnabled: true,
  idleTimeoutMinutes: 10,
  idleCountdownSeconds: 60,
};

/** Where the policy in force came from: this run's heartbeat, the copy on disk, or the defaults. */
export type TrackingPolicySource = "server" | "saved" | "default";

export interface TrackingPolicyStatus {
  source: TrackingPolicySource;
  /** When the policy in force was received from the server (ISO), null for defaults. */
  receivedAt: string | null;
  /** First failure of the current failed-refresh streak (ISO); null once a refresh succeeds. */
  refreshFailedAt: string | null;
  refreshError: string | null;
}

export interface SavedTrackingPolicy {
  policy: TrackingPolicy;
  receivedAt: string;
}

/** Minutes since midnight for a 24-hour "HH:mm", or null for anything else. */
export function clockMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether `at`, on the Device's local clock, is inside the active-hours window.
 * A start later than the end spans midnight (22:00–06:00). The same start and
 * end, or a window the Device cannot read, restricts nothing.
 */
export function isWithinActiveHours(
  policy: Pick<TrackingPolicy, "activeHoursEnabled" | "activeHoursStart" | "activeHoursEnd">,
  at: Date,
): boolean {
  if (!policy.activeHoursEnabled) return true;
  const start = clockMinutes(policy.activeHoursStart);
  const end = clockMinutes(policy.activeHoursEnd);
  if (start === null || end === null || start === end) return true;
  const now = at.getHours() * 60 + at.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * Read a policy from a heartbeat answer or the saved file. Each field the value
 * gets wrong keeps `fallback`'s; anything that is not an object is refused.
 */
export function normalizeTrackingPolicy(
  raw: unknown,
  fallback: TrackingPolicy = DEFAULT_TRACKING_POLICY,
): TrackingPolicy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const bool = (key: keyof TrackingPolicy) =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : (fallback[key] as boolean);
  const num = (key: keyof TrackingPolicy) =>
    typeof value[key] === "number" && Number.isFinite(value[key])
      ? (value[key] as number)
      : (fallback[key] as number);
  const str = (key: keyof TrackingPolicy) =>
    typeof value[key] === "string" ? (value[key] as string) : (fallback[key] as string);
  return {
    screenshotsEnabled: bool("screenshotsEnabled"),
    captureIntervalMinMin: num("captureIntervalMinMin"),
    captureIntervalMaxMin: num("captureIntervalMaxMin"),
    activeHoursEnabled: bool("activeHoursEnabled"),
    activeHoursStart: str("activeHoursStart"),
    activeHoursEnd: str("activeHoursEnd"),
    idlePromptEnabled: bool("idlePromptEnabled"),
    idleTimeoutMinutes: num("idleTimeoutMinutes"),
    idleCountdownSeconds: num("idleCountdownSeconds"),
  };
}

/** The policy a start applies before its first heartbeat: the saved one, else the defaults. */
export function startupTrackingPolicy(
  saved: SavedTrackingPolicy | null,
  defaults: TrackingPolicy,
): { policy: TrackingPolicy; status: TrackingPolicyStatus } {
  if (saved) {
    return {
      policy: saved.policy,
      status: { source: "saved", receivedAt: saved.receivedAt, refreshFailedAt: null, refreshError: null },
    };
  }
  return {
    policy: defaults,
    status: { source: "default", receivedAt: null, refreshFailedAt: null, refreshError: null },
  };
}

/** Idle countdown bounds, mirroring the server's 15–120 s. */
export function idleCountdownSeconds(policy: Pick<TrackingPolicy, "idleCountdownSeconds">): number {
  return Math.max(15, Math.min(120, Math.round(policy.idleCountdownSeconds)));
}

// ─── Settings copy (shared by both desktop UIs) ───

/** What happens when the Member goes idle, in one line. */
export function idleBehaviourCopy(
  policy: Pick<TrackingPolicy, "idlePromptEnabled" | "idleTimeoutMinutes" | "idleCountdownSeconds">,
): string {
  const after = `After ${policy.idleTimeoutMinutes} min without input`;
  return policy.idlePromptEnabled
    ? `${after}, asks whether you are still working and pauses the Timer if you do not answer within ${idleCountdownSeconds(policy)} s.`
    : `${after}, pauses the Timer without asking. Resume it when you are back.`;
}

export type TrackingPolicyOrigin = "workspace" | "saved" | "default";

/**
 * Which Tracking Policy is in force, from the Member's point of view. A policy
 * received this session whose later refresh failed is a saved copy too.
 * `null` (nothing loaded yet) reads as the built-in defaults.
 */
export function trackingPolicyOrigin(status: TrackingPolicyStatus | null | undefined): TrackingPolicyOrigin {
  if (!status?.receivedAt || status.source === "default") return "default";
  if (status.source === "saved" || status.refreshFailedAt) return "saved";
  return "workspace";
}

/** One quiet line naming the Tracking Policy source and when it was received. */
export function policySourceCopy(status: TrackingPolicyStatus | null | undefined, now: Date = new Date()): string {
  const origin = trackingPolicyOrigin(status);
  if (origin === "default") return "Built-in defaults — no policy received yet";
  const when = formatReceivedAt(new Date(status!.receivedAt!), now);
  return origin === "saved" ? `Saved copy from ${when} (offline)` : `From your Workspace, received ${when}`;
}

/** The same source in two or three words, for a list caption. */
export function policySourceLabel(status: TrackingPolicyStatus | null | undefined): string {
  const origin = trackingPolicyOrigin(status);
  if (origin === "default") return "Built-in defaults";
  return origin === "saved" ? "Saved copy (offline)" : "From your Workspace";
}

function formatReceivedAt(at: Date, now: Date): string {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? time : `${at.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}
