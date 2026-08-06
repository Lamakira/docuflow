import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser } from "../helpers/auth";

/**
 * Characterization: teams and invite links.
 *
 * This route group predates the company-wide visibility model and the SPA no
 * longer calls it, but it is still mounted and still reachable, so its behavior
 * is frozen here alongside everything else.
 *
 * Quirks frozen here:
 *  - Team access really is scoped, unlike projects and clients: non-members get
 *    403 on read.
 *  - The owner is not automatically a member row; ownership is checked
 *    separately everywhere.
 *  - `GET /api/invite/:code` is the one unauthenticated data endpoint in the
 *    API, and it deliberately answers 404 with one generic message for expired,
 *    exhausted, inactive and unknown codes alike.
 *  - Joining reports failures as 400 with the storage layer's message.
 */
describe("teams and invites (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a team the owner can read and outsiders cannot", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const outsider = await registerUser(app);

    const created = await owner.agent
      .post("/api/teams")
      .send({ name: "Platform", description: "Core team" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Platform",
      description: "Core team",
      ownerId: owner.id,
    });

    const mine = await owner.agent.get("/api/teams");
    expect(mine.status).toBe(200);
    expect(mine.body.map((t: { id: string }) => t.id)).toEqual([created.body.id]);

    // Quirk: the owner's own listing is membership-based, so another user's team
    // is invisible — unlike projects, which everyone can see.
    expect((await outsider.agent.get("/api/teams")).body).toEqual([]);

    const asOwner = await owner.agent.get(`/api/teams/${created.body.id}`);
    expect(asOwner.status).toBe(200);

    const asOutsider = await outsider.agent.get(`/api/teams/${created.body.id}`);
    expect(asOutsider.status).toBe(403);
    expect(asOutsider.body).toEqual({ message: "Not authorized to view this team" });

    const members = await outsider.agent.get(`/api/teams/${created.body.id}/members`);
    expect(members.status).toBe(403);
    expect(members.body).toEqual({ message: "Not authorized to view team members" });

    const invalid = await owner.agent.post("/api/teams").send({ description: "no name" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");

    const missing = await owner.agent.get("/api/teams/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Team not found" });
  });

  it("restricts updating and deleting a team to its owner", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    const team = await owner.agent.post("/api/teams").send({ name: "Owned" });

    const refusedUpdate = await outsider.agent
      .patch(`/api/teams/${team.body.id}`)
      .send({ name: "Hijacked" });
    expect(refusedUpdate.status).toBe(403);
    expect(refusedUpdate.body).toEqual({ message: "Only team owner can update the team" });

    const updated = await owner.agent
      .patch(`/api/teams/${team.body.id}`)
      .send({ name: "Renamed" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Renamed");

    const refusedDelete = await outsider.agent.delete(`/api/teams/${team.body.id}`);
    expect(refusedDelete.status).toBe(403);
    expect(refusedDelete.body).toEqual({ message: "Only team owner can delete the team" });

    const deleted = await owner.agent.delete(`/api/teams/${team.body.id}`);
    expect(deleted.status).toBe(204);
  });

  it("issues an invite, previews it anonymously, and adds the joiner as a member", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    const anonymous = newAgent(app);
    const team = await owner.agent.post("/api/teams").send({ name: "Invited" });

    const invite = await owner.agent
      .post(`/api/teams/${team.body.id}/invites`)
      .send({ maxUses: 1 });
    expect(invite.status).toBe(201);
    expect(invite.body).toMatchObject({
      teamId: team.body.id,
      createdById: owner.id,
      maxUses: 1,
      useCount: 0,
      // Quirk: `isActive` is a varchar holding the string "true".
      isActive: "true",
    });
    expect(invite.body.code).toMatch(/^[0-9a-f]{32}$/);

    const preview = await anonymous.get(`/api/invite/${invite.body.code}`);
    expect(preview.status).toBe(200);
    // Only the team name is exposed, to keep codes non-enumerable.
    expect(preview.body).toEqual({ teamName: "Invited" });

    const joined = await joiner.agent.post(`/api/invite/${invite.body.code}/join`);
    expect(joined.status).toBe(200);
    expect(joined.body.message).toBe("Successfully joined team");
    expect(joined.body.team.id).toBe(team.body.id);

    const members = await owner.agent.get(`/api/teams/${team.body.id}/members`);
    expect(members.body.map((m: { userId: string }) => m.userId)).toContain(joiner.id);

    // The single use is spent, and the generic message covers it.
    const exhausted = await anonymous.get(`/api/invite/${invite.body.code}`);
    expect(exhausted.status).toBe(404);
    expect(exhausted.body).toEqual({ message: "This invitation is no longer valid" });

    const unknown = await anonymous.get("/api/invite/not-a-real-code");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ message: "This invitation is no longer valid" });

    const joinUnknown = await joiner.agent.post("/api/invite/not-a-real-code/join");
    expect(joinUnknown.status).toBe(400);
    expect(typeof joinUnknown.body.message).toBe("string");
  });

  it("rejects an expired invite and lets the owner deactivate one", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    const anonymous = newAgent(app);
    const team = await owner.agent.post("/api/teams").send({ name: "Expiring" });

    const expired = await owner.agent
      .post(`/api/teams/${team.body.id}/invites`)
      .send({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(expired.status).toBe(201);
    expect((await anonymous.get(`/api/invite/${expired.body.code}`)).status).toBe(404);

    const live = await owner.agent.post(`/api/teams/${team.body.id}/invites`).send({});
    expect((await anonymous.get(`/api/invite/${live.body.code}`)).status).toBe(200);

    const refused = await outsider.agent.get(`/api/teams/${team.body.id}/invites`);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ message: "Not authorized to view invites" });

    const list = await owner.agent.get(`/api/teams/${team.body.id}/invites`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);

    const refusedDeactivate = await outsider.agent.delete(
      `/api/teams/${team.body.id}/invites/${live.body.id}`
    );
    expect(refusedDeactivate.status).toBe(403);
    expect(refusedDeactivate.body).toEqual({ message: "Only team owner can deactivate invites" });

    const deactivated = await owner.agent.delete(
      `/api/teams/${team.body.id}/invites/${live.body.id}`
    );
    expect(deactivated.status).toBe(204);
    expect((await anonymous.get(`/api/invite/${live.body.code}`)).status).toBe(404);

    const badPayload = await owner.agent
      .post(`/api/teams/${team.body.id}/invites`)
      .send({ maxUses: -1 });
    expect(badPayload.status).toBe(400);
    expect(badPayload.body.message).toBe("Invalid data");
  });

  it("removes members, refusing to remove the owner", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const team = await owner.agent.post("/api/teams").send({ name: "Roster" });
    const invite = await owner.agent.post(`/api/teams/${team.body.id}/invites`).send({});
    await member.agent.post(`/api/invite/${invite.body.code}/join`);

    const promoted = await owner.agent
      .patch(`/api/teams/${team.body.id}/members/${member.id}`)
      .send({ role: "admin" });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe("admin");

    const refusedRole = await member.agent
      .patch(`/api/teams/${team.body.id}/members/${owner.id}`)
      .send({ role: "member" });
    expect(refusedRole.status).toBe(403);
    expect(refusedRole.body).toEqual({ message: "Only team owner can change member roles" });

    const removingOwner = await owner.agent.delete(
      `/api/teams/${team.body.id}/members/${owner.id}`
    );
    expect(removingOwner.status).toBe(400);
    expect(removingOwner.body).toEqual({ message: "Team owner cannot be removed" });

    const selfRemoval = await member.agent.delete(
      `/api/teams/${team.body.id}/members/${member.id}`
    );
    expect(selfRemoval.status).toBe(204);
  });
});
