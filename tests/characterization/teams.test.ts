import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser } from "../helpers/auth";

/**
 * Characterization: Teams HTTP contract after #98.
 *
 * The Teams grouping is gone. Routes that spoke to it were removed rather
 * than left serving rows, so the former contract fails closed. This file
 * freezes that absence — it no longer describes create/invite/join.
 */
describe("teams and invites (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("fails closed on former Teams endpoints", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const anonymous = newAgent(app);

    expect((await user.agent.get("/api/teams")).status).toBe(404);
    expect((await user.agent.post("/api/teams").send({ name: "Platform" })).status).toBe(404);
    expect((await user.agent.get("/api/teams/any-id")).status).toBe(404);
    expect((await user.agent.patch("/api/teams/any-id").send({ name: "Renamed" })).status).toBe(404);
    expect((await user.agent.delete("/api/teams/any-id")).status).toBe(404);
    expect((await user.agent.get("/api/teams/any-id/members")).status).toBe(404);
    expect(
      (await user.agent.patch("/api/teams/any-id/members/any-user").send({ role: "admin" })).status
    ).toBe(404);
    expect((await user.agent.delete("/api/teams/any-id/members/any-user")).status).toBe(404);
    expect((await user.agent.get("/api/teams/any-id/invites")).status).toBe(404);
    expect((await user.agent.post("/api/teams/any-id/invites").send({})).status).toBe(404);
    expect((await user.agent.delete("/api/teams/any-id/invites/any-invite")).status).toBe(404);
    expect((await anonymous.get("/api/invite/any-code")).status).toBe(404);
    expect((await user.agent.post("/api/invite/any-code/join")).status).toBe(404);
  });
});
