import { beforeEach, describe, expect, it } from "vitest";
import { PARALLEL_WORKSPACE_ID } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { newAgent, registerAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { addWorkspaceMembership } from "../helpers/workspace";

/**
 * Memberships in the Active Workspace (#192). Seam: HTTP `/api/*`.
 * GET /api/users is global and does not carry Workspace Role or Capabilities.
 */

describe("Workspace Memberships HTTP (#192)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists active Memberships in the Active Workspace with Workspace Role and Capabilities", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Sam", lastName: "Lee" });
    await setWorkspaceRole(owner.id, "owner");
    const member = await registerUser(app, { firstName: "Pat", lastName: "Ng" });

    const anonymous = await newAgent(app).get("/api/workspace/memberships");
    expect(anonymous.status).toBe(401);

    const listed = await owner.agent.get("/api/workspace/memberships");
    expect(listed.status).toBe(200);
    expect(listed.body.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: owner.id,
          firstName: "Sam",
          lastName: "Lee",
          workspaceRole: "OWNER",
          archived: false,
          capabilities: expect.arrayContaining(["View daily updates"]),
        }),
        expect.objectContaining({
          userId: member.id,
          firstName: "Pat",
          workspaceRole: "MEMBER",
          archived: false,
        }),
      ]),
    );
    expect(listed.body).not.toHaveProperty("invitations");
    expect(JSON.stringify(listed.body).toLowerCase()).not.toContain("invitation pending");
  });

  it("hides Archived Memberships unless an admin asks, and never presents them as sign-in-able", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app, { firstName: "Ann" });
    await setWorkspaceRole(admin.id, "administrator");
    const archived = await registerUser(app, { firstName: "Cid" });
    const member = await registerUser(app, { firstName: "Bob" });

    await admin.agent.patch(`/api/admin/users/${archived.id}/archive`).send({ isArchived: true });

    const asMember = await member.agent.get("/api/workspace/memberships");
    expect(asMember.body.memberships.map((row: { userId: string }) => row.userId)).not.toContain(
      archived.id,
    );

    const memberInclude = await member.agent
      .get("/api/workspace/memberships")
      .query({ includeArchived: "true" });
    expect(
      memberInclude.body.memberships.some((row: { userId: string }) => row.userId === archived.id),
    ).toBe(false);

    const adminAsking = await admin.agent
      .get("/api/workspace/memberships")
      .query({ includeArchived: "true" });
    const gone = adminAsking.body.memberships.find(
      (row: { userId: string; archived: boolean }) => row.userId === archived.id,
    );
    expect(gone).toMatchObject({ userId: archived.id, archived: true });
  });

  it("rescopes to the Active Workspace after a switch", async () => {
    const app = await makeApp();
    const ada = await registerUser(app, { firstName: "Ada" });
    const bea = await registerUser(app, { firstName: "Bea" });
    await addWorkspaceMembership(bea.id, PARALLEL_WORKSPACE_ID, "member");

    const seeded = await ada.agent.get("/api/workspace/memberships");
    expect(seeded.body.memberships.map((row: { userId: string }) => row.userId).sort()).toEqual(
      [ada.id, bea.id].sort(),
    );

    await bea.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });
    const parallel = await bea.agent.get("/api/workspace/memberships");
    expect(parallel.status).toBe(200);
    expect(parallel.body.memberships.map((row: { userId: string }) => row.userId)).toEqual([bea.id]);
    expect(parallel.body.memberships.map((row: { userId: string }) => row.userId)).not.toContain(ada.id);
  });
});
