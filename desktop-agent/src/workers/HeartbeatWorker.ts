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
import type { ScreenshotPolicyPayload } from "./ScreenCaptureWorker";

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

type PolicySyncCallback = (policy: ScreenshotPolicyPayload) => void;

export class HeartbeatWorker {
  private apiClient: ApiClient;
  private store: AgentStore;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onTimerSync: TimerSyncCallback | null;
  private onPolicySync: PolicySyncCallback | null;

  constructor(
    apiClient: ApiClient,
    store: AgentStore,
    onTimerSync?: TimerSyncCallback,
    onPolicySync?: PolicySyncCallback
  ) {
    this.apiClient = apiClient;
    this.store = store;
    this.onTimerSync = onTimerSync ?? null;
    this.onPolicySync = onPolicySync ?? null;
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
      if (this.onPolicySync && (result as any).screenshotPolicy) {
        this.onPolicySync((result as any).screenshotPolicy as ScreenshotPolicyPayload);
      }
    } catch (error: any) {
      console.error("[HeartbeatWorker] Failed:", error.message);
    }
  }
}
