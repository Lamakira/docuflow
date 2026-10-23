import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PARALLEL_WORKSPACE_ID, memberships, notifications, orgSettings } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { ownerDb, resetDb } from "../helpers/db";
import { grantDailyUpdatesAccess, promoteToAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { createCrmProject } from "../helpers/fixtures";
import { addWorkspaceMembership, plantParallelWorkspace, removeAllMemberships } from "../helpers/workspace";

/**
 * Readers are told of a new Daily Update (#341, Part A), and the Workspace time
 * zone is set where it is written. Seam: `POST /api/daily-updates`,
 * `/api/admin/org-settings` and `POST /api/workspaces`. The server runs as
 * `docuflow_app`, so Workspace isolation here is row-level security.
 */

async function inbox(userId: string) {
  return ownerDb.select().from(notifications).where(eq(notifications.userId, userId));
}

async function submit(agent: { post: (url: string) => any }, crmProjectId: string) {
  const res = await agent.post("/api/daily-updates").send({ crmProjectId, status: "on_track" });
  expect(res.status).toBe(201);
  return res.body;
}

describe("Daily Update reader notifications", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function setup() {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Olga" });
    await setWorkspaceRole(owner.id, "owner");
    const admin = await registerUser(app, { firstName: "Adam" });
    await promoteToAdmin(admin.id);
    const manager = await registerUser(app, { firstName: "Mona" });
    await grantDailyUpdatesAccess(manager.id);
    const plain = await registerUser(app, { firstName: "Pat" });
    const author = await registerUser(app, { firstName: "Ada" });
    const first = await createCrmProject(admin.agent, { name: "Atlas", memberIds: [author.id] });
    const second = await createCrmProject(admin.agent, { name: "Borealis", memberIds: [author.id] });
    return { app, owner, admin, manager, plain, author, first, second };
  }

  it("notifies every reader once on a Member's first Daily Update of the day, and nobody on the second", async () => {
    const { owner, admin, manager, plain, author, first, second } = await setup();

    const update = await submit(author.agent, first.crmProject.id);

    for (const reader of [owner, admin, manager]) {
      const rows = await inbox(reader.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "daily_update_submitted",
        fromUserId: author.id,
        crmProjectId: first.crmProject.id,
        message: "Ada submitted a Daily Update for Atlas",
        isRead: 0,
      });
    }
    expect(await inbox(plain.id)).toEqual([]);
    expect(await inbox(author.id)).toEqual([]);
    expect(update.userId).toBe(author.id);

    await submit(author.agent, second.crmProject.id);
    for (const reader of [owner, admin, manager]) {
      expect(await inbox(reader.id)).toHaveLength(1);
    }
  });

  it("never notifies the author, even when the author is a reader", async () => {
    const { owner, admin, manager, first } = await setup();

    await submit(admin.agent, first.crmProject.id);

    expect(await inbox(admin.id)).toEqual([]);
    expect(await inbox(owner.id)).toHaveLength(1);
    expect(await inbox(manager.id)).toHaveLength(1);
  });

  it("does not notify on an edit", async () => {
    const { owner, author, first } = await setup();
    const update = await submit(author.agent, first.crmProject.id);
    const before = await inbox(owner.id);

    const edited = await author.agent.patch(`/api/daily-updates/${update.id}`).send({ whatHappened: "More" });
    expect(edited.status).toBe(200);

    expect(await inbox(owner.id)).toHaveLength(before.length);
  });

  it("skips an archived Membership", async () => {
    const { admin, manager, author, first } = await setup();
    await ownerDb.update(memberships).set({ archivedAt: new Date() }).where(eq(memberships.userId, manager.id));

    await submit(author.agent, first.crmProject.id);

    expect(await inbox(manager.id)).toEqual([]);
    expect(await inbox(admin.id)).toHaveLength(1);
  });

  it("keeps a reader of another Workspace out of it", async () => {
    const { app, author, first } = await setup();
    await plantParallelWorkspace();
    const outsider = await registerUser(app, { firstName: "Bea" });
    await removeAllMemberships(outsider.id);
    await addWorkspaceMembership(outsider.id, PARALLEL_WORKSPACE_ID, "administrator");

    await submit(author.agent, first.crmProject.id);

    expect(await inbox(outsider.id)).toEqual([]);
  });
});

describe("Workspace time zone (#341)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets an Administrator set it and refuses a Member and an unknown zone", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await promoteToAdmin(admin.id);
    const member = await registerUser(app);

    expect((await admin.agent.get("/api/admin/org-settings")).body.timeZone).toBe("America/Toronto");

    const set = await admin.agent.patch("/api/admin/org-settings").send({ timeZone: "Europe/Paris" });
    expect(set.status).toBe(200);
    expect((await admin.agent.get("/api/admin/org-settings")).body.timeZone).toBe("Europe/Paris");

    expect((await member.agent.patch("/api/admin/org-settings").send({ timeZone: "Asia/Tokyo" })).status).toBe(403);
    expect((await admin.agent.patch("/api/admin/org-settings").send({ timeZone: "Mars/Olympus" })).status).toBe(400);
    expect((await admin.agent.get("/api/admin/org-settings")).body.timeZone).toBe("Europe/Paris");
  });

  it("lets an Owner set it", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");

    const set = await owner.agent.patch("/api/admin/org-settings").send({ timeZone: "Asia/Tokyo" });
    expect(set.status).toBe(200);
    expect((await owner.agent.get("/api/admin/org-settings")).body.timeZone).toBe("Asia/Tokyo");
  });

  async function createdZone(timeZone: unknown): Promise<string | null> {
    const app = await makeApp();
    const user = await registerUser(app);
    await removeAllMemberships(user.id);
    const created = await user.agent.post("/api/workspaces").send({ name: "Keystone", timeZone });
    expect(created.status).toBe(201);
    const [row] = await ownerDb
      .select({ timeZone: orgSettings.timeZone })
      .from(orgSettings)
      .where(eq(orgSettings.workspaceId, created.body.workspaceId));
    return row?.timeZone ?? null;
  }

  it("stores the creator's zone on a new Workspace", async () => {
    expect(await createdZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("falls back silently when the zone is unknown", async () => {
    expect(await createdZone("Mars/Olympus")).toBeNull();
    expect(await createdZone(42)).toBeNull();
  });
});
