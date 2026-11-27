import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { userData } = vi.hoisted(() => ({ userData: { dir: "" } }));
// AgentStore imports `electron`: it resolves to desktop-agent's own package when
// installed (local), and stays a bare, unresolved id when not (CI installs the root only).
vi.mock("electron", () => ({ app: { getPath: () => userData.dir } }));
vi.mock("../../desktop-agent/node_modules/electron/index.js", () => ({ app: { getPath: () => userData.dir } }));

import { AGENT_PROTOCOL_VERSION as SERVER_VERSION } from "../../server/agentProtocol";
import { ApiClient } from "../../desktop-agent/src/lib/ApiClient";
import { AgentStore } from "../../desktop-agent/src/lib/AgentStore";
import { SqliteQueue } from "../../desktop-agent/src/lib/SqliteQueue";
import { SyncWorker } from "../../desktop-agent/src/workers/SyncWorker";
import {
  AGENT_PROTOCOL_VERSION,
  UpdateRequiredGate,
} from "../../desktop-agent/src/lib/agentProtocol";

/**
 * #398: the agent declares its protocol version on every request and, once the
 * server refuses it, stops capturing while the queue keeps draining.
 */

type Call = { url: string; method: string; headers: Record<string, string> };

const REFUSAL = {
  code: "protocol_below_minimum",
  message: "Agent protocol is below the minimum supported version",
  minProtocolVersion: 2,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("agent update required (#398)", () => {
  let store: AgentStore;
  let queue: SqliteQueue;
  let calls: Call[];
  let heartbeatOk: boolean;
  let unauthorizedOnce: boolean;

  function ports() {
    return { stopCapture: vi.fn(), startCapture: vi.fn(), save: vi.fn(), changed: vi.fn() };
  }

  function makeClient() {
    const p = ports();
    const gate = new UpdateRequiredGate(p, null);
    const client = new ApiClient(store, undefined, gate);
    return { p, gate, client };
  }

  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-update-required-"));
    store = new AgentStore();
    store.setSession("device-1", "device-token", "Workstation", "member@example.com");
    queue = new SqliteQueue(userData.dir);
    calls = [];
    heartbeatOk = false;
    unauthorizedOnce = false;

    vi.stubGlobal("fetch", async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      const pathname = new URL(url).pathname;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init.headers as Record<string, string>) ?? {})) {
        headers[k.toLowerCase()] = v;
      }
      const method = init.method ?? "GET";
      calls.push({ url, method, headers });

      if (pathname.endsWith("/api/agent/auth/refresh")) {
        return json(200, { accessToken: "t", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
      }
      if (unauthorizedOnce) {
        unauthorizedOnce = false;
        return json(401, { message: "Token expired" });
      }
      if (pathname.endsWith("/api/agent/timer/start")) return json(200, { id: "entry-1" });
      if (pathname.endsWith("/api/agent/events/batch")) {
        const body = JSON.parse(String(init.body));
        return json(200, { ok: true, accepted: body.events.length });
      }
      if (pathname.endsWith("/api/agent/screenshots/presign")) {
        return json(200, {
          screenshotId: "s1",
          uploadURL: "/api/agent/screenshots/upload/s1",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
      if (pathname.includes("/api/agent/screenshots/upload/") && method === "PUT") return json(200, {});
      if (pathname.endsWith("/api/agent/screenshots/confirm")) return json(200, { ok: true });
      if (pathname.endsWith("/api/agent/heartbeat") && heartbeatOk) {
        return json(200, { ok: true, serverTime: new Date().toISOString(), timerSync: null });
      }
      return json(403, REFUSAL);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fs.rmSync(userData.dir, { recursive: true, force: true });
  });

  it("enters update-required on a refused heartbeat and stops capture once", async () => {
    const { p, gate, client } = makeClient();

    await expect(client.sendHeartbeat({ deviceId: "device-1" })).rejects.toMatchObject({
      code: "protocol_below_minimum",
      status: 403,
    });
    expect(gate.state).toEqual({ minProtocolVersion: 2 });
    expect(gate.blocksCapture).toBe(true);
    expect(p.stopCapture).toHaveBeenCalledTimes(1);
    // Saved with the version this build declared, so the next build ignores it.
    expect(p.save).toHaveBeenCalledWith({ minProtocolVersion: 2, declaredProtocolVersion: AGENT_PROTOCOL_VERSION });

    await expect(client.getProjects()).rejects.toMatchObject({ code: "protocol_below_minimum" });
    expect(p.stopCapture).toHaveBeenCalledTimes(1);
  });

  it("keeps draining the queue while refused", async () => {
    const { gate, client } = makeClient();
    await expect(client.sendHeartbeat({ deviceId: "device-1" })).rejects.toBeDefined();
    expect(gate.blocksCapture).toBe(true);

    const shot = path.join(userData.dir, "shot.png");
    fs.writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    queue.enqueueTimerCommand({
      clientCommandId: "11111111-1111-4111-8111-111111111111",
      type: "start",
      entryId: "local-1",
      crmProjectId: "project-1",
      taskId: null,
    });
    queue.enqueue("input_activity", new Date(), { keyCount: 1 });
    queue.enqueue("input_activity", new Date(), { keyCount: 2 });
    queue.enqueueScreenshot(shot, {
      timeEntryId: "entry-1",
      capturedAt: new Date().toISOString(),
      deviceId: "device-1",
    });

    const sync = new SyncWorker(client, queue, store);
    sync.triggerSync();
    try {
      await vi.waitFor(
        () => {
          expect(queue.getPendingTimerCommands()).toHaveLength(0);
          expect(queue.pendingCount()).toBe(0);
          expect(queue.pendingScreenshotCount()).toBe(0);
        },
        { timeout: 5_000 },
      );
    } finally {
      sync.stop();
    }

    const seen = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(seen).toContain("POST /api/agent/timer/start");
    expect(seen).toContain("POST /api/agent/events/batch");
    expect(seen).toContain("POST /api/agent/screenshots/presign");
    expect(seen).toContain("PUT /api/agent/screenshots/upload/s1");
    expect(seen).toContain("POST /api/agent/screenshots/confirm");
  });

  it("declares the protocol version on every request, including refresh and the PUT upload", async () => {
    const { client } = makeClient();
    await client.startTimer("project-1");
    await client.sendEventsBatch({ events: [] });
    await client.uploadScreenshot("/api/agent/screenshots/upload/s1", Buffer.from([1]));
    await client.getProjects().catch(() => {});

    const paths = calls.map((c) => new URL(c.url).pathname);
    expect(paths).toContain("/api/agent/auth/refresh");
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
    expect(calls.length).toBeGreaterThan(4);
    for (const c of calls) {
      expect(c.headers["x-agent-protocol-version"], `${c.method} ${c.url}`).toBe("1");
    }
  });

  it("does not send the header to a third-party presigned URL", async () => {
    const { client } = makeClient();
    await client.uploadScreenshot("https://bucket.example.com/put/s1", Buffer.from([1])).catch(() => {}); // the fake answers 403
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers["x-agent-protocol-version"]).toBeUndefined();
  });

  it("still enters update-required when the refusal arrives on the retry after a 401", async () => {
    const { p, gate, client } = makeClient();
    unauthorizedOnce = true;

    await expect(client.getProjects()).rejects.toMatchObject({ code: "protocol_below_minimum", status: 403 });
    expect(calls.filter((c) => c.url.endsWith("/api/agent/auth/refresh"))).toHaveLength(2);
    expect(gate.state).toEqual({ minProtocolVersion: 2 });
    expect(p.stopCapture).toHaveBeenCalledTimes(1);
  });

  it("clears on a successful heartbeat and restarts capture once", async () => {
    const { p, gate, client } = makeClient();
    await expect(client.sendHeartbeat({ deviceId: "device-1" })).rejects.toBeDefined();
    expect(gate.blocksCapture).toBe(true);

    heartbeatOk = true;
    await client.sendHeartbeat({ deviceId: "device-1" });
    expect(gate.state).toBeNull();
    expect(p.startCapture).toHaveBeenCalledTimes(1);
    expect(p.save).toHaveBeenLastCalledWith(null);

    await client.sendHeartbeat({ deviceId: "device-1" });
    expect(p.startCapture).toHaveBeenCalledTimes(1);
  });

  it("starts blocked from a saved state, and reset() clears without restarting capture", () => {
    const p = ports();
    const gate = new UpdateRequiredGate(p, { minProtocolVersion: 3, declaredProtocolVersion: AGENT_PROTOCOL_VERSION });
    expect(gate.blocksCapture).toBe(true);
    expect(gate.state).toEqual({ minProtocolVersion: 3 });

    gate.reset();
    expect(gate.state).toBeNull();
    expect(p.startCapture).not.toHaveBeenCalled();
    expect(p.save).not.toHaveBeenCalled();
  });

  it("ignores a state saved by a build that declared another version, so the updated agent starts unblocked", () => {
    const p = ports();
    // The refused build declared 1; the installed one declares 2 and finds the old file.
    const updated = new UpdateRequiredGate(p, { minProtocolVersion: 2, declaredProtocolVersion: 1 }, 2);
    expect(updated.blocksCapture).toBe(false);
    expect(updated.state).toBeNull();

    // A file written before the version was saved alongside the state.
    const legacy = new UpdateRequiredGate(p, { minProtocolVersion: 2 } as never);
    expect(legacy.blocksCapture).toBe(false);
  });

  it("persists the state across a new AgentStore and clearSession resets it", () => {
    expect(store.getUpdateRequired()).toBeNull();
    const saved = { minProtocolVersion: 2, declaredProtocolVersion: AGENT_PROTOCOL_VERSION };
    store.setUpdateRequired(saved);
    expect(new AgentStore().getUpdateRequired()).toEqual(saved);

    store.clearSession();
    expect(store.getUpdateRequired()).toBeNull();
    expect(new AgentStore().getUpdateRequired()).toBeNull();
  });

  it("declares the same protocol version as the server", () => {
    expect(AGENT_PROTOCOL_VERSION).toBe(SERVER_VERSION);
  });
});
