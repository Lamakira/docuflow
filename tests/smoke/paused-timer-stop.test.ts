import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PARALLEL_WORKSPACE_ID, SEEDED_WORKSPACE_ID, timeEntries, timerCommands } from "../../shared/schema";
import { ownerDb, resetDb } from "../helpers/db";
import {
  addWorkspaceMembership,
  createSeededMember,
  plantParallelWorkspace,
} from "../helpers/workspace";
import { runWithWorkspaceContext } from "../../server/workspaceContext";

/**
 * #330: stopping a paused Time Entry ends it at the moment it was paused, and a
 * Time Entry paused past the expiry is stopped by the server.
 */

const T0 = new Date("2026-08-01T09:00:00.000Z");
const T1 = new Date("2026-08-01T10:00:00.000Z"); // paused
const T2 = new Date("2026-08-02T10:00:00.000Z"); // a day later

async function seed(email = "paused@test.invalid", workspaceId = SEEDED_WORKSPACE_ID, userId?: string) {
  const { storage } = await import("../../server/storage");
  const user = userId
    ? { id: userId }
    : await createSeededMember({ email, firstName: "Pau" });
  const crmProject = await runWithWorkspaceContext({ workspaceId }, async () => {
    const { crmProject } = await storage.createCrmProjectWithBase({ name: `Atlas ${email}`, ownerId: user.id });
    return crmProject;
  });
  return { user, crmProject, workspaceId };
}

let seq = 0;
async function cmd(
  ctx: { user: { id: string }; workspaceId: string },
  origin: string,
  kind: "start" | "pause" | "resume" | "stop",
  at: Date,
  payload: Record<string, unknown> = {}
) {
  const { applyTimerCommand } = await import("../../server/modules/time/commands");
  return runWithWorkspaceContext({ workspaceId: ctx.workspaceId, userId: ctx.user.id }, () =>
    applyTimerCommand({
      userId: ctx.user.id,
      origin,
      sequence: ++seq,
      kind,
      claimedEffectiveAt: at,
      receivedAt: at,
      payload,
    })
  );
}

async function entry(id: string) {
  const [row] = await ownerDb.select().from(timeEntries).where(eq(timeEntries.id, id));
  return row;
}

describe("stopping a paused Time Entry", () => {
  beforeEach(async () => {
    await resetDb();
  });

  for (const origin of ["web:u1", "desktop:device-1"]) {
    it(`ends at the pause time (${origin})`, async () => {
      const ctx = await seed();
      const started = await cmd(ctx, origin, "start", T0, { crmProjectId: ctx.crmProject.id });
      await cmd(ctx, origin, "pause", T1);
      const stopped = await cmd(ctx, origin, "stop", T2);
      const row = await entry(started.timeEntry!.id);
      expect(row.status).toBe("stopped");
      expect(row.endTime?.toISOString()).toBe(T1.toISOString());
      expect(row.duration).toBe(3600);
      // The row records when it changed: the stop, not the pause it ends at.
      expect(row.updatedAt?.toISOString()).toBe(T2.toISOString());
      expect(stopped.timeEntry?.endTime?.toISOString()).toBe(T1.toISOString());
    });
  }

  it("ends the paused entry at its pause time when a new start supersedes it", async () => {
    const ctx = await seed();
    const first = await cmd(ctx, "web:u1", "start", T0, { crmProjectId: ctx.crmProject.id });
    await cmd(ctx, "web:u1", "pause", T1);
    await cmd(ctx, "web:u1", "start", T2, { crmProjectId: ctx.crmProject.id });
    const row = await entry(first.timeEntry!.id);
    expect(row.status).toBe("stopped");
    expect(row.endTime?.toISOString()).toBe(T1.toISOString());
    expect(row.duration).toBe(3600);
  });

  it("ends at the pause time when a late-arriving command forces a replay", async () => {
    const ctx = await seed();
    const started = await cmd(ctx, "web:u1", "start", T0, { crmProjectId: ctx.crmProject.id });
    await cmd(ctx, "web:u1", "pause", T1);
    await cmd(ctx, "web:u1", "stop", T2);
    // Arrives last, claims an earlier time than the stop: replay.
    await cmd(ctx, "desktop:d1", "adjust", new Date("2026-08-01T09:30:00.000Z"), {
      timeEntryId: started.timeEntry!.id,
      description: "late note",
    });
    const row = await entry(started.timeEntry!.id);
    expect(row.status).toBe("stopped");
    expect(row.endTime?.toISOString()).toBe(T1.toISOString());
    expect(row.duration).toBe(3600);
    expect(row.description).toBe("late note");
  });

  it("leaves a running entry's stop at the stop time", async () => {
    const ctx = await seed();
    const started = await cmd(ctx, "web:u1", "start", T0, { crmProjectId: ctx.crmProject.id });
    await cmd(ctx, "web:u1", "stop", T1);
    const row = await entry(started.timeEntry!.id);
    expect(row.endTime?.toISOString()).toBe(T1.toISOString());
    expect(row.duration).toBe(3600);
  });
});

describe("stopExpiredPausedEntries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stops entries paused past 12 hours in every Workspace, once", async () => {
    const NOW = new Date("2026-08-10T12:00:00.000Z");
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
    await plantParallelWorkspace();
    const a = await seed("a@test.invalid");
    const b = await seed("b@test.invalid", SEEDED_WORKSPACE_ID);
    const c = await seed("c@test.invalid");
    const d = await seed("d@test.invalid");
    await addWorkspaceMembership(d.user.id, PARALLEL_WORKSPACE_ID);
    const dCtx = await seed("d2@test.invalid", PARALLEL_WORKSPACE_ID, d.user.id);
    const dCtxWs = { user: d.user, workspaceId: PARALLEL_WORKSPACE_ID, crmProject: dCtx.crmProject };

    const old = await cmd(a, "web:a", "start", hoursAgo(20), { crmProjectId: a.crmProject.id });
    await cmd(a, "web:a", "pause", hoursAgo(13));
    const fresh = await cmd(b, "web:b", "start", hoursAgo(20), { crmProjectId: b.crmProject.id });
    await cmd(b, "web:b", "pause", hoursAgo(11));
    const running = await cmd(c, "web:c", "start", hoursAgo(20), { crmProjectId: c.crmProject.id });
    const other = await cmd(dCtxWs, "web:d", "start", hoursAgo(20), { crmProjectId: dCtxWs.crmProject.id });
    await cmd(dCtxWs, "web:d", "pause", hoursAgo(14));

    const { stopExpiredPausedEntries } = await import("../../server/staleTimer");
    expect(await stopExpiredPausedEntries(NOW)).toBe(2);
    expect(await stopExpiredPausedEntries(NOW)).toBe(0);

    const oldRow = await entry(old.timeEntry!.id);
    expect(oldRow.status).toBe("stopped");
    expect(oldRow.endTime?.toISOString()).toBe(hoursAgo(13).toISOString());
    expect(oldRow.duration).toBe(7 * 3600);
    const otherRow = await entry(other.timeEntry!.id);
    expect(otherRow.status).toBe("stopped");
    expect(otherRow.endTime?.toISOString()).toBe(hoursAgo(14).toISOString());
    expect((await entry(fresh.timeEntry!.id)).status).toBe("paused");
    expect((await entry(running.timeEntry!.id)).status).toBe("running");

    const commands = await ownerDb.select().from(timerCommands).where(eq(timerCommands.origin, "server:paused-expiry"));
    expect(commands).toHaveLength(2);
  });
});
