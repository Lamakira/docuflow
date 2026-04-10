/**
 * MultiTabCoordinator — Leader election + cross-tab sync for time tracking.
 *
 * Ensures only ONE tab (the "leader") runs idle timers, screenshot scheduling,
 * and heartbeat. Other tabs become "followers" that receive state updates.
 *
 * Uses BroadcastChannel (fallback: localStorage events for older browsers).
 *
 * Phase 1 Sprint A.2
 */

const CHANNEL_NAME = "docuflow-time-tracking";
const LEADER_KEY = "docuflow-tt-leader";
const LEADER_TTL_MS = 8_000; // leader must heartbeat within this window
const LEADER_HEARTBEAT_MS = 3_000; // how often leader announces itself

export type TabRole = "leader" | "follower";

export type MultiTabMessage =
  | { type: "leader-heartbeat"; tabId: string; timestamp: number }
  | { type: "leader-claim"; tabId: string; timestamp: number }
  | { type: "leader-release"; tabId: string }
  | { type: "state-sync"; payload: TimeTrackingSyncPayload }
  | { type: "activity-ping"; timestamp: number };

export interface TimeTrackingSyncPayload {
  /** Whether the timer is currently running (from leader's perspective) */
  isRunning: boolean;
  /** Whether the timer is paused */
  isPaused: boolean;
  /** Active entry ID or null */
  activeEntryId: string | null;
  /** Active entry's crmProjectId */
  crmProjectId: string | null;
  /** Whether screen capture is on */
  isCapturing: boolean;
  /** Display duration in seconds */
  displayDuration: number;
}

export interface MultiTabCoordinatorOptions {
  onRoleChange: (role: TabRole) => void;
  onStateSync: (payload: TimeTrackingSyncPayload) => void;
  onActivityPing?: () => void;
}

export class MultiTabCoordinator {
  readonly tabId: string;
  private role: TabRole = "follower";
  private channel: BroadcastChannel | null = null;
  private leaderHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private leaderCheckTimer: ReturnType<typeof setInterval> | null = null;
  private options: MultiTabCoordinatorOptions;
  private destroyed = false;
  private useFallback = false;

  constructor(options: MultiTabCoordinatorOptions) {
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.options = options;

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (e) => this.handleMessage(e.data);
    } else {
      // Fallback: localStorage events
      this.useFallback = true;
      window.addEventListener("storage", this.handleStorageEvent);
    }

    // Try to become leader on init
    this.tryClaimLeadership();

    // Periodically check if leader is alive
    this.leaderCheckTimer = setInterval(() => this.checkLeaderAlive(), LEADER_TTL_MS);

    console.log(`[MultiTab] Tab ${this.tabId} initialized`);
  }

  get currentRole(): TabRole {
    return this.role;
  }

  get isLeader(): boolean {
    return this.role === "leader";
  }

  // ─── Messaging ───

  private broadcast(message: MultiTabMessage) {
    if (this.destroyed) return;

    if (this.channel) {
      this.channel.postMessage(message);
    } else if (this.useFallback) {
      // localStorage fallback: write a serialized message
      try {
        localStorage.setItem(
          `${CHANNEL_NAME}-msg`,
          JSON.stringify({ ...message, _ts: Date.now() })
        );
      } catch {
        // localStorage might be full or unavailable
      }
    }
  }

  private handleStorageEvent = (e: StorageEvent) => {
    if (e.key !== `${CHANNEL_NAME}-msg` || !e.newValue) return;
    try {
      const message = JSON.parse(e.newValue) as MultiTabMessage;
      this.handleMessage(message);
    } catch {
      // Ignore malformed messages
    }
  };

  private handleMessage(message: MultiTabMessage) {
    if (this.destroyed) return;

    switch (message.type) {
      case "leader-heartbeat":
        if (message.tabId !== this.tabId && this.role === "leader") {
          // Another leader exists with an earlier claim — yield if they have priority
          // Simple rule: latest heartbeat wins, but existing leader keeps priority
        }
        if (message.tabId !== this.tabId) {
          // There's an active leader that isn't us
          this.setLeaderLock(message.tabId, message.timestamp);
        }
        break;

      case "leader-claim":
        if (message.tabId !== this.tabId) {
          // Another tab is claiming leadership
          if (this.role === "leader") {
            // We're already leader — defend by sending heartbeat
            this.broadcastLeaderHeartbeat();
          }
        }
        break;

      case "leader-release":
        if (message.tabId !== this.tabId) {
          // Leader released — try to claim
          this.tryClaimLeadership();
        }
        break;

      case "state-sync":
        if (this.role === "follower") {
          this.options.onStateSync(message.payload);
        }
        break;

      case "activity-ping":
        this.options.onActivityPing?.();
        break;
    }
  }

  // ─── Leader election ───

  private tryClaimLeadership() {
    if (this.destroyed) return;

    const existing = this.getLeaderLock();

    if (!existing || Date.now() - existing.timestamp > LEADER_TTL_MS) {
      // No leader or leader expired — claim it
      this.becomeLeader();
    } else if (existing.tabId === this.tabId) {
      // We're already leader
      if (this.role !== "leader") {
        this.becomeLeader();
      }
    } else {
      // Another active leader exists
      this.becomeFollower();
    }
  }

  private becomeLeader() {
    if (this.destroyed) return;

    const wasFollower = this.role === "follower";
    this.role = "leader";
    this.setLeaderLock(this.tabId, Date.now());

    // Start heartbeat
    if (this.leaderHeartbeatTimer) clearInterval(this.leaderHeartbeatTimer);
    this.leaderHeartbeatTimer = setInterval(() => {
      this.broadcastLeaderHeartbeat();
    }, LEADER_HEARTBEAT_MS);

    // Announce immediately
    this.broadcastLeaderHeartbeat();

    if (wasFollower) {
      console.log(`[MultiTab] Tab ${this.tabId} → LEADER`);
      this.options.onRoleChange("leader");
    }
  }

  private becomeFollower() {
    if (this.destroyed) return;

    const wasLeader = this.role === "leader";
    this.role = "follower";

    if (this.leaderHeartbeatTimer) {
      clearInterval(this.leaderHeartbeatTimer);
      this.leaderHeartbeatTimer = null;
    }

    if (wasLeader) {
      console.log(`[MultiTab] Tab ${this.tabId} → FOLLOWER`);
      this.options.onRoleChange("follower");
    }
  }

  private broadcastLeaderHeartbeat() {
    const now = Date.now();
    this.setLeaderLock(this.tabId, now);
    this.broadcast({
      type: "leader-heartbeat",
      tabId: this.tabId,
      timestamp: now,
    });
  }

  private checkLeaderAlive() {
    if (this.destroyed) return;

    const existing = this.getLeaderLock();

    if (!existing || Date.now() - existing.timestamp > LEADER_TTL_MS) {
      // Leader is dead or missing — try to claim
      console.log(`[MultiTab] Leader expired, attempting takeover`);
      this.tryClaimLeadership();
    } else if (existing.tabId === this.tabId && this.role !== "leader") {
      // We have the lock but aren't in leader mode
      this.becomeLeader();
    }
  }

  // ─── localStorage lock ───

  private getLeaderLock(): { tabId: string; timestamp: number } | null {
    try {
      const raw = localStorage.getItem(LEADER_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private setLeaderLock(tabId: string, timestamp: number) {
    try {
      localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId, timestamp }));
    } catch {
      // localStorage might be unavailable
    }
  }

  // ─── Public API ───

  /** Leader calls this to sync state to followers */
  broadcastState(payload: TimeTrackingSyncPayload) {
    if (this.role !== "leader") return;
    this.broadcast({ type: "state-sync", payload });
  }

  /** Any tab can broadcast an activity ping (user mouse/keyboard) */
  broadcastActivity() {
    this.broadcast({ type: "activity-ping", timestamp: Date.now() });
  }

  /** Release leadership explicitly (e.g. before unload) */
  releaseLeadership() {
    if (this.role === "leader") {
      this.broadcast({ type: "leader-release", tabId: this.tabId });
      try {
        localStorage.removeItem(LEADER_KEY);
      } catch {
        // ignore
      }
      this.becomeFollower();
    }
  }

  /** Destroy the coordinator (cleanup all timers and listeners) */
  destroy() {
    this.destroyed = true;

    // Release leadership before destroying
    if (this.role === "leader") {
      this.broadcast({ type: "leader-release", tabId: this.tabId });
      try {
        const lock = this.getLeaderLock();
        if (lock?.tabId === this.tabId) {
          localStorage.removeItem(LEADER_KEY);
        }
      } catch {
        // ignore
      }
    }

    if (this.leaderHeartbeatTimer) {
      clearInterval(this.leaderHeartbeatTimer);
      this.leaderHeartbeatTimer = null;
    }
    if (this.leaderCheckTimer) {
      clearInterval(this.leaderCheckTimer);
      this.leaderCheckTimer = null;
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.useFallback) {
      window.removeEventListener("storage", this.handleStorageEvent);
    }

    console.log(`[MultiTab] Tab ${this.tabId} destroyed`);
  }
}
