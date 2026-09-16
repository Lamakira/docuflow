import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  accountDeletions,
  memberships,
  notifications,
  users,
  workspaceBilling,
  workspaceRoles,
  workspaces,
} from "../../shared/schema";
import { db } from "../../server/db";
import { makeApp } from "../helpers/app";
import { newAgent, promoteToAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { addWorkspaceMembership, plantParallelWorkspace, removeAllMemberships } from "../helpers/workspace";

/**
 * Workspace lifecycle HTTP (#217, Flows 1, 5, 10).
 * Seam: `/api/workspaces`, `/api/workspaces/:id/owner` and `/api/account/deletion`.
 * A User with no Membership cannot enter a Workspace, so these routes read the
 * identity session and never `isAuthenticated`. Errors stay `{ message }`.
 */

async function ownedWorkspaceCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .where(and(eq(memberships.userId, userId), eq(workspaceRoles.slug, "owner")));
  return rows.length;
}

describe("first Workspace creation (#217, Flow 1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets a User with no Membership create one and become its Owner on a Trial", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Sam" });
    await removeAllMemberships(user.id);

    const empty = await user.agent.get("/api/memberships");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
      activeWorkspaceId: null,
      preferredWorkspaceId: null,
      memberships: [],
    });

    const created = await user.agent.post("/api/workspaces").send({ name: "  Keystone Studio  " });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      workspaceName: "Keystone Studio",
      workspaceRole: "OWNER",
      condition: "Trial",
    });
    expect(typeof created.body.workspaceId).toBe("string");
    expect(created.body.trialEndsAt).toBeTruthy();

    const [billing] = await db
      .select()
      .from(workspaceBilling)
      .where(eq(workspaceBilling.workspaceId, created.body.workspaceId));
    expect(billing.billingState).toBe("Trialing");
    expect(billing.planKey).toBe("trial");
    expect(billing.stripeCustomerId).toBeNull();
    expect(billing.stripeSubscriptionId).toBeNull();

    const listed = await user.agent.get("/api/memberships");
    expect(listed.status).toBe(200);
    expect(listed.body.activeWorkspaceId).toBe(created.body.workspaceId);
    expect(listed.body.memberships).toEqual([
      expect.objectContaining({
        workspaceId: created.body.workspaceId,
        workspaceName: "Keystone Studio",
        workspaceRole: "OWNER",
        condition: "Trial",
      }),
    ]);

    // The Workspace is usable at once: the three built-in Roles exist.
    const roles = await db
      .select({ slug: workspaceRoles.slug })
      .from(workspaceRoles)
      .where(eq(workspaceRoles.workspaceId, created.body.workspaceId));
    expect(roles.map((row) => row.slug).sort()).toEqual(["administrator", "member", "owner"]);

    // And an ordinary Workspace read now works, which it could not before.
    const today = await user.agent.get("/api/crm/projects?pageSize=1");
    expect(today.status).toBe(200);
  });

  it("refuses an anonymous caller and an empty name with { message }", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    await removeAllMemberships(user.id);

    const anonymous = await newAgent(app).post("/api/workspaces").send({ name: "Keystone" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ message: "Unauthorized" });

    const blank = await user.agent.post("/api/workspaces").send({ name: "   " });
    expect(blank.status).toBe(400);
    expect(blank.body.message).toMatch(/name/i);
    expect(blank.body).not.toHaveProperty("type");
  });

  it("does not force a User who already holds a Membership through creation", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const listed = await user.agent.get("/api/memberships");
    expect(listed.body.memberships.length).toBeGreaterThan(0);
    expect(listed.body.activeWorkspaceId).not.toBeNull();

    // Creating another is still allowed — it is a choice, not a gate.
    const created = await user.agent.post("/api/workspaces").send({ name: "Second" });
    expect(created.status).toBe(201);
  });
});

describe("account deletion is guided and reversible (#217, Flow 10)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("states the precondition and refuses to start while a Workspace is owned", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Sam" });
    await setWorkspaceRole(owner.id, "owner");
    const colleague = await registerUser(app, { firstName: "Dana" });

    const state = await owner.agent.get("/api/account/deletion");
    expect(state.status).toBe(200);
    expect(state.body.gracePeriodDays).toBeGreaterThan(0);
    expect(state.body.scheduled).toBeNull();
    expect(state.body.ownedWorkspaces).toHaveLength(1);
    expect(state.body.ownedWorkspaces[0]).toMatchObject({ otherActiveMembers: 1 });
    expect(state.body.ownedWorkspaces[0].members).toEqual([
      expect.objectContaining({ userId: colleague.id }),
    ]);

    const refused = await owner.agent.post("/api/account/deletion");
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/transfer|delete/i);
    expect(refused.body).not.toHaveProperty("type");
  });

  it("transfers ownership, then starts a cancelable grace window", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Sam" });
    await setWorkspaceRole(owner.id, "owner");
    const colleague = await registerUser(app, { firstName: "Dana" });
    const workspaceId = (await owner.agent.get("/api/memberships")).body.activeWorkspaceId;

    const transferred = await owner.agent
      .post(`/api/workspaces/${workspaceId}/owner`)
      .send({ userId: colleague.id });
    expect(transferred.status).toBe(200);
    expect(transferred.body).toMatchObject({ workspaceId, ownerUserId: colleague.id });
    expect(await ownedWorkspaceCount(owner.id)).toBe(0);
    expect(await ownedWorkspaceCount(colleague.id)).toBe(1);

    const started = await owner.agent.post("/api/account/deletion");
    expect(started.status).toBe(201);
    expect(new Date(started.body.completesAt).getTime()).toBeGreaterThan(
      new Date(started.body.requestedAt).getTime(),
    );

    const again = await owner.agent.post("/api/account/deletion");
    expect(again.status).toBe(409);

    const state = await owner.agent.get("/api/account/deletion");
    expect(state.body.scheduled).toMatchObject({ completesAt: started.body.completesAt });

    const canceled = await owner.agent.delete("/api/account/deletion");
    expect(canceled.status).toBe(200);
    expect(canceled.body).toEqual({ scheduled: null });

    const after = await owner.agent.get("/api/account/deletion");
    expect(after.body.scheduled).toBeNull();
    // The account itself is untouched by a canceled window.
    expect((await owner.agent.get("/api/auth/user")).body.email).toBe(owner.email);
  });

  it("deletes a Workspace only when its Owner is the last Member, and only on the typed name", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Sam" });
    await setWorkspaceRole(owner.id, "owner");
    const colleague = await registerUser(app);
    const workspaceId = (await owner.agent.get("/api/memberships")).body.activeWorkspaceId;

    const shared = await owner.agent
      .delete(`/api/workspaces/${workspaceId}`)
      .send({ confirmName: "DocuFlow" });
    expect(shared.status).toBe(409);
    expect(shared.body.message).toMatch(/Member/);

    await db.delete(memberships).where(eq(memberships.userId, colleague.id));

    const mistyped = await owner.agent
      .delete(`/api/workspaces/${workspaceId}`)
      .send({ confirmName: "docuflow" });
    expect(mistyped.status).toBe(400);
    expect(mistyped.body.message).toMatch(/name/i);

    const deleted = await owner.agent
      .delete(`/api/workspaces/${workspaceId}`)
      .send({ confirmName: "DocuFlow" });
    expect(deleted.status).toBe(200);

    const remaining = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(remaining).toEqual([]);
  });

  it("refuses a Member who is not the Owner of that Workspace", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const member = await registerUser(app);
    const workspaceId = (await member.agent.get("/api/memberships")).body.activeWorkspaceId;

    const transfer = await member.agent
      .post(`/api/workspaces/${workspaceId}/owner`)
      .send({ userId: owner.id });
    expect(transfer.status).toBe(403);
    expect(transfer.body).toEqual({ message: "Access denied" });

    const remove = await member.agent
      .delete(`/api/workspaces/${workspaceId}`)
      .send({ confirmName: "DocuFlow" });
    expect(remove.status).toBe(403);
  });

  it("keeps the existing admin rule that a User cannot delete their own account", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    await promoteToAdmin(admin.id);

    const own = await admin.agent.delete(`/api/admin/users/${admin.id}`);
    expect(own.status).toBe(400);
    expect(own.body).toEqual({ message: "Cannot delete your own account" });
  });
});

describe("erasure completes without purging another controller's records (#217, ADR-0015)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("pseudonymizes the Membership in place and notifies each affected Workspace", async () => {
    const app = await makeApp();
    const leaving = await registerUser(app, { firstName: "Sam", lastName: "Reyes" });
    const owner = await registerUser(app, { firstName: "Dana" });
    await setWorkspaceRole(owner.id, "owner");
    const parallelId = await plantParallelWorkspace();
    await addWorkspaceMembership(leaving.id, parallelId, "member");

    const started = await leaving.agent.post("/api/account/deletion");
    expect(started.status).toBe(201);

    const { completeDueAccountDeletions } = await import(
      "../../server/modules/workspace/accountDeletion"
    );

    const early = await completeDueAccountDeletions(new Date(started.body.requestedAt));
    expect(early).toBe(0);

    const due = new Date(new Date(started.body.completesAt).getTime() + 1000);
    expect(await completeDueAccountDeletions(due)).toBe(1);
    // Idempotent: a second pass over the same window completes nothing.
    expect(await completeDueAccountDeletions(due)).toBe(0);

    const [row] = await db.select().from(users).where(eq(users.id, leaving.id));
    expect(row.email).not.toBe(leaving.email);
    expect(row.email).toContain(leaving.id);
    expect(row.firstName).toBeNull();
    expect(row.lastName).toBeNull();
    expect(row.identityProviderSubjectId).toBeNull();
    expect(row.isArchived).toBe(true);

    // Memberships stay so operational and audit records keep their references.
    const kept = await db
      .select({ workspaceId: memberships.workspaceId, archivedAt: memberships.archivedAt })
      .from(memberships)
      .where(eq(memberships.userId, leaving.id));
    expect(kept).toHaveLength(2);
    expect(kept.every((membership) => membership.archivedAt !== null)).toBe(true);

    const [deletion] = await db
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.userId, leaving.id));
    expect(deletion.status).toBe("completed");

    const told = await db
      .select({ userId: notifications.userId, message: notifications.message })
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(told).toHaveLength(1);
    expect(told[0].message).toMatch(/account/i);
  });
});
