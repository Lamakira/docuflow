/**
 * Heartbeat worker — sends periodic heartbeats to the server.
 *
 * Interval: 60 seconds.
 * Includes deviceId, active time entry, and client info.
 *
 * Phase 3 MVP
 */

import { app } from "electron";
import { ApiClient } from "../lib/ApiClient";
import { AgentStore } from "../lib/AgentStore";
const HEARTBEAT_INTERVAL_MS = 60_000;

type TimerSyncCallback = (
  sync: {
    entryId: string;
    status: string;
    duration: number;
    taskId?: string | null;
    lastActivityAt?: string | null;
    projectName?: string | null;
    taskName?: string | null;
    startTime?: string | null;
  } | null
) => void;

/** The raw Tracking Policy from the heartbeat answer; main validates it. */
type PolicySyncCallback = (policy: unknown) => void;
/** The heartbeat failed, or answered without a Tracking Policy. */
type PolicyRefreshFailedCallback = (message: string) => void;

export class HeartbeatWorker {
  private apiClient: ApiClient;
  private store: AgentStore;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onTimerSync: TimerSyncCallback | null;
  private onPolicySync: PolicySyncCallback | null;
  private onPolicyRefreshFailed: PolicyRefreshFailedCallback | null;

  constructor(
    apiClient: ApiClient,
    store: AgentStore,
    onTimerSync?: TimerSyncCallback,
    onPolicySync?: PolicySyncCallback,
    onPolicyRefreshFailed?: PolicyRefreshFailedCallback
  ) {
    this.apiClient = apiClient;
    this.store = store;
    this.onTimerSync = onTimerSync ?? null;
    this.onPolicySync = onPolicySync ?? null;
    this.onPolicyRefreshFailed = onPolicyRefreshFailed ?? null;
  }

  start(): void {
    if (this.interval) return;

    // Initial heartbeat after short delay
    setTimeout(() => this.sendHeartbeat(), 2000);
    this.interval = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    console.log("[HeartbeatWorker] Started (60s interval)");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log("[HeartbeatWorker] Stopped");
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const deviceId = this.store.getDeviceId();
      if (!deviceId) return;

      const result = await this.apiClient.sendHeartbeat({
        deviceId,
        timeEntryId: this.store.getActiveEntryId(),
        timestamp: new Date().toISOString(),
        clientType: "electron",
        clientVersion: this.store.getClientVersion(),
      });

      console.log(`[HeartbeatWorker] OK (server: ${result.serverTime})`);

      // Keep lastActivityAt fresh so orphan reconciliation after a crash is accurate
      this.store.touchActivity();

      // Propagate server's authoritative timer state for immediate resync
      if (this.onTimerSync && "timerSync" in result) {
        this.onTimerSync(result.timerSync ?? null);
      }

      // Propagate full policy (screenshot + idle) so workers update without restart
      const policy = (result as any).screenshotPolicy;
      if (policy) {
        this.onPolicySync?.(policy);
      } else {
        this.onPolicyRefreshFailed?.("The heartbeat answer carried no Tracking Policy");
      }
    } catch (error: any) {
      console.error("[HeartbeatWorker] Failed:", error.message);
      this.onPolicyRefreshFailed?.(error.message ?? "Heartbeat failed");
    }
  }
}
