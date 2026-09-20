import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { promoteToAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { removeAllMemberships } from "../helpers/workspace";

/**
 * Who governs the Administration destination (#238).
 *
 * The Workspace Role does. `users.role` is the single-tenant era's global
 * column and carries no Workspace authority: a Workspace created through #217
 * leaves its Owner on `role = 'user'`, so a column check locks the Owner out of
 * the Workspace they just paid for and created.
 *
 * Every other Administration surface — Billing, Service Accounts, Webhook
 * Endpoints, Invitations — already authorizes this way. These routes are the
 * ones that did not.
 */

const ADMINISTRATION_ROUTES = [
  "/api/admin/analytics/overview",
  "/api/admin/analytics/activity",
  "/api/admin/analytics/coverage",
  "/api/admin/analytics/devices",
  "/api/admin/org-settings",
  "/api/admin/users",
  "/api/admin/modules",
];

/** A User who created their own Workspace and therefore owns it (#217, Flow 1). */
async function selfServiceOwner(app: Awaited<ReturnType<typeof makeApp>>) {
  const user = await registerUser(app);
  await removeAllMemberships(user.id);
  const created = await user.agent.post("/api/workspaces").send({ name: "Keystone Studio" });
  expect(created.status).toBe(201);
  expect(created.body.workspaceRole).toBe("OWNER");
  return user;
}

describe("the Workspace Role governs Administration (#238)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("opens Administration to the Owner of a Workspace they created themselves", async () => {
    const app = await makeApp();
    const owner = await selfServiceOwner(app);

    for (const route of ADMINISTRATION_ROUTES) {
      const res = await owner.agent.get(route);
      expect(res.status, route).toBe(200);
    }
  });

  it("opens the daily-updates dashboard to that same Owner", async () => {
    const app = await makeApp();
    const owner = await selfServiceOwner(app);

    const today = await owner.agent.get("/api/admin/daily-updates/today-status");
    expect(today.status).toBe(200);
  });

  it("refuses a Member of the same Workspace", async () => {
    const app = await makeApp();
    const member = await registerUser(app);

    for (const route of ADMINISTRATION_ROUTES) {
      const res = await member.agent.get(route);
      expect(res.status, route).toBe(403);
      expect(res.body, route).toEqual({ message: "Access denied" });
    }
  });

  it("opens Administration to an Administrator whose global role is still 'user'", async () => {
    const app = await makeApp();
    const administrator = await registerUser(app);
    await setWorkspaceRole(administrator.id, "administrator");

    const overview = await administrator.agent.get("/api/admin/analytics/overview");
    expect(overview.status).toBe(200);
  });

  it("does not take the global role column for Workspace authority", async () => {
    const app = await makeApp();
    const globalAdmin = await registerUser(app);
    await promoteToAdmin(globalAdmin.id);
    // Promotion moved the Workspace Role too; putting it back is what isolates
    // the column, and the column alone must not open the destination.
    await setWorkspaceRole(globalAdmin.id, "member");

    const overview = await globalAdmin.agent.get("/api/admin/analytics/overview");
    expect(overview.status).toBe(403);
    expect(overview.body).toEqual({ message: "Access denied" });
  });

  it("moves the Workspace Role when the admin console promotes and demotes", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const target = await registerUser(app);

    const refusedFirst = await target.agent.get("/api/admin/analytics/overview");
    expect(refusedFirst.status).toBe(403);

    const promoted = await owner.agent
      .patch(`/api/admin/users/${target.id}/role`)
      .send({ role: "admin" });
    expect(promoted.status).toBe(200);

    const allowed = await target.agent.get("/api/admin/analytics/overview");
    expect(allowed.status).toBe(200);

    const demoted = await owner.agent
      .patch(`/api/admin/users/${target.id}/role`)
      .send({ role: "user" });
    expect(demoted.status).toBe(200);

    const refusedAgain = await target.agent.get("/api/admin/analytics/overview");
    expect(refusedAgain.status).toBe(403);
  });

  it("never demotes an Owner out of ownership through the global role column", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const other = await registerUser(app);
    await setWorkspaceRole(other.id, "administrator");

    const demoted = await other.agent.patch(`/api/admin/users/${owner.id}/role`).send({ role: "user" });
    expect(demoted.status).toBe(200);

    // Ownership is transferred, never taken by a role write (CONTEXT.md).
    const still = await owner.agent.get("/api/admin/analytics/overview");
    expect(still.status).toBe(200);
  });
});
