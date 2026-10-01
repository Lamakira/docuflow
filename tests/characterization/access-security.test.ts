import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents, notifications, supportAccessGrants } from "@shared/schema";
import { db } from "../../server/db";
import { makeApp } from "../helpers/app";
import {
  registerAdmin,
  registerPlatformStaff,
  registerUser,
  setWorkspaceRole,
  signIn,
  uniqueEmail,
} from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Access security (#300, ADR-0015).
 *
 * Operator routes are Platform Staff, not `users.role`. A Support Access Grant
 * is read-only and stops the moment it expires or is revoked. Break-glass is
 * the only other read, and it is audited and told to the Owner. A Workspace
 * can require a second factor; until it does, an Owner without one can still
 * invite and check out.
 */

describe("operator access is Platform Staff, not users.role (#300)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses a customer User with role admin every operator route", async () => {
    const app = await makeApp();
    const customerAdmin = await registerAdmin(app);

    const directory = await customerAdmin.agent.get("/api/admin/users");
    expect(directory.status).toBe(403);
    expect(directory.body).toEqual({ message: "Access denied" });

    const content = await customerAdmin.agent.get("/api/operator/workspaces/seeded");
    expect(content.status).toBe(403);
    expect(content.body).toEqual({ message: "Access denied" });
  });

  it("refuses Platform Staff sign-in without a second factor", async () => {
    const app = await makeApp();
    const staff = await registerPlatformStaff(app, { secondFactor: false });

    const directory = await staff.agent.get("/api/admin/users");
    expect(directory.status).toBe(401);
    expect(directory.body).toEqual({ message: "A second factor is required", code: "setup-mfa" });
  });

  it("reads no Workspace content without a grant, and break-glass is audited and told to the Owner", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const staff = await registerPlatformStaff(app);

    const denied = await staff.agent.get("/api/operator/workspaces/seeded");
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ message: "Access denied" });

    const missing = await staff.agent.post("/api/operator/workspaces/seeded/break-glass").send({ reason: "   " });
    expect(missing.status).toBe(400);

    const opened = await staff.agent
      .post("/api/operator/workspaces/seeded/break-glass")
      .send({ reason: "Customer cannot sign in" });
    expect(opened.status).toBe(201);

    const read = await staff.agent.get("/api/operator/workspaces/seeded");
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: "seeded", access: "break_glass" });

    const events = await inSeededWorkspace(() =>
      db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.actorId, staff.staffId))
        .orderBy(auditEvents.createdAt),
    );
    expect(events.map((event) => event.action)).toEqual([
      "support_access.break_glass",
      "support_access.used",
    ]);

    const notices = await inSeededWorkspace(() =>
      db
        .select({ type: notifications.type, userId: notifications.userId })
        .from(notifications)
        .where(eq(notifications.type, "break_glass")),
    );
    expect(notices).toEqual([{ type: "break_glass", userId: owner.id }]);
  });

  it("refuses every write under a Support Access Grant", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const staff = await registerPlatformStaff(app);

    const created = await owner.agent.post("/api/admin/support-access-grants").send({ platformStaffId: staff.staffId });
    expect(created.status).toBe(201);
    const expiresAt = new Date(created.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);

    const tooLong = await owner.agent
      .post("/api/admin/support-access-grants")
      .send({ platformStaffId: staff.staffId, hours: 24 * 7 + 1 });
    expect(tooLong.status).toBe(400);

    const read = await staff.agent.get("/api/operator/workspaces/seeded");
    expect(read.status).toBe(200);
    expect(read.body.access).toBe("grant");

    const write = await staff.agent.post("/api/operator/workspaces/seeded").send({ name: "Renamed" });
    expect(write.status).toBe(403);
    expect(write.body).toEqual({ message: "Support access is read-only" });

    const granted = await inSeededWorkspace(() =>
      db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.action, "support_access.granted")),
    );
    expect(granted).toHaveLength(1);
    const used = await inSeededWorkspace(() =>
      db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.action, "support_access.used")),
    );
    expect(used).toHaveLength(1);
    const told = await inSeededWorkspace(() =>
      db.select({ userId: notifications.userId }).from(notifications).where(eq(notifications.type, "support_access_granted")),
    );
    expect(told).toEqual([{ userId: owner.id }]);
  });

  it("stops access the moment a grant expires or is revoked", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const staff = await registerPlatformStaff(app);

    const created = await owner.agent
      .post("/api/admin/support-access-grants")
      .send({ platformStaffId: staff.staffId, hours: 24 * 7 });
    expect(created.status).toBe(201);

    await inSeededWorkspace(() =>
      db
        .update(supportAccessGrants)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(supportAccessGrants.id, created.body.id)),
    );

    const expired = await staff.agent.get("/api/operator/workspaces/seeded");
    expect(expired.status).toBe(403);
    const expiry = await inSeededWorkspace(() =>
      db
        .select({ resourceId: auditEvents.resourceId })
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "support_access.expired"), eq(auditEvents.resourceId, created.body.id))),
    );
    expect(expiry).toHaveLength(1);

    const again = await owner.agent.post("/api/admin/support-access-grants").send({ platformStaffId: staff.staffId });
    expect(again.status).toBe(201);
    const revoked = await owner.agent.post(`/api/admin/support-access-grants/${again.body.id}/revoke`);
    expect(revoked.status).toBe(200);

    const after = await staff.agent.get("/api/operator/workspaces/seeded");
    expect(after.status).toBe(403);
    const revocation = await inSeededWorkspace(() =>
      db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.action, "support_access.revoked")),
    );
    expect(revocation).toHaveLength(1);

    const visible = await owner.agent.get("/api/workspace/support-access-grants");
    expect(visible.status).toBe(200);
    expect(visible.body).toEqual([]);
  });

  it("requires a second factor only when the Workspace asks, and only the Owner can ask", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const administrator = await registerUser(app);
    await setWorkspaceRole(administrator.id, "administrator");

    const invite = await owner.agent.post("/api/workspace/invitations").send({
      email: uniqueEmail("invitee"),
      workspaceRole: "MEMBER",
    });
    expect(invite.status).toBe(201);

    const checkout = await owner.agent.post("/api/billing/checkout").send({
      planKey: "business",
      interval: "monthly",
      seatQuantity: 3,
      successUrl: "https://app.docuflow.test/billing/return",
      cancelUrl: "https://app.docuflow.test/billing/cancel",
    });
    expect(checkout.status).not.toBe(403);
    expect(checkout.body.code).not.toBe("setup-mfa");

    const refused = await administrator.agent.patch("/api/admin/two-factor").send({ required: true });
    expect(refused.status).toBe(403);

    const required = await owner.agent.patch("/api/admin/two-factor").send({ required: true });
    expect(required.status).toBe(200);
    expect(required.body).toEqual({ required: true });

    const blockedInvite = await owner.agent.post("/api/workspace/invitations").send({
      email: uniqueEmail("invitee"),
      workspaceRole: "MEMBER",
    });
    expect(blockedInvite.status).toBe(403);
    expect(blockedInvite.body).toEqual({
      message: "This Workspace requires a second factor",
      code: "setup-mfa",
    });

    const blockedCheckout = await owner.agent.post("/api/billing/checkout").send({
      planKey: "business",
      interval: "monthly",
      seatQuantity: 3,
      successUrl: "https://app.docuflow.test/billing/return",
      cancelUrl: "https://app.docuflow.test/billing/cancel",
    });
    expect(blockedCheckout.status).toBe(403);
    expect(blockedCheckout.body.code).toBe("setup-mfa");

    const verified = await signIn(app, owner.id, { secondFactor: true });
    const allowed = await verified.post("/api/workspace/invitations").send({
      email: uniqueEmail("invitee"),
      workspaceRole: "MEMBER",
    });
    expect(allowed.status).toBe(201);
  });
});
