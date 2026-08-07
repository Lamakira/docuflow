/**
 * API client for communicating with the DocuFlow server.
 *
 * All requests target API_BASE (config.ts). No server URL is stored locally
 * or passed by the user — the API endpoint is baked in at build time and
 * can be overridden via DOCUFLOW_API_URL at runtime.
 *
 * Handles access token refresh, request retry with exponential backoff,
 * and proper error classification (network vs auth vs server).
 */

import { AgentStore } from "./AgentStore";
import { API_BASE } from "./config";

interface LoginResult {
  deviceId: string;
  deviceToken: string;
  accessToken: string;
  expiresAt: string;
  user: { id: string; email: string; firstName: string | null; lastName: string | null };
}

interface DeviceMeta {
  deviceName: string;
  os?: string;
  clientVersion?: string;
}

export interface TimeEntry {
  id: string;
  userId: string;
  crmProjectId: string;
  taskId?: string | null;
  description: string | null;
  startTime: string;
  endTime: string | null;
  status: "running" | "paused" | "stopped";
  duration: number;
  idleTime: number;
  lastActivityAt: string | null;
  // Enriched by /api/agent/timer/active
  projectName?: string | null;
  taskName?: string | null;
  // Returned by /api/agent/timer/start: total stopped duration for this task today (seconds).
  // Used to seed the elapsed display so Task A shows 30:00 when restarted, not 0:00.
  taskAccumulatedToday?: number;
}

export interface CrmProjectSummary {
  id: string;
  name: string;
  status: string;
}

export interface TaskSummary {
  id: string;
  name: string;
  status: string;
  crmProjectId?: string;
  durationToday?: number;
}

export class ApiClient {
  private store: AgentStore;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  /** Called when the server signals the device is revoked or permanently invalid. */
  private onRevoke: (() => void) | null;

  constructor(store: AgentStore, onRevoke?: () => void) {
    this.store = store;
    this.onRevoke = onRevoke ?? null;
  }

  // ─── Authentication ───

  /**
   * Poll the backend until it returns JSON, or until maxWaitMs elapses.
   * Handles Replit cold-start (sleeping server → 200 HTML wake page).
   *
   * Probe order:
   *   1. GET /api/auth/user — confirmed JSON on all deployed versions
   *      (returns null for unauthenticated requests, but is valid JSON)
   *   2. GET /api/ping  — dedicated readiness endpoint (new deployments)
   *
   * 4xx on BOTH probes = URL is wrong → fail immediately (no retry).
   * 200 HTML = server waking up → keep retrying.
   */
  async waitForBackend(
    onProgress?: (msg: string) => void,
    maxWaitMs = 60_000
  ): Promise<void> {
    const deadline = Date.now() + maxWaitMs;

    while (true) {
      const elapsed = Math.round((maxWaitMs - (deadline - Date.now())) / 1000);

      const probeResult = await this.probeBackend();
      console.log(`[ApiClient] probe: ${JSON.stringify(probeResult)}`);

      if (probeResult.ready) return; // ✅ server is up

      if (probeResult.permanentError) {
        throw new Error(probeResult.permanentError);
      }

      // Server not ready yet (cold-start HTML page or 5xx) — wait and retry
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          "Server did not respond after 60 seconds. " +
          "Please check your network connection and try again."
        );
      }
      onProgress?.(
        elapsed < 4 ? "Connecting to server…" : `Server is starting… (${elapsed}s)`
      );
      await new Promise(r => setTimeout(r, Math.min(3_000, remaining)));
    }
  }

  /** Single probe attempt against /api/auth/user then /api/ping. */
  private async probeBackend(): Promise<{
    ready: boolean;
    permanentError?: string;
  }> {
    const endpoints = [
      "/api/auth/user", // confirmed JSON on all deployed versions (returns null for unauthed)
      "/api/ping",      // dedicated readiness endpoint (new deployments only)
    ];

    let anyNon4xx = false; // tracks whether any probe got a server response (not dead URL)

    for (const path of endpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8_000);
        try {
          const res = await fetch(`${API_BASE}${path}`, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
          const ct = res.headers.get("content-type") ?? "";
          console.log(`[ApiClient] probe ${path}: status=${res.status} ct=${ct.split(";")[0]}`);

          if (res.ok && ct.includes("application/json")) {
            return { ready: true }; // ✅ server is up and this endpoint returns JSON
          }

          if (res.status < 400 || res.status >= 500) {
            // 200 HTML (cold-start wake page) or 5xx → server is reachable but not ready
            anyNon4xx = true;
          }
          // In all non-JSON cases: try the next endpoint
          continue;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        // Network error or timeout on this probe → try next
        continue;
      }
    }

    // All probes exhausted without a JSON response.
    if (!anyNon4xx) {
      // Every probe returned 4xx → URL is wrong (dead deployment, changed URL)
      return {
        ready: false,
        permanentError:
          "Server not found (URL may have changed). " +
          "Check your Replit project URL or create ~/.docuflow-url with the correct URL.",
      };
    }

    // Server is reachable but returning HTML — still starting up
    return { ready: false };
  }

  async loginWithPassword(email: string, password: string, meta: DeviceMeta): Promise<LoginResult> {
    const res = await this.rawFetch(`${API_BASE}/api/agent/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password, deviceMeta: meta }),
    });

    if (!res.ok) {
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error(`Server error (HTTP ${res.status}). Check your network connection.`);
      }
      const data = await res.json().catch(() => ({ message: res.statusText }));
      if (res.status === 401) throw new Error("Invalid email or password");
      throw new Error(data.message || "Sign in failed");
    }

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      // Server is running (probe passed) but login endpoint returned HTML.
      // The deployed server code does not include the S4 auth route.
      throw new Error(
        "Login API not available on this server. " +
        "Please pull the latest code and redeploy the DocuFlow server."
      );
    }
    const result: LoginResult = await res.json();
    this.accessToken = result.accessToken;
    this.tokenExpiresAt = new Date(result.expiresAt).getTime();
    return result;
  }

  // ─── Timer control ───

  async getActiveEntry(): Promise<TimeEntry | null> {
    return this.authenticatedRequest("/api/agent/timer/active", { method: "GET" });
  }

  async getProjects(): Promise<CrmProjectSummary[]> {
    const res = await this.authenticatedRequest("/api/agent/projects", { method: "GET" });
    return res?.data ?? [];
  }

  async createProject(name: string): Promise<CrmProjectSummary> {
    return this.authenticatedRequest("/api/agent/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async getTasks(crmProjectId: string): Promise<TaskSummary[]> {
    const res = await this.authenticatedRequest(
      `/api/agent/tasks?crmProjectId=${encodeURIComponent(crmProjectId)}`,
      { method: "GET" }
    );
    return res?.data ?? [];
  }

  async createTask(crmProjectId: string, name: string): Promise<TaskSummary> {
    // Agent-authenticated endpoint (Bearer). The web `/api/tasks` route uses
    // cookie/session auth and returns 401 for the desktop agent.
    return this.authenticatedRequest("/api/agent/tasks", {
      method: "POST",
      body: JSON.stringify({ crmProjectId, name }),
    });
  }

  /** Mirrors web `GET /api/time-tracking/capabilities` — whether `taskId` is mandatory on timer start. */
  async getAgentCapabilities(): Promise<{ requiresTask: boolean }> {
    return this.authenticatedRequest("/api/agent/capabilities", { method: "GET" });
  }

  async startTimer(crmProjectId: string, taskId?: string, description?: string, clientCommandId?: string): Promise<TimeEntry> {
    return this.authenticatedRequest("/api/agent/timer/start", {
      method: "POST",
      body: JSON.stringify({
        crmProjectId,
        taskId: taskId || null,
        description: description || null,
        deviceId: this.store.getDeviceId(),
        clientType: "desktop",
        clientVersion: this.store.getClientVersion(),
        ...(clientCommandId ? { clientCommandId } : {}),
      }),
    });
  }

  async pauseTimer(entryId: string): Promise<TimeEntry> {
    return this.authenticatedRequest(`/api/agent/timer/${entryId}/pause`, {
      method: "POST",
      body: JSON.stringify({
        deviceId: this.store.getDeviceId(),
        clientType: "desktop",
        clientVersion: this.store.getClientVersion(),
      }),
    });
  }

  async resumeTimer(entryId: string): Promise<TimeEntry> {
    return this.authenticatedRequest(`/api/agent/timer/${entryId}/resume`, {
      method: "POST",
      body: JSON.stringify({
        deviceId: this.store.getDeviceId(),
        clientType: "desktop",
        clientVersion: this.store.getClientVersion(),
      }),
    });
  }

  async stopTimer(entryId: string): Promise<TimeEntry> {
    return this.authenticatedRequest(`/api/agent/timer/${entryId}/stop`, {
      method: "POST",
      body: JSON.stringify({
        deviceId: this.store.getDeviceId(),
        clientType: "desktop",
        clientVersion: this.store.getClientVersion(),
      }),
    });
  }

  async getWorkedToday(): Promise<number> {
    // Use local midnight so "today" matches the user's clock, not the server's UTC timezone
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const data = await this.authenticatedRequest(
      `/api/agent/worked-today?start=${encodeURIComponent(startOfDay.toISOString())}&end=${encodeURIComponent(endOfDay.toISOString())}`,
      { method: "GET" }
    );
    return data?.total ?? 0;
  }

  async getWorkedPeriod(start: Date, end: Date): Promise<number> {
    const data = await this.authenticatedRequest(
      `/api/agent/worked-today?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
      { method: "GET" }
    );
    return data?.total ?? 0;
  }

  async getTodayBreakdown(): Promise<Array<{
    projectName: string;
    taskId: string | null;
    taskName: string | null;
    stoppedSeconds: number;
  }>> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const data = await this.authenticatedRequest(
      `/api/agent/today-breakdown?start=${encodeURIComponent(startOfDay.toISOString())}&end=${encodeURIComponent(endOfDay.toISOString())}`,
      { method: "GET" }
    );
    return data?.rows ?? [];
  }

  // ─── Screenshots ───

  async presignScreenshot(data: {
    deviceId: string;
    timeEntryId: string;
    capturedAt: string;
    clientType: string;
    clientVersion: string;
    keyboardActivityPercent?: number | null;
    mouseActivityPercent?: number | null;
    keyboardCount?: number | null;
    mouseCount?: number | null;
  }): Promise<{ screenshotId: string; uploadURL: string; expiresAt: string }> {
    return this.authenticatedRequest("/api/agent/screenshots/presign", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Upload raw image binary to the upload endpoint (PUT, with auth for server-side uploads). */
  async uploadScreenshot(uploadURL: string, imageBuffer: Buffer): Promise<void> {
    // If the URL is relative (server-side upload endpoint), make it absolute
    const fullURL = uploadURL.startsWith("http") ? uploadURL : `${API_BASE}${uploadURL}`;

    // Server-side upload endpoint requires Bearer token
    const isServerUpload = !uploadURL.startsWith("http") || uploadURL.startsWith(API_BASE);
    const headers: Record<string, string> = { "Content-Type": "image/png" };
    if (isServerUpload) {
      await this.ensureAccessToken();
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(fullURL, { method: "PUT", headers, body: imageBuffer as unknown as BodyInit });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`Screenshot upload failed: ${res.status} — ${body.message ?? res.statusText}`);
    }
  }

  async confirmScreenshot(data: {
    screenshotId: string;
    deviceId: string;
  }): Promise<{ ok: boolean }> {
    return this.authenticatedRequest("/api/agent/screenshots/confirm", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ─── Heartbeat & Events ───

  async sendHeartbeat(data: Record<string, unknown>): Promise<{
    ok: boolean;
    serverTime: string;
    timerSync?: {
      entryId: string;
      status: string;
      duration: number;
      taskId?: string | null;
      lastActivityAt?: string | null;
      projectName?: string | null;
      taskName?: string | null;
    } | null;
  }> {
    return this.authenticatedRequest("/api/agent/heartbeat", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async sendEventsBatch(data: Record<string, unknown>): Promise<{ ok: boolean; accepted: number; duplicate?: boolean }> {
    return this.authenticatedRequest("/api/agent/events/batch", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ─── Internal ───

  private async authenticatedRequest(path: string, init: RequestInit): Promise<any> {
    await this.ensureAccessToken();

    const res = await this.rawFetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...((init.headers as Record<string, string>) ?? {}),
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (res.status === 401) {
      // Token expired — refresh and retry once.
      this.accessToken = null;
      await this.ensureAccessToken();

      const retry = await this.rawFetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          ...((init.headers as Record<string, string>) ?? {}),
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!retry.ok) {
        const data = await retry.json().catch(() => ({ message: retry.statusText }));
        throw new Error(data.message || `Request failed: ${retry.status}`);
      }
      return retry.json().catch(() => null);
    }

    if (res.status === 403) {
      const data = await res.json().catch(() => ({ message: res.statusText }));
      const msg = data.message || `Request failed: ${res.status}`;
      // 403 means two different things on these routes: the device was revoked,
      // or this user is not a member of the project being asked about. Treating
      // every 403 as revocation signed the user out the moment they touched a
      // project they do not belong to — one GET /api/agent/tasks was enough.
      // The revocation responses carry `code: "device_revoked"`; the message
      // check keeps older servers working.
      if (data.code === 'device_revoked' || /device has been revoked/i.test(msg)) {
        console.log(`[ApiClient] Device revoked (403): ${msg}`);
        this.onRevoke?.();
      } else {
        // The path is the whole diagnosis: "Access denied" is the same sentence
        // from three different routes, and a log without it says a refusal
        // happened somewhere. Query included — the denial is about that project.
        console.log(`[ApiClient] Forbidden (403, not a revocation): ${init.method ?? 'GET'} ${path} — ${msg}`);
      }
      throw new Error(msg);
    }

    if (!res.ok) {
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error(`Server error (HTTP ${res.status}). Please try again.`);
      }
      const data = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(data.message || `Request failed: ${res.status}`);
    }

    return res.json().catch(() => null);
  }

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return;
    }

    const deviceId = this.store.getDeviceId();
    const deviceToken = this.store.getDeviceToken();

    if (!deviceId || !deviceToken) {
      throw new Error("Not signed in — cannot refresh access token");
    }

    const res = await this.rawFetch(`${API_BASE}/api/agent/auth/refresh`, {
      method: "POST",
      body: JSON.stringify({ deviceId, deviceToken }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: "Token refresh failed" }));
      const msg = data.message || "Token refresh failed";
      console.log(`[ApiClient] auth.refresh.failed: ${msg} (status ${res.status})`);
      if (res.status === 401 || res.status === 403) {
        this.onRevoke?.();
      }
      throw new Error(msg);
    }

    const { accessToken, expiresAt } = await res.json();
    this.accessToken = accessToken;
    this.tokenExpiresAt = new Date(expiresAt).getTime();
    console.log("[ApiClient] auth.refresh.success");
  }

  private async rawFetch(url: string, init: RequestInit, retries = 3): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetch(url, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            ...((init.headers as Record<string, string>) ?? {}),
          },
        });
      } catch (error) {
        if (attempt === retries) throw error;
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error("Unreachable");
  }
}
