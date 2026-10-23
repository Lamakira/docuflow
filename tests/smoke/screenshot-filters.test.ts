import { beforeEach, describe, expect, it } from "vitest";
import { isLowActivityCapture } from "../../shared/activityEvidence";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { ownerDb, resetDb } from "../helpers/db";
import { registerAdmin, registerUser, type TestUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { plantParallelWorkspace } from "../helpers/workspace";

/**
 * #341. The Low activity and Similar lenses are applied by the server over the
 * whole period, so totals and pages agree with what the gallery shows.
 */

const H_A = "0123456789abcdef";
const H_A_NEAR = "0123456789abcdee"; // 1 bit away
const H_FAR = "fedcba9876543210"; // many bits away

type Seed = {
  userId: string;
  entryId: string;
  crmProjectId: string;
  at: string;
  hash?: string | null;
  kb?: number | null;
  mouse?: number | null;
  deletedAt?: Date | null;
  pending?: boolean;
  workspaceId?: string;
};

async function seed(rows: Seed[]) {
  const { timeEntryScreenshots } = await import("../../shared/schema");
  const out = [];
  for (const [i, r] of rows.entries()) {
    const [row] = await ownerDb
      .insert(timeEntryScreenshots)
      .values({
        workspaceId: r.workspaceId ?? SEEDED_WORKSPACE_ID,
        timeEntryId: r.entryId,
        userId: r.userId,
        crmProjectId: r.crmProjectId,
        storageKey: r.pending ? `pending-${i}` : `/objects/ws/x/${r.userId}-${i}.webp`,
        perceptualHash: r.hash ?? null,
        keyboardActivityPercent: r.kb ?? null,
        mouseActivityPercent: r.mouse ?? null,
        deletedAt: r.deletedAt ?? null,
        capturedAt: new Date(r.at),
      })
      .returning();
    out.push(row);
  }
  return out;
}

/** A Project, CRM project and Time Entry for `userId` inside another Workspace (composite FKs tie rows to one). */
async function plantEntryIn(workspaceId: string, userId: string) {
  const { projects, crmProjects, timeEntries } = await import("../../shared/schema");
  const [project] = await ownerDb.insert(projects).values({ name: "Other", ownerId: userId, workspaceId }).returning();
  const [crm] = await ownerDb.insert(crmProjects).values({ projectId: project.id, workspaceId }).returning();
  const [entry] = await ownerDb
    .insert(timeEntries)
    .values({ userId, crmProjectId: crm.id, startTime: new Date("2026-10-04T08:00:00Z"), status: "stopped", workspaceId })
    .returning();
  return { userId, entryId: entry.id as string, crmProjectId: crm.id as string };
}

async function member(app: Awaited<ReturnType<typeof makeApp>>) {
  const user = await registerUser(app);
  const { crmProject } = await createCrmProject(user.agent);
  const task = await createTask(user.agent, crmProject.id);
  const entry = await startTimer(user.agent, crmProject.id, task.id);
  return { user, base: { userId: user.id, entryId: entry.id as string, crmProjectId: crmProject.id as string } };
}

const list = (u: TestUser, query: Record<string, string | number> = {}) =>
  u.agent.get("/api/time-tracking/screenshots").query(query);

describe("screenshot lenses (#341)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("compares each capture with the previous live capture of the same Member", async () => {
    const app = await makeApp();
    const ada = await member(app);
    const bob = await member(app);
    const [a1, b1, a2, aDeleted, a3, aNull, aPending, a4] = await seed([
      { ...ada.base, at: "2026-10-01T09:00:00Z", hash: H_A },
      { ...bob.base, at: "2026-10-01T09:01:00Z", hash: H_FAR }, // interleaved Member
      { ...ada.base, at: "2026-10-01T09:05:00Z", hash: H_A_NEAR }, // Similar to a1 (bob ignored)
      { ...ada.base, at: "2026-10-01T09:10:00Z", hash: H_FAR, deletedAt: new Date() }, // skipped
      { ...ada.base, at: "2026-10-01T09:15:00Z", hash: H_A }, // previous live = a2, Similar
      { ...ada.base, at: "2026-10-01T09:20:00Z", hash: null }, // no fingerprint
      { ...ada.base, at: "2026-10-01T09:22:00Z", hash: H_FAR, pending: true }, // not uploaded
      { ...ada.base, at: "2026-10-01T09:25:00Z", hash: H_A }, // previous has none: not Similar
    ]);

    const admin = await registerAdmin(app);
    const res = await list(admin, { userId: ada.user.id });
    const similar = Object.fromEntries(res.body.data.map((r: any) => [r.id, r.similarToPrevious]));
    expect(similar[a1.id]).toBe(false); // nothing before it
    expect(similar[a2.id]).toBe(true);
    expect(similar[a3.id]).toBe(true);
    expect(similar[aNull.id]).toBe(false);
    expect(similar[a4.id]).toBe(false);
    expect(similar[aDeleted.id]).toBeUndefined();
    expect(similar[aPending.id]).toBeUndefined();
    expect(similar[b1.id]).toBeUndefined();

    const bobList = await list(admin, { userId: bob.user.id });
    expect(bobList.body.data[0].similarToPrevious).toBe(false);
  });

  it("still compares with a previous capture that is before the requested period or on another project", async () => {
    const app = await makeApp();
    const ada = await member(app);
    const other = await createCrmProject(ada.user.agent);
    await seed([
      { ...ada.base, crmProjectId: other.crmProject.id, at: "2026-09-30T23:50:00Z", hash: H_A },
      { ...ada.base, at: "2026-10-01T00:10:00Z", hash: H_A_NEAR },
    ]);
    const res = await list(ada.user, { startDate: "2026-10-01T00:00:00Z", crmProjectId: ada.base.crmProjectId, similar: "1" });
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].similarToPrevious).toBe(true);
  });

  it("filters, counts and pages agree across lenses", async () => {
    const app = await makeApp();
    const ada = await member(app);
    // 10 captures, a minute apart. Even ones are low activity.
    const rows: Seed[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push({
        ...ada.base,
        at: `2026-10-02T10:${String(i).padStart(2, "0")}:00Z`,
        hash: i < 5 ? H_A : i < 7 ? H_FAR : H_A, // Similar to the previous: 1,2,3,4,6,8,9
        kb: i % 2 === 0 ? 3 : 40,
        mouse: i % 2 === 0 ? 9 : 50,
      });
    }
    await seed(rows);

    const all = await list(ada.user);
    expect(all.body.total).toBe(10);
    expect(all.body.counts).toEqual({ lowActivity: 5, similar: 7 });
    expect(all.body.lowActivityThresholdPercent).toBe(10);

    const lowPages = [];
    for (const offset of [0, 2, 4]) lowPages.push(await list(ada.user, { lowActivity: "1", limit: 2, offset }));
    expect(lowPages.map((p) => p.body.total)).toEqual([5, 5, 5]);
    expect(lowPages.map((p) => p.body.data.length)).toEqual([2, 2, 1]);
    expect(lowPages[0].body.counts).toEqual({ lowActivity: 5, similar: 7 }); // counts ignore the lenses

    const similarAll = await list(ada.user, { similar: "1", limit: 100 });
    expect(similarAll.body.total).toBe(7);
    expect(similarAll.body.data.every((r: any) => r.similarToPrevious)).toBe(true);

    // Low activity (even i) and Similar (i = 1,2,3,4,6,8,9): 2, 4, 6, 8.
    const both = await list(ada.user, { similar: "1", lowActivity: "1", limit: 100 });
    expect(both.body.data.every((r: any) => r.similarToPrevious && r.keyboardActivityPercent === 3)).toBe(true);
    expect(both.body.total).toBe(4);
    expect(both.body.data).toHaveLength(4);
    const bothPaged = await list(ada.user, { similar: "1", lowActivity: "1", limit: 1, offset: 1 });
    expect(bothPaged.body.total).toBe(both.body.total);
    expect(bothPaged.body.data[0].id).toBe(both.body.data[1].id);
  });

  it("agrees with the shared low-activity rule on every boundary and null", async () => {
    const app = await makeApp();
    const ada = await member(app);
    const cases: Array<[number | null, number | null]> = [
      [9, 9], [10, 9], [9, 10], [10, 10], [0, 0], [null, 5], [5, null], [null, null], [49, 49], [50, 3],
    ];
    await seed(cases.map(([kb, mouse], i) => ({ ...ada.base, at: `2026-10-03T10:${String(i).padStart(2, "0")}:00Z`, kb, mouse })));

    const { getTimeEntryScreenshots } = await import("../../server/modules/activity/evidence");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    for (const threshold of [10, 50, 0, 100]) {
      const rows = await runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, () =>
        getTimeEntryScreenshots({ lowActivityOnly: true, lowActivityThresholdPercent: threshold, limit: 100 }),
      );
      const fromSql = rows.data.map((r) => [r.keyboardActivityPercent, r.mouseActivityPercent].join("/")).sort();
      const fromJs = cases
        .filter(([kb, mouse]) => isLowActivityCapture({ keyboardActivityPercent: kb, mouseActivityPercent: mouse }, threshold))
        .map(([kb, mouse]) => [kb, mouse].join("/"))
        .sort();
      expect(fromSql).toEqual(fromJs);
    }
  });

  it("never reads the other Workspace's captures", async () => {
    const app = await makeApp();
    const ada = await member(app);
    const workspaceB = await plantParallelWorkspace();
    const inB = await plantEntryIn(workspaceB, ada.user.id);
    await seed([
      // Same Member id, earlier, identical fingerprint — in Workspace B.
      { ...inB, workspaceId: workspaceB, at: "2026-10-04T09:00:00Z", hash: H_A, kb: 1, mouse: 1 },
      { ...inB, workspaceId: workspaceB, at: "2026-10-04T09:30:00Z", hash: H_A, kb: 1, mouse: 1 },
      { ...ada.base, at: "2026-10-04T10:00:00Z", hash: H_A, kb: 1, mouse: 1 },
    ]);
    const res = await list(ada.user);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].similarToPrevious).toBe(false);
    expect(res.body.counts).toEqual({ lowActivity: 1, similar: 0 });
    expect((await list(ada.user, { similar: "1" })).body.total).toBe(0);
  });

  describe("threshold from the Tracking Policy", () => {
    it("is applied, and only Administration can change it", async () => {
      const app = await makeApp();
      const admin = await registerAdmin(app);
      const ada = await member(app);
      await seed([
        { ...ada.base, at: "2026-10-05T10:00:00Z", kb: 30, mouse: 30 },
        { ...ada.base, at: "2026-10-05T10:05:00Z", kb: 5, mouse: 5 },
      ]);
      expect((await list(ada.user, { lowActivity: "1" })).body.total).toBe(1);

      const set = await admin.agent.patch("/api/admin/org-settings").send({ screenshotPolicy: { lowActivityThresholdPercent: 50 } });
      expect(set.status).toBe(200);
      const after = await list(ada.user, { lowActivity: "1" });
      expect(after.body.total).toBe(2);
      expect(after.body.lowActivityThresholdPercent).toBe(50);
      expect(after.body.counts.lowActivity).toBe(2);

      const denied = await ada.user.agent.patch("/api/admin/org-settings").send({ screenshotPolicy: { lowActivityThresholdPercent: 5 } });
      expect(denied.status).toBe(403);

      for (const bad of [101, 5.5, -1]) {
        const res = await admin.agent.patch("/api/admin/org-settings").send({ screenshotPolicy: { lowActivityThresholdPercent: bad } });
        expect(res.status).toBe(400);
      }
    });
  });
});
