import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 6 ticket #117: Timer Commands ingest new timer work (ADR-0009, Spec #112).
 * HTTP is not this suite — the Time module interface is the seam. Characterization
 * stays green unless an HTTP contract actually changes.
 */

async function seedTrackableWork() {
  const { storage } = await import("../../server/storage");
  const user = await storage.createUser({
    email: "timer@test.invalid",
    password: "not-a-real-hash",
    firstName: "Timer",
  });
  return inSeededWorkspace(async () => {
    const { crmProject } = await storage.createCrmProjectWithBase({
      name: "Atlas",
      ownerId: user.id,
    });
    const task = await storage.createTask({
      crmProjectId: crmProject.id,
      name: "Ledger rebuild",
    });
    return { storage, user, crmProject, task };
  });
}

describe("Timer Command application", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("applies two commands with the same origin and sequence once", async () => {
    const { user, crmProject, task } = await seedTrackableWork();
    const { applyTimerCommand, listTimerCommands } = await import(
      "../../server/modules/time/commands"
    );
    const { MissingWorkspaceContextError } = await import("../../server/workspaceContext");

    await expect(
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T10:00:00.000Z"),
        payload: { crmProjectId: crmProject.id, taskId: task.id },
      })
    ).rejects.toThrow(MissingWorkspaceContextError);

    const first = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T10:00:00.000Z"),
        payload: {
          crmProjectId: crmProject.id,
          taskId: task.id,
          description: "First pass",
        },
      })
    );
    const second = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T11:00:00.000Z"),
        payload: {
          crmProjectId: crmProject.id,
          taskId: task.id,
          description: "Ignored duplicate",
        },
      })
    );

    expect(second.duplicate).toBe(true);
    expect(second.command.id).toBe(first.command.id);
    expect(second.timeEntry?.id).toBe(first.timeEntry?.id);
    expect(first.duplicate).toBe(false);
    expect(first.timeEntry).toMatchObject({
      userId: user.id,
      crmProjectId: crmProject.id,
      taskId: task.id,
      description: "First pass",
      status: "running",
      provenance: "command",
    });

    const commands = await inSeededWorkspace(() => listTimerCommands(user.id));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      origin: "web-session-1",
      sequence: 1,
      kind: "start",
    });
  });

  it("keeps at most one active Timer per User and rematerializes a late command", async () => {
    const { storage, user, crmProject, task } = await seedTrackableWork();
    const { applyTimerCommand } = await import("../../server/modules/time/commands");

    const first = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T10:00:00.000Z"),
        payload: { crmProjectId: crmProject.id, taskId: task.id, description: "Morning" },
      })
    );
    const second = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "desktop-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T12:00:00.000Z"),
        payload: { crmProjectId: crmProject.id, taskId: task.id, description: "Afternoon" },
      })
    );

    expect(second.timeEntry?.id).not.toBe(first.timeEntry?.id);
    expect(second.timeEntry?.status).toBe("running");
    const afterSecond = await inSeededWorkspace(() => storage.getTimeEntries({ userId: user.id }));
    const actives = afterSecond.filter((row) => row.status === "running" || row.status === "paused");
    expect(actives).toHaveLength(1);
    expect(actives[0].id).toBe(second.timeEntry?.id);
    expect(afterSecond.find((row) => row.id === first.timeEntry?.id)?.status).toBe("stopped");

    const lateStop = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 2,
        kind: "stop",
        claimedEffectiveAt: new Date("2026-08-01T11:00:00.000Z"),
        payload: { timeEntryId: first.timeEntry?.id },
      })
    );
    expect(lateStop.duplicate).toBe(false);

    const rematerialized = await inSeededWorkspace(() => storage.getTimeEntries({ userId: user.id }));
    const morning = rematerialized.find((row) => row.id === first.timeEntry?.id);
    expect(morning).toMatchObject({
      status: "stopped",
      provenance: "command",
    });
    expect(morning?.endTime?.toISOString()).toBe("2026-08-01T11:00:00.000Z");
    const afternoon = rematerialized.find((row) => row.id === second.timeEntry?.id);
    expect(afternoon?.status).toBe("running");
    expect(afternoon?.startTime.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    const stillActive = rematerialized.filter(
      (row) => row.status === "running" || row.status === "paused"
    );
    expect(stillActive).toHaveLength(1);
  });

  it("records start, stop, and adjust as Timer Commands", async () => {
    const { storage, user, crmProject, task } = await seedTrackableWork();
    const { applyTimerCommand, listTimerCommands } = await import(
      "../../server/modules/time/commands"
    );

    const started = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T10:00:00.000Z"),
        payload: { crmProjectId: crmProject.id, taskId: task.id, description: "Draft" },
      })
    );
    await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 2,
        kind: "adjust",
        claimedEffectiveAt: new Date("2026-08-01T10:05:00.000Z"),
        payload: { description: "Draft v2" },
      })
    );
    const stopped = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 3,
        kind: "stop",
        claimedEffectiveAt: new Date("2026-08-01T10:30:00.000Z"),
        payload: { timeEntryId: started.timeEntry?.id },
      })
    );

    expect(stopped.timeEntry).toMatchObject({
      id: started.timeEntry?.id,
      status: "stopped",
      description: "Draft v2",
      provenance: "command",
    });
    expect(stopped.timeEntry?.endTime?.toISOString()).toBe("2026-08-01T10:30:00.000Z");

    const commands = await inSeededWorkspace(() => listTimerCommands(user.id));
    expect(commands.map((row) => row.kind)).toEqual(["start", "adjust", "stop"]);
    const listed = await inSeededWorkspace(() => storage.getTimeEntries({ userId: user.id }));
    expect(listed).toHaveLength(1);
  });

  it("lists a Time Entry created without a command as provenance legacy", async () => {
    const { storage, user, crmProject, task } = await seedTrackableWork();
    const { listTimerCommands } = await import("../../server/modules/time/commands");

    const entry = await inSeededWorkspace(() =>
      storage.createTimeEntry({
        userId: user.id,
        crmProjectId: crmProject.id,
        taskId: task.id,
        description: "Before commands",
        startTime: new Date("2026-08-01T09:00:00.000Z"),
        endTime: new Date("2026-08-01T09:30:00.000Z"),
        status: "stopped",
        duration: 1800,
      })
    );

    expect(entry.provenance).toBe("legacy");
    const listed = await inSeededWorkspace(() => storage.getTimeEntries({ userId: user.id }));
    expect(listed.find((row) => row.id === entry.id)?.provenance).toBe("legacy");
    const commands = await inSeededWorkspace(() => listTimerCommands(user.id));
    expect(commands).toEqual([]);
  });

  it("clamps a future claimed effective time and flags the command", async () => {
    const { user, crmProject, task } = await seedTrackableWork();
    const { applyTimerCommand } = await import("../../server/modules/time/commands");
    const receivedAt = new Date("2026-08-01T10:00:00.000Z");

    const result = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T12:00:00.000Z"),
        receivedAt,
        payload: { crmProjectId: crmProject.id, taskId: task.id },
      })
    );

    expect(result.command.clamped).toBe(true);
    expect(result.command.claimedEffectiveAt.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    expect(result.timeEntry?.startTime.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  it("stops a leftover legacy active Timer when a late command rematerializes", async () => {
    const { storage, user, crmProject, task } = await seedTrackableWork();
    const { applyTimerCommand } = await import("../../server/modules/time/commands");

    await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T10:00:00.000Z"),
        payload: { crmProjectId: crmProject.id, taskId: task.id },
      })
    );
    await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 2,
        kind: "stop",
        claimedEffectiveAt: new Date("2026-08-01T12:00:00.000Z"),
        payload: {},
      })
    );
    const leftover = await inSeededWorkspace(() =>
      storage.createTimeEntry({
        userId: user.id,
        crmProjectId: crmProject.id,
        taskId: task.id,
        description: "Legacy running",
        startTime: new Date("2026-08-01T13:00:00.000Z"),
        status: "running",
        lastActivityAt: new Date("2026-08-01T13:00:00.000Z"),
      })
    );
    expect(leftover.provenance).toBe("legacy");

    await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "desktop-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T09:00:00.000Z"),
        payload: { crmProjectId: crmProject.id, taskId: task.id, description: "Late" },
      })
    );

    const listed = await inSeededWorkspace(() => storage.getTimeEntries({ userId: user.id }));
    const actives = listed.filter((row) => row.status === "running" || row.status === "paused");
    expect(actives).toHaveLength(0);
    expect(listed.find((row) => row.id === leftover.id)?.status).toBe("stopped");
    expect(listed.find((row) => row.id === leftover.id)?.provenance).toBe("legacy");
  });

  it("does not let a late adjust rewrite pause/stop duration", async () => {
    const { storage, user, crmProject, task } = await seedTrackableWork();
    const { applyTimerCommand } = await import("../../server/modules/time/commands");

    const started = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-01T10:00:00.000Z"),
        payload: { crmProjectId: crmProject.id, taskId: task.id, description: "Draft" },
      })
    );
    await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 2,
        kind: "stop",
        claimedEffectiveAt: new Date("2026-08-01T12:00:00.000Z"),
        payload: { timeEntryId: started.timeEntry?.id },
      })
    );
    await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 3,
        kind: "adjust",
        claimedEffectiveAt: new Date("2026-08-01T11:00:00.000Z"),
        payload: { timeEntryId: started.timeEntry?.id, description: "Draft v2" },
      })
    );

    const listed = await inSeededWorkspace(() => storage.getTimeEntries({ userId: user.id }));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      description: "Draft v2",
      status: "stopped",
      duration: 7200,
    });
  });

  it("reads and writes Work Schedule through Time, and fails closed without WorkspaceContext", async () => {
    const { getAllowedTimezones, upsertAllowedTimezones } = await import(
      "../../server/modules/time/schedule"
    );
    const { MissingWorkspaceContextError } = await import("../../server/workspaceContext");

    await expect(getAllowedTimezones()).rejects.toThrow(MissingWorkspaceContextError);
    await expect(upsertAllowedTimezones(["America/Toronto"])).rejects.toThrow(
      MissingWorkspaceContextError
    );

    await inSeededWorkspace(() => upsertAllowedTimezones(["America/Toronto", "Europe/Paris"]));
    const read = await inSeededWorkspace(() => getAllowedTimezones());
    expect(read).toEqual(["America/Toronto", "Europe/Paris"]);
  });
});
