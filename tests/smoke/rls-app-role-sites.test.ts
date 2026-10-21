import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  auditEvents,
  deviceEnrollments,
  jobs,
  memberships,
  notifications,
  PARALLEL_WORKSPACE_ID,
  SEEDED_WORKSPACE_ID,
  workspaceBilling,
  workspaceRoles,
  workspaces,
} from "../../shared/schema";
import { FakeBillingProvider } from "../fakes/billingProvider";
import { makeApp } from "../helpers/app";
import { loginDevice } from "../helpers/agent";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { registerUser, setWorkspaceRole } from "../helpers/auth";
import { ownerDb, resetDb } from "../helpers/db";
import { addWorkspaceMembership, plantParallelWorkspace } from "../helpers/workspace";

/**
 * The sites that read across Workspaces or resolve one before it is known
 * (#323). The harness runs the app pool as `docuflow_app`, so each of these
 * returned nothing, or refused, before the locator functions: every fixture
 * here is written as the owner, and everything under test goes through app code.
 */

async function memberInTwoWorkspaces(app: Awaited<ReturnType<typeof makeApp>>) {
  const user = await registerUser(app, { firstName: "Ada" });
  await plantParallelWorkspace();
  await addWorkspaceMembership(user.id, PARALLEL_WORKSPACE_ID, "member");
  return user;
}

async function membershipRows(userId: string) {
  return ownerDb.select().from(memberships).where(eq(memberships.userId, userId));
}

describe("Workspace switching under docuflow_app (#323)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists Memberships across two Workspaces and switches to the second", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);

    const listed = await user.agent.get("/api/memberships");
    expect(listed.status).toBe(200);
    expect(listed.body.activeWorkspaceId).toBe(SEEDED_WORKSPACE_ID);
    expect(listed.body.memberships.map((row: { workspaceName: string }) => row.workspaceName)).toEqual([
      "DocuFlow",
      "Harbour View",
    ]);

    const switched = await user.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });
    expect(switched.status).toBe(200);
    expect(switched.body.activeWorkspaceId).toBe(PARALLEL_WORKSPACE_ID);
    expect(switched.body.preferredWorkspaceId).toBe(PARALLEL_WORKSPACE_ID);

    const after = await user.agent.get("/api/memberships");
    expect(after.body.activeWorkspaceId).toBe(PARALLEL_WORKSPACE_ID);
    expect(after.body.memberships[0]).toMatchObject({ workspaceId: PARALLEL_WORKSPACE_ID, workspaceRole: "MEMBER" });
  });

  it("refuses a Workspace the User does not belong to", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    await plantParallelWorkspace();

    const refused = await user.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });
    expect(refused.status).toBe(400);
  });
});

describe("Workspace ownership and deletion under docuflow_app (#323)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("transfers ownership, then deletes a Workspace its Owner is alone in", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Sam" });
    const successor = await registerUser(app, { firstName: "Pat" });
    await plantParallelWorkspace();
    await addWorkspaceMembership(owner.id, PARALLEL_WORKSPACE_ID, "owner");
    await addWorkspaceMembership(successor.id, PARALLEL_WORKSPACE_ID, "member");

    const { transferWorkspaceOwnership, deleteWorkspace } = await import(
      "../../server/modules/workspace/firstWorkspace"
    );
    await transferWorkspaceOwnership(owner.id, PARALLEL_WORKSPACE_ID, successor.id);

    const roleOf = async (userId: string) => {
      const [row] = await ownerDb
        .select({ slug: workspaceRoles.slug })
        .from(memberships)
        .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
        .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, PARALLEL_WORKSPACE_ID)));
      return row.slug;
    };
    expect(await roleOf(successor.id)).toBe("owner");
    expect(await roleOf(owner.id)).toBe("administrator");
    const audited = await ownerDb
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, PARALLEL_WORKSPACE_ID));
    expect(audited.map((row) => row.action)).toEqual(["workspace.ownership_transferred"]);

    // The old Owner is no longer the Owner, and the new one is not alone.
    await expect(
      deleteWorkspace(owner.id, PARALLEL_WORKSPACE_ID, { confirmName: "Harbour View" }),
    ).rejects.toThrow();
    await ownerDb
      .delete(memberships)
      .where(and(eq(memberships.userId, owner.id), eq(memberships.workspaceId, PARALLEL_WORKSPACE_ID)));
    await expect(
      deleteWorkspace(successor.id, PARALLEL_WORKSPACE_ID, { confirmName: "Harbour View" }),
    ).resolves.toEqual({ workspaceId: PARALLEL_WORKSPACE_ID, deleted: true });
    expect(await ownerDb.select().from(workspaces).where(eq(workspaces.id, PARALLEL_WORKSPACE_ID))).toEqual([]);
  });
});

describe("account deletion under docuflow_app (#323)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("shows the state, schedules, and completes across the User's Workspaces", async () => {
    const app = await makeApp();
    const leaver = await memberInTwoWorkspaces(app);
    const owner = await registerUser(app, { firstName: "Sam" });
    await setWorkspaceRole(owner.id, "owner");
    await addWorkspaceMembership(owner.id, PARALLEL_WORKSPACE_ID, "owner");

    const state = await leaver.agent.get("/api/account/deletion");
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ownedWorkspaces: [], scheduled: null });

    const requested = await leaver.agent.post("/api/account/deletion").send({});
    expect(requested.status).toBe(201);
    const requestedAudits = await ownerDb
      .select({ workspaceId: auditEvents.workspaceId })
      .from(auditEvents)
      .where(eq(auditEvents.action, "account.deletion_requested"));
    expect(requestedAudits.map((row) => row.workspaceId).sort()).toEqual([PARALLEL_WORKSPACE_ID, SEEDED_WORKSPACE_ID].sort());

    const { completeDueAccountDeletions } = await import("../../server/modules/workspace/accountDeletion");
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await expect(completeDueAccountDeletions(later)).resolves.toBe(1);

    const rows = await membershipRows(leaver.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.archivedAt !== null)).toBe(true);
    const erased = await ownerDb
      .select({ workspaceId: auditEvents.workspaceId })
      .from(auditEvents)
      .where(eq(auditEvents.action, "account.erased"));
    expect(erased.map((row) => row.workspaceId).sort()).toEqual([PARALLEL_WORKSPACE_ID, SEEDED_WORKSPACE_ID].sort());
    const told = await ownerDb
      .select({ workspaceId: notifications.workspaceId, userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.type, "account_deleted"));
    expect(told.map((row) => row.workspaceId).sort()).toEqual([PARALLEL_WORKSPACE_ID, SEEDED_WORKSPACE_ID].sort());
    expect(told.every((row) => row.userId === owner.id)).toBe(true);
  });
});

describe("archiving and restoring a User under docuflow_app (#323)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("archives every Membership and restores them in each Workspace", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    const { storage } = await import("../../server/storage");

    await storage.archiveUser(user.id, true);
    const archived = await membershipRows(user.id);
    expect(archived).toHaveLength(2);
    expect(archived.every((row) => row.archivedAt !== null)).toBe(true);

    await storage.archiveUser(user.id, false);
    const restored = await membershipRows(user.id);
    expect(restored).toHaveLength(2);
    expect(restored.every((row) => row.archivedAt === null)).toBe(true);
  });
});

describe("notifications under docuflow_app (#323)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists notifications from every Workspace the User belongs to, newest first", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    await ownerDb.insert(notifications).values([
      { userId: user.id, workspaceId: SEEDED_WORKSPACE_ID, message: "older", createdAt: new Date("2026-01-01T00:00:00Z") },
      { userId: user.id, workspaceId: PARALLEL_WORKSPACE_ID, message: "newer", createdAt: new Date("2026-02-01T00:00:00Z") },
    ]);

    const listed = await user.agent.get("/api/notifications");
    expect(listed.status).toBe(200);
    expect(
      listed.body.map((row: { message: string; workspace?: { name: string } }) => [row.message, row.workspace?.name]),
    ).toEqual([
      ["newer", "Harbour View"],
      ["older", "DocuFlow"],
    ]);
  });

  async function plantTwo(userId: string, otherUserId: string) {
    const rows = await ownerDb
      .insert(notifications)
      .values([
        { userId, workspaceId: SEEDED_WORKSPACE_ID, message: "here" },
        { userId, workspaceId: PARALLEL_WORKSPACE_ID, message: "there" },
        { userId: otherUserId, workspaceId: PARALLEL_WORKSPACE_ID, message: "not yours" },
      ])
      .returning();
    return Object.fromEntries(rows.map((row) => [row.message, row]));
  }

  async function isRead(id: string) {
    const [row] = await ownerDb.select().from(notifications).where(eq(notifications.id, id));
    return row.isRead;
  }

  it("marks a notification from another Workspace read, and counts unread across both", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    const other = await registerUser(app, { firstName: "Bo" });
    await addWorkspaceMembership(other.id, PARALLEL_WORKSPACE_ID, "member");
    const planted = await plantTwo(user.id, other.id);

    const before = await user.agent.get("/api/notifications/unread-count");
    expect(before.body).toEqual({ count: 2 });

    const marked = await user.agent.patch(`/api/notifications/${planted.there.id}/read`);
    expect(marked.status).toBe(200);
    expect(await isRead(planted.there.id)).toBe(1);
    expect(await isRead(planted.here.id)).toBe(0);
    expect((await user.agent.get("/api/notifications/unread-count")).body).toEqual({ count: 1 });

    // Another User's notification is not theirs to mark.
    await user.agent.patch(`/api/notifications/${planted["not yours"].id}/read`);
    expect(await isRead(planted["not yours"].id)).toBe(0);
  });

  it("marks every notification read across two Workspaces, and only the caller's", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    const other = await registerUser(app, { firstName: "Bo" });
    await addWorkspaceMembership(other.id, PARALLEL_WORKSPACE_ID, "member");
    const planted = await plantTwo(user.id, other.id);

    const marked = await user.agent.patch("/api/notifications/mark-all-read");
    expect(marked.status).toBe(200);
    expect(await isRead(planted.here.id)).toBe(1);
    expect(await isRead(planted.there.id)).toBe(1);
    expect(await isRead(planted["not yours"].id)).toBe(0);
    expect((await user.agent.get("/api/notifications/unread-count")).body).toEqual({ count: 0 });
  });
});

describe("Stripe webhook ingest under docuflow_app (#323)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("enqueues the projection Job in the Workspace the Subscription belongs to", async () => {
    const { ingestBillingWebhook } = await import("../../server/modules/billing");
    const { BILLING_PROJECT_JOB, BILLING_PROJECT_JOB_TYPE } = await import("../../server/modules/billing");
    const { createJobsPort } = await import("../../server/jobs");
    const { db } = await import("../../server/db");

    await ownerDb.insert(workspaces).values({ id: "paid", name: "Paid" });
    await ownerDb.insert(workspaceBilling).values({
      workspaceId: "paid",
      planKey: "trial",
      registryVersion: 1,
      billingState: "Trialing",
      purchasedSeatCapacity: 1,
      authorizationVersion: 1,
      stripeCustomerId: "cus_fake_1",
      stripeSubscriptionId: "sub_fake_1",
      trialEndsAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    const result = await ingestBillingWebhook({
      provider: new FakeBillingProvider(),
      jobs: createJobsPort({ db, types: { [BILLING_PROJECT_JOB]: BILLING_PROJECT_JOB_TYPE } }),
      payload: JSON.stringify({
        providerEventId: "evt_fake_1",
        type: "customer.subscription.updated",
        objectId: "sub_fake_1",
      }),
      signature: "signed",
    });
    expect(result).toMatchObject({ accepted: true, duplicate: false, enqueued: true });

    const queued = await ownerDb.select({ workspaceId: jobs.workspaceId, type: jobs.type }).from(jobs);
    expect(queued).toEqual([{ workspaceId: "paid", type: BILLING_PROJECT_JOB }]);
  });
});

describe("desktop agent Timer across Workspaces under docuflow_app (#323)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns a Timer started in Workspace A when the Device is enrolled in Workspace B", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    const device = await loginDevice(app, user);
    const { crmProject } = await createCrmProject(user.agent, { name: "Northwind" });
    const task = await createTask(user.agent, crmProject.id);
    const timer = await startTimer(user.agent, crmProject.id, task.id);

    const [inB] = await ownerDb
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.workspaceId, PARALLEL_WORKSPACE_ID)));
    await ownerDb
      .update(deviceEnrollments)
      .set({ workspaceId: PARALLEL_WORKSPACE_ID, membershipId: inB.id })
      .where(eq(deviceEnrollments.deviceId, device.deviceId));

    const active = await device.request.get("/api/agent/timer/active");
    expect(active.status).toBe(200);
    expect(active.body.id).toBe(timer.id);
    expect(active.body.workspaceId).toBe(SEEDED_WORKSPACE_ID);
  });
});
