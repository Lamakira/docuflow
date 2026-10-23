import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { timerSyncApplies } from "../../desktop-agent/src/lib/timerResync";
import { SqliteQueue } from "../../desktop-agent/src/lib/SqliteQueue";

describe("timerSyncApplies", () => {
  it("is blocked while a timer command is pending", () => {
    expect(
      timerSyncApplies({ requestedAtMono: 2000, pendingCommands: 1, lastCommandSyncedMono: null }),
    ).toBe(false);
  });

  it("drops a snapshot requested before the last command synced", () => {
    expect(
      timerSyncApplies({ requestedAtMono: 1000, pendingCommands: 0, lastCommandSyncedMono: 2000 }),
    ).toBe(false);
  });

  it("drops a snapshot requested at the very instant the last command synced", () => {
    expect(
      timerSyncApplies({ requestedAtMono: 2000, pendingCommands: 0, lastCommandSyncedMono: 2000 }),
    ).toBe(false);
  });

  it("applies a snapshot requested after the last command synced", () => {
    expect(
      timerSyncApplies({ requestedAtMono: 2001, pendingCommands: 0, lastCommandSyncedMono: 2000 }),
    ).toBe(true);
  });

  it("applies when no command ever synced", () => {
    expect(
      timerSyncApplies({ requestedAtMono: 1, pendingCommands: 0, lastCommandSyncedMono: null }),
    ).toBe(true);
  });
});

describe("SqliteQueue.lastTimerCommandSyncedMono", () => {
  const PAUSE_ID = "aaaaaaaa-pause";
  const STOP_ID = "bbbbbbbb-stop";
  const ENTRY_ID = "e1";
  let dir: string;
  let queue: SqliteQueue;
  afterEach(() => {
    queue.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is null before any sync and increases as commands are marked synced", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-"));
    queue = new SqliteQueue(dir);
    expect(queue.lastTimerCommandSyncedMono()).toBeNull();

    queue.enqueueTimerCommand({ clientCommandId: PAUSE_ID, type: "pause", entryId: ENTRY_ID });
    queue.enqueueTimerCommand({ clientCommandId: STOP_ID, type: "stop", entryId: ENTRY_ID });
    expect(queue.lastTimerCommandSyncedMono()).toBeNull();

    const before = performance.now();
    queue.markTimerCommandSynced(PAUSE_ID);
    const afterFirst = queue.lastTimerCommandSyncedMono();
    expect(afterFirst).toBeGreaterThanOrEqual(before);
    queue.markTimerCommandSynced(STOP_ID);
    expect(queue.lastTimerCommandSyncedMono()).toBeGreaterThanOrEqual(afterFirst!);
  });
});
