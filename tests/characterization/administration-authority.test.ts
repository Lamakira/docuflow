import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { promoteToAdmin, registerAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
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
  "/api/admin/modules",
];

/**
 * The one admin family that is not a Workspace surface. `users` is global — no
 * `workspace_id`, no RLS, no query scope — so this stays on the platform column
 * until the directory is scoped. Opening it on a Workspace Role would hand
 * every account on the platform to anyone who signs up and creates a Workspace.
 */
const PLATFORM_ROUTES = ["/api/admin/users", "/api/admin/users/whoever"];

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
    // The helper sets the Workspace Role with the column; putting it back is
    // what isolates the column, and the column alone must not open the destination.
    await setWorkspaceRole(globalAdmin.id, "member");

    const overview = await globalAdmin.agent.get("/api/admin/analytics/overview");
    expect(overview.status).toBe(403);
    expect(overview.body).toEqual({ message: "Access denied" });
  });

  it("leaves every Workspace Role alone when the platform console promotes and demotes (#266)", async () => {
    // A platform role change used to move the target between Member and
    // Administrator in the promoter's active Workspace. The two roles are
    // separate (ADR-0025, ADR-0026): the global column writes nothing else.
    const app = await makeApp();
    const platformAdmin = await registerAdmin(app);
    const member = await registerUser(app);
    const administrator = await registerUser(app);
    await setWorkspaceRole(administrator.id, "administrator");

    const promoted = await platformAdmin.agent
      .patch(`/api/admin/users/${member.id}/role`)
      .send({ role: "admin" });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({ id: member.id, role: "admin" });
    const stillRefused = await member.agent.get("/api/admin/analytics/overview");
    expect(stillRefused.status).toBe(403);

    const demoted = await platformAdmin.agent
      .patch(`/api/admin/users/${administrator.id}/role`)
      .send({ role: "user" });
    expect(demoted.status).toBe(200);
    const stillAllowed = await administrator.agent.get("/api/admin/analytics/overview");
    expect(stillAllowed.status).toBe(200);
  });

  it("never demotes an Owner out of ownership through the global role column", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const platformAdmin = await registerAdmin(app);

    const demoted = await platformAdmin.agent
      .patch(`/api/admin/users/${owner.id}/role`)
      .send({ role: "user" });
    expect(demoted.status).toBe(200);

    // Ownership is transferred, never taken by a role write (CONTEXT.md).
    const still = await owner.agent.get("/api/admin/analytics/overview");
    expect(still.status).toBe(200);
  });

  it("does not hand the platform user directory to a Workspace Owner", async () => {
    const app = await makeApp();
    const owner = await selfServiceOwner(app);

    for (const route of PLATFORM_ROUTES) {
      const res = await owner.agent.get(route);
      expect(res.status, route).toBe(403);
      expect(res.body, route).toEqual({ message: "Access denied" });
    }

    const created = await owner.agent
      .post("/api/admin/users")
      .send({ email: "outsider@example.com", firstName: "Out", lastName: "Sider" });
    expect(created.status).toBe(403);
  });
});
