import { beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 9 ticket #161: drop `users.password` and `users.last_generated_password`
 * (ADR-0007, ADR-0017, ADR-0018).
 *
 * Seam is the journal plus HTTP. Clerk is aliased to `tests/fakes/clerk.ts`, so
 * no run reaches api.clerk.com. Pairing and Clerk sessions stay on their own
 * suites; this one is the column going away and the leftover login path staying
 * dead even if a caller still posts a password.
 */

import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerAdmin, registerUser, uniqueEmail } from "../helpers/auth";
import { loginDevice } from "../helpers/agent";

beforeEach(async () => {
  await resetDb();
});

describe("users.password and last_generated_password are gone (#161)", () => {
  it("has neither column in a database migrated through the journal", async () => {
    const { pool } = await import("../../server/db");
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name IN ('password', 'last_generated_password')
        ORDER BY column_name`
    );

    expect(rows).toEqual([]);
  });

  it("creates a User without a password column and still grants Membership", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const email = uniqueEmail("no-password");

    const res = await admin.agent.post("/api/admin/users").send({
      email,
      firstName: "Ivy",
      lastName: "Ted",
    });

    expect(res.status).toBe(201);
    expect(res.body.inviteSent).toBe(true);
    expect(res.body.user).not.toHaveProperty("password");
    expect(res.body.user).not.toHaveProperty("lastGeneratedPassword");

    const { pool } = await import("../../server/db");
    const user = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])
    ).rows[0];
    expect(user).toBeDefined();

    const memberships = (
      await pool.query<{ id: string; archived_at: Date | null }>(
        `SELECT id, archived_at FROM memberships WHERE user_id = $1`,
        [user.id]
      )
    ).rows;
    expect(memberships).toHaveLength(1);
    expect(memberships[0].archived_at).toBeNull();
  });
});

describe("agent login cannot be revived (#161)", () => {
  it("rejects inserting a password hash because the column is gone", async () => {
    const { pool } = await import("../../server/db");
    await expect(
      pool.query(
        `INSERT INTO users (email, password) VALUES ($1, $2)`,
        ["revive@example.test", "$2b$04$CJHjh937SDvS7hh3rhGtDeDrY0sTbWMloGRi22XPxY7Zb9scpnnj2"]
      )
    ).rejects.toThrow(/column ["']?password["']? .*does not exist/i);
  });

  it("answers 410 on password login and pairing still enrolls a Device", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const retired = await newAgent(app).post("/api/agent/auth/login").send({
      email: user.email,
      password: "password123",
      deviceMeta: { deviceName: "Revived Hash", os: "linux" },
    });
    expect(retired.status).toBe(410);
    expect(retired.body).toEqual({
      message:
        "This sign-in path has moved to pairing. Pair a Device from a signed-in DocuFlow web session.",
    });

    const device = await loginDevice(app, user, { deviceName: "Paired Machine", os: "linux" });
    const ping = await device.request.get("/api/agent/capabilities");
    expect(ping.status).toBe(200);

    const listed = await user.agent.get("/api/agent/devices");
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(device.deviceId);
  });
});

describe("Clerk web sessions stay green (#161)", () => {
  it("enters the Workspace on a provider session with no password on the User", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const me = await user.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: user.id, email: user.email });
    expect(me.body).not.toHaveProperty("password");
    expect(me.body).not.toHaveProperty("lastGeneratedPassword");

    const projects = await user.agent.get("/api/projects");
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);
  });
});
