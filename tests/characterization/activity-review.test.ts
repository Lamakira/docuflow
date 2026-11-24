import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  companyDocuments,
  crmProjects,
  files,
  jobs,
  memberships,
  objectUploadSlots,
  PARALLEL_WORKSPACE_ID,
  projects,
  SEEDED_WORKSPACE_ID,
  timeEntries,
  timeEntryScreenshots,
  users,
} from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { getOwnerPool, ownerDb, resetDb } from "../helpers/db";
import { registerAdmin, registerUser, setWorkspaceRole, type TestUser } from "../helpers/auth";
import { createClient, createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice, PNG_1X1 } from "../helpers/agent";
import { screenPng } from "../helpers/screens";
import { addWorkspaceMembership, inSeededWorkspace, plantParallelWorkspace } from "../helpers/workspace";

/** Server half of the Activity review: F75, F76, F77, F78, F80. */

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const INSTANT = "2026-03-10 09:30:00.123456";
const NUL = "a\0b";
const DUPLICATE = "system:duplicate-capture";
const NUL_PATH = "/api/time-tracking/screenshots/a%00b";

type Base = { userId: string; timeEntryId: string; crmProjectId: string; workspaceId?: string };
type Plant = {
  at?: string;
  hash?: string | null;
  key?: string;
  createdAt?: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  reason?: string | null;
};

/** Raw SQL, so that instants keep their microseconds. */
async function plant(base: Base, values: Plant = {}): Promise<string> {
  const id = randomUUID();
  await getOwnerPool().query(
    `INSERT INTO time_entry_screenshots
       (id, workspace_id, user_id, time_entry_id, crm_project_id, storage_key, content_hash,
        captured_at, created_at, deleted_at, deleted_by, delete_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamp,$9::timestamp,$10::timestamp,$11,$12)`,
    [
      id,
      base.workspaceId ?? SEEDED_WORKSPACE_ID,
      base.userId,
      base.timeEntryId,
      base.crmProjectId,
      values.key ?? `/objects/ws/seeded/agent-screenshots/${id}.webp`,
      values.hash === undefined ? HASH_A : values.hash,
      values.at ?? INSTANT,
      values.createdAt ?? "2026-03-10 09:31:00",
      values.deletedAt ?? null,
      values.deletedBy ?? null,
      values.reason ?? null,
    ],
  );
  return id;
}

const pending = (base: Base, values: Plant = {}) =>
  plant(base, { hash: null, key: `pending-${randomUUID()}`, ...values });

async function rowOf(id: string) {
  const [row] = await ownerDb.select().from(timeEntryScreenshots).where(eq(timeEntryScreenshots.id, id));
  return row;
}

async function commit(id: string, contentHash = HASH_A) {
  const { commitActivityScreenshot, createActivityJobsPort } = await import("../../server/modules/activity/evidenceJobs");
  return inSeededWorkspace(() =>
    commitActivityScreenshot({
      jobs: createActivityJobsPort(),
      id,
      storageKey: `/objects/ws/seeded/agent-screenshots/${id}.webp`,
      contentHash,
    }),
  );
}

async function liveIds(): Promise<string[]> {
  const rows = await ownerDb.select().from(timeEntryScreenshots);
  return rows.filter((r) => r.deletedAt === null).map((r) => r.id);
}

async function setup() {
  const app = await makeApp();
  const admin = await registerAdmin(app, { firstName: "Ada", lastName: "Min" });
  const member = await registerUser(app, { firstName: "Mel", lastName: "Ber" });
  const client = await createClient(admin.agent, { name: "Client One" });
  const { crmProject } = await createCrmProject(admin.agent, {
    name: "Delivery",
    status: "won_in_progress",
    clientId: client.id,
    memberIds: [admin.id, member.id],
  });
  const task = await createTask(admin.agent, crmProject.id, "Draw screens");
  const entryId = randomUUID();
  await ownerDb.insert(timeEntries).values({
    id: entryId,
    userId: member.id,
    crmProjectId: crmProject.id,
    taskId: task.id,
    startTime: new Date("2026-03-10T09:00:00Z"),
    endTime: new Date("2026-03-10T10:00:00Z"),
    duration: 3000,
    idleTime: 600,
    status: "stopped",
    workspaceId: SEEDED_WORKSPACE_ID,
  });
  const base: Base = { userId: member.id, timeEntryId: entryId, crmProjectId: crmProject.id };
  return { app, admin, member, crmProjectId: crmProject.id, base };
}

async function otherEntry(base: Base, values: Partial<typeof timeEntries.$inferInsert> = {}): Promise<Base> {
  const id = randomUUID();
  await ownerDb.insert(timeEntries).values({
    id,
    userId: base.userId,
    crmProjectId: base.crmProjectId,
    startTime: new Date("2026-03-10T09:00:00Z"),
    endTime: new Date("2026-03-10T10:00:00Z"),
    status: "stopped",
    workspaceId: SEEDED_WORKSPACE_ID,
    ...values,
  });
  return { ...base, timeEntryId: id };
}

async function plantElsewhere(userId: string): Promise<Base> {
  const workspaceId = await plantParallelWorkspace();
  const [project] = await ownerDb.insert(projects).values({ name: "Other", ownerId: userId, workspaceId }).returning();
  const [crm] = await ownerDb.insert(crmProjects).values({ projectId: project.id, workspaceId }).returning();
  const [entry] = await ownerDb
    .insert(timeEntries)
    .values({ userId, crmProjectId: crm.id, startTime: new Date("2026-03-10T09:00:00Z"), status: "stopped", workspaceId })
    .returning();
  return { userId, timeEntryId: entry.id, crmProjectId: crm.id, workspaceId };
}

const list = (user: TestUser, query: Record<string, unknown> = {}) =>
  user.agent.get("/api/time-tracking/screenshots").query(query);

beforeEach(resetDb);

describe("one live row per capture and image, at upload (F75)", () => {
  it("hides the second commit, keeps its key and hash, and enqueues nothing for it", async () => {
    const { base } = await setup();
    const first = await pending(base);
    const second = await pending(base);
    await commit(first);
    const copy = await commit(second);

    expect(copy).toMatchObject({ id: second, deletedBy: null, deleteReason: DUPLICATE, contentHash: HASH_A });
    expect(copy!.deletedAt).not.toBeNull();
    expect((await rowOf(second)).storageKey).toBe(`/objects/ws/seeded/agent-screenshots/${second}.webp`);
    expect(await liveIds()).toEqual([first]);
    const queued = (await ownerDb.select().from(jobs)).map((j) => (j.payload as { screenshotId?: string }).screenshotId);
    expect(queued).toContain(first);
    expect(queued).not.toContain(second);
  });

  it("never hides a row committed again, the original after its copy included", async () => {
    const { base } = await setup();
    const first = await pending(base);
    const second = await pending(base);
    await commit(first);
    await commit(first);
    expect((await rowOf(first)).deletedAt).toBeNull();
    await commit(second);
    await commit(first);
    await commit(second);
    expect(await liveIds()).toEqual([first]);
    const queued = (await ownerDb.select().from(jobs)).map((j) => (j.payload as { screenshotId?: string }).screenshotId);
    expect(queued).not.toContain(second);
  });

  it.each([2, 5, 11])("leaves one live row of %i commits at the same moment", async (count) => {
    const { base } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push(await pending(base));
    await Promise.all(ids.map((id) => commit(id)));
    expect(await liveIds()).toHaveLength(1);
    for (const id of ids) expect((await rowOf(id)).contentHash).toBe(HASH_A);
  });

  it("keeps captures that differ in image, instant, entry or Workspace", async () => {
    const { base, member } = await setup();
    await plant(base);
    await plant(await plantElsewhere(member.id), { at: "2026-03-10 09:31:00", hash: HASH_B });
    const otherImage = await pending(base);
    const nextMicrosecond = await pending(base, { at: "2026-03-10 09:30:00.123457" });
    const elsewhere = await pending(await otherEntry(base));
    const onlyInOtherWorkspace = await pending(base, { at: "2026-03-10 09:31:00" });
    await commit(otherImage, HASH_B);
    await commit(nextMicrosecond);
    await commit(elsewhere);
    await commit(onlyInOtherWorkspace, HASH_B);
    for (const id of [otherImage, nextMicrosecond, elsewhere, onlyInOtherWorkspace]) {
      expect((await rowOf(id)).deletedAt).toBeNull();
    }
  });

  it("hides a copy of a capture an Administrator deleted", async () => {
    const { base, admin } = await setup();
    const original = await plant(base);
    expect((await admin.agent.delete(`/api/time-tracking/screenshots/${original}`)).status).toBe(200);
    const copy = await pending(base);
    await commit(copy);
    expect(await rowOf(copy)).toMatchObject({ deleteReason: DUPLICATE, deletedBy: null });
    expect(await rowOf(original)).toMatchObject({ deleteReason: null, deletedBy: admin.id });
  });

  it("answers ok to the agent whose upload is a copy, and takes a slot once", async () => {
    const { app, crmProjectId, admin } = await setup();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProject } = await createCrmProject(user.agent, { status: "won_in_progress" });
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    expect(crmProject.id).not.toBe(crmProjectId);
    const capturedAt = new Date().toISOString();
    const presign = () =>
      device.request.post("/api/agent/screenshots/presign").send({
        deviceId: device.deviceId,
        timeEntryId: entry.id,
        capturedAt,
        clientType: "desktop",
        clientVersion: "0.1.0",
      });

    const [one, two] = await Promise.all([presign(), presign()]);
    expect(two.body.screenshotId).toBe(one.body.screenshotId);

    const send = async (id: string) => {
      const put = await device.request
        .put(`/api/agent/screenshots/upload/${id}`)
        .set("Content-Type", "image/png")
        .send(PNG_1X1);
      const confirmed = await device.request
        .post("/api/agent/screenshots/confirm")
        .send({ screenshotId: id, deviceId: device.deviceId });
      return [put, confirmed];
    };
    for (const res of await send(one.body.screenshotId)) expect(res.body).toEqual({ ok: true });
    const again = await presign();
    expect(again.body.screenshotId).not.toBe(one.body.screenshotId);
    for (const res of await send(again.body.screenshotId)) expect(res.body).toEqual({ ok: true });

    const listed = await list(admin, { userId: user.id });
    expect(listed.body.total).toBe(1);
    expect(listed.body.data[0].id).toBe(one.body.screenshotId);

    const third = await presign();
    const other = await device.request
      .put(`/api/agent/screenshots/upload/${third.body.screenshotId}`)
      .set("Content-Type", "image/png")
      .send(await screenPng("editor"));
    expect(other.body).toEqual({ ok: true });
    expect((await list(admin, { userId: user.id })).body.total).toBe(2);
  });
});

describe("the copies already stored (F75)", () => {
  const run = async (options: { apply?: boolean; undo?: boolean; batchSize?: number } = {}) => {
    const { hideDuplicatesInAllWorkspaces } = await import("../../scripts/hide-duplicate-captures");
    return hideDuplicatesInAllWorkspaces(options);
  };

  const snapshot = async () => {
    const rows = await ownerDb.select().from(timeEntryScreenshots);
    return rows.map((r) => [r.id, r.deletedAt, r.deletedBy, r.deleteReason]).sort();
  };

  it("hides all but the earliest of each set, in batches, once, and undoes it", async () => {
    const { base, admin, member } = await setup();
    const foreign = await plantElsewhere(member.id);
    const keep: string[] = [];
    let copies = 0;
    for (const [n, size] of [2, 3, 11].entries()) {
      const at = `2026-03-10 09:4${n}:00.654321`;
      for (let i = 0; i < size; i++) {
        // Later rows first, so the order of insertion is not the order of age.
        const id = await plant(base, { at, createdAt: `2026-03-10 09:50:00.${String(900 - i * 50).padStart(3, "0")}` });
        if (i === size - 1) keep.push(id);
      }
      copies += size - 1;
    }
    // The same instant of creation: the lowest id stays.
    const tied = [
      await plant(base, { at: "2026-03-10 09:20:00" }),
      await plant(base, { at: "2026-03-10 09:20:00" }),
    ].sort();
    keep.push(tied[0]);
    copies += 1;
    const inOther = [await plant(foreign, { createdAt: "2026-03-10 09:31:01" }), await plant(foreign)];
    keep.push(inOther[1]);
    copies += 1;
    // Not copies: another image, another instant, another entry, no hash, no image yet.
    const alone = [
      await plant(base),
      await plant(base, { hash: HASH_B }),
      await plant(base, { at: "2026-03-10 09:30:00.123457" }),
      await plant(await otherEntry(base)),
      await plant(base, { hash: null }),
      await plant(base, { hash: null }),
      await plant(base, { key: "pending-1" }),
    ];
    keep.push(...alone);

    const before = await snapshot();
    expect(await run()).toMatchObject({ sets: 5, copies, hidden: 0 });
    expect(await snapshot()).toEqual(before);

    expect(await run({ apply: true, batchSize: 2 })).toMatchObject({ sets: 5, hidden: copies });
    expect((await liveIds()).sort()).toEqual([...keep].sort());
    const hidden = (await ownerDb.select().from(timeEntryScreenshots)).filter((r) => r.deletedAt !== null);
    expect(hidden.every((r) => r.deleteReason === DUPLICATE && r.deletedBy === null)).toBe(true);

    const after = await snapshot();
    expect(await run({ apply: true })).toMatchObject({ sets: 0, copies: 0, hidden: 0 });
    expect(await snapshot()).toEqual(after);

    const deleted = await admin.agent.delete(`/api/time-tracking/screenshots/${alone[1]}`).send({ reason: "private" });
    expect(deleted.status).toBe(200);
    expect(await run({ undo: true })).toMatchObject({ restored: copies });
    expect(await rowOf(alone[1])).toMatchObject({ deleteReason: "private", deletedBy: admin.id });
    expect(await liveIds()).toHaveLength(before.length - 1);
    expect(await run({ undo: true })).toMatchObject({ restored: 0 });
  });

  it("hides every live row of a set an Administrator deleted from, whatever the reason given", async () => {
    const { base, admin } = await setup();
    const tombstone = { deletedAt: "2026-03-11 08:00:00", deletedBy: admin.id };
    for (const [n, reason] of [null, "private", DUPLICATE].entries()) {
      const at = `2026-03-10 09:5${n}:00`;
      await plant(base, { at });
      await plant(base, { at, ...tombstone, reason });
      await plant(base, { at });
    }
    // Whoever deleted it has since left the platform.
    await plant(base, { at: "2026-03-10 09:55:00", deletedAt: "2026-03-11 08:00:00" });
    await plant(base, { at: "2026-03-10 09:55:00" });

    expect(await run({ apply: true, batchSize: 1 })).toMatchObject({ sets: 4, hidden: 7 });
    expect(await liveIds()).toEqual([]);
    const rows = await ownerDb.select().from(timeEntryScreenshots);
    expect(rows.filter((r) => r.deletedBy === admin.id)).toHaveLength(3);
    // Undo never brings back the image an Administrator removed.
    expect(await run({ undo: true })).toMatchObject({ restored: 0 });
    expect(await liveIds()).toEqual([]);
  });

  it("keeps the live row of a set whose earlier one the upload path hid", async () => {
    const { base } = await setup();
    await plant(base, { createdAt: "2026-03-10 09:30:01", deletedAt: "2026-03-10 09:30:05", reason: DUPLICATE });
    const live = await plant(base, { createdAt: "2026-03-10 09:30:02" });
    expect(await run({ apply: true })).toMatchObject({ sets: 0, hidden: 0 });
    expect(await liveIds()).toEqual([live]);
  });

  it("refuses to apply and undo at once", async () => {
    await expect(run({ apply: true, undo: true })).rejects.toThrow("exclude each other");
    await expect(run({ apply: true, batchSize: 0 })).rejects.toThrow("--batch-size");
  });

  it("counts no copy as a deletion, and every Administrator's", async () => {
    const { base, admin } = await setup();
    await plant(base);
    for (let i = 0; i < 4; i++) await plant(base, { deletedAt: "2026-03-11 08:00:00", reason: DUPLICATE });
    await plant(base, { at: "2026-03-10 09:35:00", deletedAt: "2026-03-11 08:00:00", deletedBy: admin.id });
    await plant(base, { at: "2026-03-10 09:36:00", deletedAt: "2026-03-11 08:00:00", deletedBy: admin.id, reason: "private" });

    const { storage } = await import("../../server/storage");
    const span = { startDate: new Date("2026-03-10T00:00:00Z"), endDate: new Date("2026-03-11T00:00:00Z") };
    const [shots, quality, coverage] = await inSeededWorkspace(() =>
      Promise.all([
        storage.getAdminScreenshotStats(span),
        storage.getDataQualityReport(span),
        storage.getScreenshotCoverageReport(span),
      ]),
    );
    expect(shots).toMatchObject({ totalCount: 1, deletedCount: 2 });
    expect(JSON.stringify(quality)).toMatch(/"\w*[dD]eleted\w*":2/);
    expect(JSON.stringify(coverage)).toMatch(/"\w*[dD]eleted\w*":2/);

    const { platformStats } = await import("../../server/modules/identity/backOfficeStats");
    const platform = await platformStats(30, new Date("2026-03-20T00:00:00Z"));
    expect(JSON.stringify(platform)).toMatch(/"screenshots\w*":3/);
  });
});

describe("the list (F76, F78)", () => {
  it("answers the contract's rows, and no storage key", async () => {
    const { admin, member, base, crmProjectId } = await setup();
    const id = await plant(base);
    const { body } = await list(admin);
    expect(body).toMatchObject({ total: 1, limit: 50, offset: 0, lowActivityThresholdPercent: 10, counts: { lowActivity: 0, similar: 0 } });
    expect(body.data).toEqual([
      {
        id,
        userId: member.id,
        timeEntryId: base.timeEntryId,
        crmProjectId,
        capturedAt: "2026-03-10T09:30:00.123Z",
        keyboardActivityPercent: null,
        mouseActivityPercent: null,
        keyboardCount: null,
        mouseCount: null,
        contentHash: expect.any(String),
        similarToPrevious: false,
        entryDuration: 3000,
        entryIdleTime: 600,
        source: "device",
        user: { id: member.id, email: member.email, firstName: "Mel", lastName: "Ber", profileImageUrl: null },
        projectName: "Delivery",
        clientName: "Client One",
        taskName: "Draw screens",
      },
    ]);
  });

  it("falls back from the Task to the description, then to nothing", async () => {
    const { admin, base } = await setup();
    const described = await otherEntry(base, { description: "Call with the bank" });
    const bare = await otherEntry(base, { description: "  " });
    await plant(described, { key: "/objects/uploads/x1" });
    await plant(bare, { key: "/objects/uploads/x2", at: "2026-03-10 09:29:00" });
    await ownerDb.update(crmProjects).set({ clientId: null }).where(eq(crmProjects.id, base.crmProjectId));
    const { body } = await list(admin);
    expect(body.data.map((r: any) => [r.source, r.taskName, r.clientName])).toEqual([
      ["web", "Call with the bank", null],
      ["web", null, null],
    ]);
  });

  it("takes a capture at the period's first instant", async () => {
    const { admin, base } = await setup();
    const id = await plant(base, { at: "2026-03-10 00:00:00" });
    await plant(base, { at: "2026-03-09 23:59:59.999" });
    const { body } = await list(admin, { startDate: "2026-03-10T00:00:00.000Z", endDate: "2026-03-10T23:59:59.999Z" });
    expect(body.data.map((r: any) => r.id)).toEqual([id]);
  });

  it("pages captures of one instant without repeating or losing any", async () => {
    const { admin, base } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await plant(base, { hash: String(i).repeat(64) }));
    const seen: string[] = [];
    for (const offset of [0, 3, 6]) {
      const { body } = await list(admin, { limit: 3, offset });
      expect(body.total).toBe(7);
      seen.push(...body.data.map((r: any) => r.id));
    }
    expect(seen).toEqual([...ids].sort().reverse());
    const past = await list(admin, { limit: 3, offset: 90 });
    expect(past.status).toBe(200);
    expect(past.body).toMatchObject({ data: [], total: 7, offset: 90 });
  });

  it.each([
    [{ startDate: "soon" }],
    [{ endDate: "2026-13-45" }],
    [{ startDate: ["2026-03-10", "2026-03-11"] }],
    [{ offset: "-1" }],
    [{ offset: "1.5" }],
    [{ limit: "-5" }],
    [{ limit: "5abc" }],
    [{ offset: "99999999999999999999" }],
    [{ userId: NUL }],
    [{ crmProjectId: NUL }],
    [{ timeEntryId: NUL }],
    [{ timeEntryId: ["a", "b"] }],
  ])("refuses %j", async (query) => {
    const { admin } = await setup();
    const res = await list(admin, query);
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(expect.any(String));
  });

  it("reads limit 0 or absent as 50, and above 100 as 100", async () => {
    const { admin } = await setup();
    for (const [limit, read] of [["0", 50], [undefined, 50], ["100", 100], ["5000", 100]] as const) {
      expect((await list(admin, { limit })).body.limit).toBe(read);
    }
  });

  it("answers 404 to a NUL id", async () => {
    const { admin } = await setup();
    expect((await admin.agent.get(`${NUL_PATH}/image`)).status).toBe(404);
    expect((await admin.agent.delete(NUL_PATH)).status).toBe(404);
  });
});

describe("archived Members for an Owner (F77)", () => {
  it("lists them to Owners and Administrators, of this Workspace only", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const member = await registerUser(app);
    const removed = await registerUser(app);
    await ownerDb.update(memberships).set({ archivedAt: new Date() }).where(eq(memberships.userId, removed.id));
    const stranger = await registerUser(app);
    await plantParallelWorkspace();
    await ownerDb.delete(memberships).where(eq(memberships.userId, stranger.id));
    await addWorkspaceMembership(stranger.id, PARALLEL_WORKSPACE_ID, "member", true);
    const [row] = await ownerDb.select().from(users).where(eq(users.id, owner.id));
    expect(row.role).not.toBe("admin");

    const ids = async (user: TestUser, query = {}) =>
      (await user.agent.get("/api/users").query(query)).body.map((u: { id: string }) => u.id).sort();
    const active = [owner.id, member.id].sort();
    expect(await ids(owner)).toEqual(active);
    expect(await ids(owner, { includeArchived: "true" })).toEqual([...active, removed.id].sort());
    expect(await ids(member, { includeArchived: "true" })).toEqual(active);
    // The platform column grants nothing here.
    await ownerDb.update(users).set({ role: "admin" }).where(eq(users.id, member.id));
    expect(await ids(member, { includeArchived: "true" })).toEqual(active);
  });
});

describe("registering a web capture (F80)", () => {
  /** An upload handed to a User, as upload-url records it. */
  const mint = async (userId: string, values: { objectPath?: string; expiresAt?: Date; workspaceId?: string } = {}) => {
    const objectPath = values.objectPath ?? `/objects/uploads/${randomUUID()}`;
    await ownerDb.insert(objectUploadSlots).values({
      createdById: userId,
      expiresAt: new Date(Date.now() + 60_000),
      workspaceId: SEEDED_WORKSPACE_ID,
      ...values,
      objectPath,
    });
    return objectPath;
  };
  const register = async (user: TestUser, body: Record<string, unknown>) =>
    user.agent.post("/api/time-tracking/screenshots").send({ storageKey: await mint(user.id), ...body });

  it("takes the Project of the Time Entry", async () => {
    const { admin, member, base, crmProjectId } = await setup();
    const { crmProject: other } = await createCrmProject(admin.agent);
    const told = await register(member, { timeEntryId: base.timeEntryId, crmProjectId: other.id, capturedAt: "2026-03-10T09:30:00Z" });
    expect(told.status).toBe(200);
    expect(told.body.crmProjectId).toBe(crmProjectId);
    const untold = await register(member, { timeEntryId: base.timeEntryId, capturedAt: "2026-03-10T09:30:00Z" });
    expect(untold.body.crmProjectId).toBe(crmProjectId);
  });

  it("refuses an instant outside the Time Entry", async () => {
    const { member, base } = await setup();
    const at = (capturedAt: unknown) => register(member, { timeEntryId: base.timeEntryId, capturedAt });
    for (const ok of ["2026-03-10T08:55:00Z", "2026-03-10T09:30:00Z", "2026-03-10T10:05:00Z"]) {
      const res = await at(ok);
      expect(res.status, ok).toBe(200);
      expect(res.body.capturedAt).toBe(new Date(ok).toISOString());
    }
    // None sent means now, long after this entry ended.
    const bad = [undefined, "2026-03-10T08:54:59Z", "2026-03-10T10:05:01Z", "2031-01-01T00:00:00Z", "yesterday", "", 5, ["2026-03-10T09:30:00Z"]];
    for (const value of bad) {
      const res = await at(value);
      expect(res.status, String(value)).toBe(400);
      expect(res.body.message).toMatch(/^capturedAt is /);
    }
  });

  it("refuses the future on a running Time Entry, and takes now when none is sent", async () => {
    const { app } = await setup();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent, { status: "won_in_progress" });
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
    expect((await register(user, { timeEntryId: entry.id, capturedAt: inMinutes(6) })).status).toBe(400);
    expect((await register(user, { timeEntryId: entry.id, capturedAt: inMinutes(4) })).status).toBe(200);
    const before = Date.now();
    const now = await register(user, { timeEntryId: entry.id });
    expect(now.status).toBe(200);
    expect(Math.abs(new Date(now.body.capturedAt).getTime() - before)).toBeLessThan(10_000);
  });

  it("refuses an object a capture, a File or a Document already names", async () => {
    const { admin, member, base } = await setup();
    const key = (name: string) => `/objects/uploads/${name}`;
    await plant(base, { key: key("live") });
    await plant(base, { key: key("deleted"), deletedAt: "2026-03-11 08:00:00", deletedBy: admin.id });
    await ownerDb.insert(files).values({
      name: "F",
      storagePath: key("file"),
      uploadedById: admin.id,
      workspaceId: SEEDED_WORKSPACE_ID,
    });
    await ownerDb.insert(companyDocuments).values({
      name: "D",
      storagePath: key("document"),
      uploadedById: admin.id,
      workspaceId: SEEDED_WORKSPACE_ID,
    });
    const send = (storageKey: unknown) =>
      register(member, { timeEntryId: base.timeEntryId, storageKey, capturedAt: "2026-03-10T09:30:00Z" });
    for (const name of ["live", "deleted", "file", "document"]) {
      const res = await send(key(name));
      expect(res.status, name).toBe(400);
      expect(res.body).toEqual({ message: "Invalid storageKey" });
    }
    for (const name of ["live", "deleted", "file", "document", "fresh"]) await mint(member.id, { objectPath: key(name) });
    for (const name of ["live", "deleted", "file", "document"]) expect((await send(key(name))).status, name).toBe(400);
    for (const bad of [`/objects/${NUL}`, 7, { a: 1 }]) expect((await send(bad)).status).toBe(400);
    expect((await send(key("fresh"))).status).toBe(200);
    expect((await send(key("fresh"))).status).toBe(400);
  });

  it("takes only an upload handed to this User, in this Workspace, still open, and once", async () => {
    const { admin, member, base } = await setup();
    await plantParallelWorkspace();
    const send = (storageKey: string) =>
      register(member, { timeEntryId: base.timeEntryId, storageKey, capturedAt: "2026-03-10T09:30:00Z" });
    const refused = [
      "/objects/agent-screenshots/never-minted.webp",
      await mint(admin.id),
      await mint(member.id, { expiresAt: new Date(Date.now() - 1000) }),
      await mint(member.id, { workspaceId: PARALLEL_WORKSPACE_ID }),
    ];
    for (const storageKey of refused) {
      const res = await send(storageKey);
      expect(res.status, storageKey).toBe(400);
      expect(res.body).toEqual({ message: "Invalid storageKey" });
    }
    const own = await mint(member.id);
    const both = await Promise.all([send(own), send(own)]);
    expect(both.map((res) => res.status).sort()).toEqual([200, 400]);
  });

  it("hands out an upload that can be registered", async () => {
    const { app } = await setup();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent, { status: "won_in_progress" });
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    const issued = await user.agent.post("/api/time-tracking/screenshots/upload-url").send({ timeEntryId: entry.id });
    expect((await register(user, { timeEntryId: entry.id, storageKey: issued.body.objectPath })).status).toBe(200);
  });

  it("answers 404 to a NUL Time Entry", async () => {
    const { member } = await setup();
    expect((await register(member, { timeEntryId: NUL })).status).toBe(404);
  });
});
