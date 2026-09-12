import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invitations, PARALLEL_WORKSPACE_ID } from "../../shared/schema";
import { db } from "../../server/db";
import { issueClerkSession } from "../fakes/clerk";
import { emailsTo } from "../fakes/resend";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser, setWorkspaceRole, uniqueEmail } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { addWorkspaceMembership, plantParallelWorkspace } from "../helpers/workspace";

/**
 * Invitation send / revoke / accept (#211, Flow 6).
 * Seam: HTTP `/api/workspace/invitations` and `/api/invitations/accept`.
 * Pending Invitations consume no Billable Seat. Acceptance creates a Membership,
 * not a Workspace. Errors stay `{ message }`.
 */

describe("Workspace Invitations HTTP (#211)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets Owner and Administrator send and revoke, and lists pending without a seat", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Sam" });
    await setWorkspaceRole(owner.id, "owner");
    const email = uniqueEmail("invitee");

    const anonymous = await newAgent(app).get("/api/workspace/invitations");
    expect(anonymous.status).toBe(401);

    const sent = await owner.agent.post("/api/workspace/invitations").send({
      email,
      workspaceRole: "MEMBER",
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({
      email,
      workspaceRole: "MEMBER",
      status: "pending",
      consumesSeat: false,
    });
    expect(sent.body).not.toHaveProperty("token");
    expect(emailsTo(email)).toHaveLength(1);
    expect(emailsTo(email)[0]?.html.toLowerCase()).toContain("invitation");
    expect(emailsTo(email)[0]?.html.toLowerCase()).toContain("billable seat");

    const listed = await owner.agent.get("/api/workspace/invitations");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: sent.body.id,
        email,
        workspaceRole: "MEMBER",
        status: "pending",
        consumesSeat: false,
      }),
    ]);
    expect(listed.body[0]).not.toHaveProperty("token");
    expect(JSON.stringify(listed.body).toLowerCase()).toContain("pending");

    const revoked = await owner.agent.post(`/api/workspace/invitations/${sent.body.id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ id: sent.body.id, status: "revoked" });

    const after = await owner.agent.get("/api/workspace/invitations");
    expect(after.body).toEqual([]);
  });

  it("refuses a Member on send and revoke with { message }, not problem+json", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const member = await registerUser(app);
    const created = await owner.agent.post("/api/workspace/invitations").send({
      email: uniqueEmail("gated"),
      workspaceRole: "MEMBER",
    });
    expect(created.status).toBe(201);

    const asMember = await member.agent.post("/api/workspace/invitations").send({
      email: uniqueEmail("other"),
      workspaceRole: "MEMBER",
    });
    expect(asMember.status).toBe(403);
    expect(asMember.body).toEqual({ message: "Access denied" });
    expect(asMember.body).not.toHaveProperty("type");

    const revoke = await member.agent.post(`/api/workspace/invitations/${created.body.id}/revoke`);
    expect(revoke.status).toBe(403);
    expect(revoke.body).toEqual({ message: "Access denied" });
  });

  it("lets an invitee accept into a Membership and does not create a Workspace", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Sam" });
    await setWorkspaceRole(owner.id, "owner");
    await plantParallelWorkspace();
    await addWorkspaceMembership(owner.id, PARALLEL_WORKSPACE_ID, "owner");
    await owner.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });

    const invitee = await registerUser(app, { firstName: "Pat", lastName: "Ng" });
    const sent = await owner.agent.post("/api/workspace/invitations").send({
      email: invitee.email,
      workspaceRole: "ADMINISTRATOR",
    });
    expect(sent.status).toBe(201);
    const acceptUrl = emailsTo(invitee.email)[0]?.html.match(/https?:\/\/[^"]+\/invitations\/([a-f0-9]+)/i);
    expect(acceptUrl?.[1]).toBeTruthy();

    const mine = await invitee.agent.get("/api/invitations");
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual([
      expect.objectContaining({
        id: sent.body.id,
        workspaceId: PARALLEL_WORKSPACE_ID,
        workspaceName: "Harbour View",
        workspaceRole: "ADMINISTRATOR",
      }),
    ]);
    expect(mine.body[0].token).toBe(acceptUrl?.[1]);

    const accepted = await invitee.agent.post("/api/invitations/accept").send({ token: acceptUrl?.[1] });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      workspaceId: PARALLEL_WORKSPACE_ID,
      workspaceRole: "ADMINISTRATOR",
    });
    expect(accepted.body).not.toHaveProperty("workspaceCreated");

    const memberships = await invitee.agent.get("/api/memberships");
    expect(memberships.body.memberships.map((row: { workspaceId: string }) => row.workspaceId).sort()).toEqual(
      [PARALLEL_WORKSPACE_ID, "seeded"].sort(),
    );

    const people = await owner.agent.get("/api/workspace/memberships");
    expect(people.body.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: invitee.id,
          workspaceRole: "ADMINISTRATOR",
          archived: false,
        }),
      ]),
    );

    const pending = await owner.agent.get("/api/workspace/invitations");
    expect(pending.body).toEqual([]);
  });

  it("creates a User and Membership for a new invitee, and names expired, revoked, and already-accepted", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const email = uniqueEmail("newhire");

    const sent = await owner.agent.post("/api/workspace/invitations").send({
      email,
      workspaceRole: "MEMBER",
    });
    const token = emailsTo(email)[0]?.html.match(/\/invitations\/([a-f0-9]+)/i)?.[1];
    expect(token).toBeTruthy();

    const newcomer = newAgent(app).set("Authorization", `Bearer ${issueClerkSession("user_invitee_fresh")}`);
    const accepted = await newcomer.post("/api/invitations/accept").send({ token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.workspaceId).toBe("seeded");
    expect(accepted.body).not.toHaveProperty("workspaceCreated");

    const already = await newcomer.post("/api/invitations/accept").send({ token });
    expect(already.status).toBe(409);
    expect(already.body.message.toLowerCase()).toContain("already accepted");

    const missing = await newcomer.post("/api/invitations/accept").send({ token: "f".repeat(64) });
    expect(missing.status).toBe(404);

    const second = await owner.agent.post("/api/workspace/invitations").send({
      email: uniqueEmail("later"),
      workspaceRole: "MEMBER",
    });
    await owner.agent.post(`/api/workspace/invitations/${second.body.id}/revoke`);
    const revokedToken = emailsTo(second.body.email)[0]?.html.match(/\/invitations\/([a-f0-9]+)/i)?.[1];
    const asRevoked = await newcomer.post("/api/invitations/accept").send({ token: revokedToken });
    expect(asRevoked.status).toBe(409);
    expect(asRevoked.body.message.toLowerCase()).toContain("revoked");

    const expiredInvite = await owner.agent.post("/api/workspace/invitations").send({
      email: uniqueEmail("stale"),
      workspaceRole: "MEMBER",
    });
    const expiredToken = emailsTo(expiredInvite.body.email)[0]?.html.match(/\/invitations\/([a-f0-9]+)/i)?.[1];
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, expiredInvite.body.id));
    const asExpired = await newcomer.post("/api/invitations/accept").send({ token: expiredToken });
    expect(asExpired.status).toBe(409);
    expect(asExpired.body.message.toLowerCase()).toContain("expired");
  });

  it("states an existing Membership instead of duplicating, and blocks Owner role", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const member = await registerUser(app);

    const duplicate = await owner.agent.post("/api/workspace/invitations").send({
      email: member.email,
      workspaceRole: "MEMBER",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message.toLowerCase()).toContain("membership");

    const ownerRole = await owner.agent.post("/api/workspace/invitations").send({
      email: uniqueEmail("boss"),
      workspaceRole: "OWNER",
    });
    expect(ownerRole.status).toBe(400);
  });

  it("lets Owner edit hours-per-day and view-Daily-Updates on a Membership, and refuses a Member", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const member = await registerUser(app);

    const listed = await owner.agent.get("/api/workspace/memberships");
    const row = listed.body.memberships.find((item: { userId: string }) => item.userId === member.id);
    expect(row).toMatchObject({
      hoursPerDay: 8,
      canViewDailyUpdates: 0,
    });

    const patched = await owner.agent.patch(`/api/workspace/memberships/${row.membershipId}`).send({
      hoursPerDay: 6,
      canViewDailyUpdates: 1,
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      membershipId: row.membershipId,
      hoursPerDay: 6,
      canViewDailyUpdates: 1,
    });

    const asMember = await member.agent.patch(`/api/workspace/memberships/${row.membershipId}`).send({
      hoursPerDay: 4,
    });
    expect(asMember.status).toBe(403);
    expect(asMember.body).toEqual({ message: "Access denied" });
  });
});
