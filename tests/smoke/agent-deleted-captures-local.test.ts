import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { userData } = vi.hoisted(() => ({ userData: { dir: "" } }));
vi.mock("electron", () => ({ app: { getPath: () => userData.dir } }));
vi.mock("../../desktop-agent/node_modules/electron/index.js", () => ({ app: { getPath: () => userData.dir } }));

import { ApiClient } from "../../desktop-agent/src/lib/ApiClient";
import { AgentStore } from "../../desktop-agent/src/lib/AgentStore";
import { removeDeletedCaptures } from "../../desktop-agent/src/lib/deletedCaptures";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("removeDeletedCaptures", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deleted-captures-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function put(name: string, capturedAt?: string) {
    fs.writeFileSync(path.join(dir, `${name}.png`), "png");
    if (capturedAt) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ capturedAt }));
  }

  it("removes only the capture denoting the same instant", async () => {
    put("screenshot-1", "2026-11-01T10:00:00.000Z");
    put("screenshot-2", "2026-11-01T11:00:00.000Z");
    put("screenshot-3");
    const n = await removeDeletedCaptures(dir, [{ capturedAt: "2026-11-01T10:00:00.000+00:00" }]);
    expect(n).toBe(1);
    expect(fs.readdirSync(dir).sort()).toEqual(["screenshot-2.json", "screenshot-2.png", "screenshot-3.png"]);
  });

  it("returns 0 for a missing directory", async () => {
    expect(await removeDeletedCaptures(path.join(dir, "nope"), [{ capturedAt: "2026-11-01T10:00:00Z" }])).toBe(0);
  });
});

describe("ApiClient.getDeletedScreenshots", () => {
  let client: ApiClient;
  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "deleted-captures-api-"));
    const store = new AgentStore();
    client = new ApiClient(store);
    (client as any).ensureAccessToken = async () => {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(userData.dir, { recursive: true, force: true });
  });

  const since = new Date("2026-11-01T00:00:00Z");

  it("returns the list on 200", async () => {
    const list = [{ id: "a", capturedAt: "2026-11-02T00:00:00.000Z" }];
    const fetchMock = vi.fn(async () => json(200, { data: list }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await client.getDeletedScreenshots(since)).toEqual(list);
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toContain(
      `/api/agent/screenshots/deleted?since=${encodeURIComponent(since.toISOString())}`
    );
  });

  it("returns [] on 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { message: "Not found" })));
    expect(await client.getDeletedScreenshots(since)).toEqual([]);
  });

  it("rejects on 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, { message: "boom" })));
    await expect(client.getDeletedScreenshots(since)).rejects.toThrow();
  });
});
