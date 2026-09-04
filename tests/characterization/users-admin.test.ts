import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import {
  makeMainAdmin,
  registerAdmin,
  registerUser,
  uniqueEmail,
} from "../helpers/auth";
import { emailsTo, sentEmails } from "../fakes/resend";

/**
 * Characterization: user directory, admin user management, and IdentityProvider
 * password-set invites on create and reset.
 *
 * Quirks frozen here:
 *  - `GET /api/users` hides archived users from everyone; only an admin passing
 *    `includeArchived=true` sees them.
 *  - `POST /api/admin/users` echoes the freshly inserted row, so a user created
 *    with `role: "admin"` comes back as `role: "user"` — the promotion happens
 *    after the row the response was built from.
 *  - Create and reset invite at the IdentityProvider (#160). They do not return
 *    a generated password, and `GET /api/admin/users/:id` does not serve
 *    `lastGeneratedPassword`.
 *  - SuperAdmin protection is per-route and inconsistent: role, update, archive,
 *    reset-password and delete each guard it differently.
 *  - Deleting a user answers 200 `{ success: true }`, not 204.
 */
describe("users and admin management (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists non-archived users to everyone, and archived ones only to admins who ask", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app, { firstName: "Ann" });
    const member = await registerUser(app, { firstName: "Bob" });
    const archived = await registerUser(app, { firstName: "Cid" });

    await admin.agent.patch(`/api/admin/users/${archived.id}/archive`).send({ isArchived: true });

    const asMember = await member.agent.get("/api/users");
    expect(asMember.status).toBe(200);
    expect(asMember.body.map((u: { id: string }) => u.id).sort()).toEqual([admin.id, member.id].sort());
    // The directory is the "safe" projection: no password, no generated password.
    expect(asMember.body[0]).not.toHaveProperty("password");
    expect(asMember.body[0]).not.toHaveProperty("lastGeneratedPassword");

    // Quirk: a non-admin asking for archived users is ignored rather than refused.
    const memberAsking = await member.agent.get("/api/users").query({ includeArchived: "true" });
    expect(memberAsking.body).toHaveLength(2);

    const adminAsking = await admin.agent.get("/api/users").query({ includeArchived: "true" });
    expect(adminAsking.body).toHaveLength(3);
    expect(adminAsking.body.find((u: { id: string }) => u.id === archived.id).isArchived).toBe(true);
  });

  it("refuses the admin routes to non-admins", async () => {
    const app = await makeApp();
    const member = await registerUser(app);

    const list = await member.agent.get("/api/admin/users");
    expect(list.status).toBe(403);
    expect(list.body).toEqual({ message: "Access denied" });

    const settings = await member.agent.get("/api/admin/org-settings");
    expect(settings.status).toBe(403);
    expect(settings.body).toEqual({ message: "Access denied" });
  });

  it("creates a user, invites them at the IdentityProvider, and reports the pre-promotion row", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const email = uniqueEmail("created");

    const res = await admin.agent.post("/api/admin/users").send({
      email,
      firstName: "New",
      lastName: "Hire",
      role: "admin",
    });

    expect(res.status).toBe(201);
    expect(res.body.inviteSent).toBe(true);
    expect(res.body).not.toHaveProperty("generatedPassword");
    expect(res.body).not.toHaveProperty("emailSent");
    expect(res.body.user).toMatchObject({
      email,
      firstName: "New",
      lastName: "Hire",
      // Quirk: the role update runs after this row was read, so the response
      // still says "user" even though the User is an admin.
      role: "user",
    });
    expect(res.body.user).not.toHaveProperty("password");
    expect(res.body.user).not.toHaveProperty("lastGeneratedPassword");

    expect(emailsTo(email)).toHaveLength(0);

    const details = await admin.agent.get(`/api/admin/users/${res.body.user.id}`);
    expect(details.status).toBe(200);
    expect(details.body.role).toBe("admin");

    const duplicate = await admin.agent
      .post("/api/admin/users")
      .send({ email, firstName: "Dup", lastName: "Licate" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ message: "User with this email already exists" });

    const invalid = await admin.agent.post("/api/admin/users").send({ email: "nope" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid user data");
  });

  it("serves admin user details minus the hash and any generated password", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const created = await admin.agent
      .post("/api/admin/users")
      .send({ email: uniqueEmail("details"), firstName: "De", lastName: "Tails" });

    const res = await admin.agent.get(`/api/admin/users/${created.body.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("lastGeneratedPassword");

    const missing = await admin.agent.get("/api/admin/users/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "User not found" });
  });

  it("changes a role and validates the value", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const promoted = await admin.agent
      .patch(`/api/admin/users/${member.id}/role`)
      .send({ role: "admin" });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({ id: member.id, role: "admin" });

    const bad = await admin.agent
      .patch(`/api/admin/users/${member.id}/role`)
      .send({ role: "superuser" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("Invalid role");

    // Quirk: the role route reports 404 only after the payload validates, and a
    // missing user reaches the update first.
    const missing = await admin.agent
      .patch("/api/admin/users/00000000-0000-0000-0000-000000000000/role")
      .send({ role: "admin" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "User not found" });
  });

  it("updates profile fields and rejects an email already in use", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const updated = await admin.agent.patch(`/api/admin/users/${member.id}`).send({
      firstName: "Renamed",
      hoursPerDay: 6,
      canViewDailyUpdates: 1,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      id: member.id,
      firstName: "Renamed",
      hoursPerDay: 6,
      canViewDailyUpdates: 1,
    });

    const conflict = await admin.agent
      .patch(`/api/admin/users/${member.id}`)
      .send({ email: admin.email });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ message: "Email is already in use" });

    const outOfRange = await admin.agent
      .patch(`/api/admin/users/${member.id}`)
      .send({ hoursPerDay: 25 });
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.body.message).toBe("Invalid user data");
  });

  it("archives and restores a user, refusing self-archival", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const archived = await admin.agent
      .patch(`/api/admin/users/${member.id}/archive`)
      .send({ isArchived: true });
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ id: member.id, isArchived: true });

    // Archived Memberships cannot authenticate into the Workspace (#95).
    const stillWorking = await member.agent.get("/api/projects");
    expect(stillWorking.status).toBe(401);

    const restored = await admin.agent
      .patch(`/api/admin/users/${member.id}/archive`)
      .send({ isArchived: false });
    expect(restored.body.isArchived).toBe(false);

    const self = await admin.agent
      .patch(`/api/admin/users/${admin.id}/archive`)
      .send({ isArchived: true });
    expect(self.status).toBe(400);
    expect(self.body).toEqual({ message: "Cannot archive yourself" });

    const missing = await admin.agent
      .patch("/api/admin/users/00000000-0000-0000-0000-000000000000/archive")
      .send({ isArchived: true });
    expect(missing.status).toBe(404);

    // Quirk: a malformed body is caught by the generic catch, so a validation
    // failure surfaces as 500 rather than 400.
    const malformed = await admin.agent
      .patch(`/api/admin/users/${member.id}/archive`)
      .send({ isArchived: "yes" });
    expect(malformed.status).toBe(500);
    expect(malformed.body).toEqual({ message: "Failed to archive user" });
  });

  it("resets by sending a password-set invite and does not return a password", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const res = await admin.agent.post(`/api/admin/users/${member.id}/reset-password`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.inviteSent).toBe(true);
    expect(res.body).not.toHaveProperty("newPassword");
    expect(res.body).not.toHaveProperty("emailSent");

    expect(emailsTo(member.email)).toHaveLength(0);

    const missing = await admin.agent.post(
      "/api/admin/users/00000000-0000-0000-0000-000000000000/reset-password"
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "User not found" });
  });

  it("deletes a user with 200 and refuses self-deletion", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const res = await admin.agent.delete(`/api/admin/users/${member.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const gone = await admin.agent.get(`/api/admin/users/${member.id}`);
    expect(gone.status).toBe(404);

    const self = await admin.agent.delete(`/api/admin/users/${admin.id}`);
    expect(self.status).toBe(400);
    expect(self.body).toEqual({ message: "Cannot delete your own account" });
  });

  it("shields the SuperAdmin from other admins, one route at a time", async () => {
    const app = await makeApp();
    const superAdmin = await registerAdmin(app);
    await makeMainAdmin(superAdmin.id);
    const otherAdmin = await registerAdmin(app);

    const details = await otherAdmin.agent.get(`/api/admin/users/${superAdmin.id}`);
    expect(details.status).toBe(403);
    expect(details.body).toEqual({ message: "Cannot view SuperAdmin details" });

    const role = await otherAdmin.agent
      .patch(`/api/admin/users/${superAdmin.id}/role`)
      .send({ role: "user" });
    expect(role.status).toBe(403);
    expect(role.body).toEqual({ message: "Cannot modify the SuperAdmin" });

    const update = await otherAdmin.agent
      .patch(`/api/admin/users/${superAdmin.id}`)
      .send({ firstName: "Hijacked" });
    expect(update.status).toBe(403);

    const archive = await otherAdmin.agent
      .patch(`/api/admin/users/${superAdmin.id}/archive`)
      .send({ isArchived: true });
    expect(archive.status).toBe(403);
    expect(archive.body).toEqual({ message: "Cannot archive the SuperAdmin" });

    const reset = await otherAdmin.agent.post(`/api/admin/users/${superAdmin.id}/reset-password`);
    expect(reset.status).toBe(403);
    expect(reset.body).toEqual({ message: "Cannot modify the SuperAdmin" });

    const removed = await otherAdmin.agent.delete(`/api/admin/users/${superAdmin.id}`);
    expect(removed.status).toBe(403);
    expect(removed.body).toEqual({ message: "Cannot delete the SuperAdmin" });

    // The SuperAdmin may still act on their own account through those routes.
    const selfUpdate = await superAdmin.agent
      .patch(`/api/admin/users/${superAdmin.id}`)
      .send({ firstName: "Self" });
    expect(selfUpdate.status).toBe(200);
    expect(selfUpdate.body.firstName).toBe("Self");

    // Quirk: no account email is sent by any of the refused calls.
    expect(sentEmails()).toHaveLength(0);
  });
});
