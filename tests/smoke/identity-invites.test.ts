import { beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 9 ticket #160: admin create and reset invite at the IdentityProvider
 * instead of writing a DocuFlow password (ADR-0007, ADR-0017, ADR-0018).
 *
 * Seam is HTTP against the real app, plus the journal. The Clerk SDK is aliased
 * to `tests/fakes/clerk.ts`, so no run reaches api.clerk.com.
 */

import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerAdmin, registerUser, uniqueEmail } from "../helpers/auth";
import { clerkCreateInvitationCalls, createClerkClient, issueClerkSession } from "../fakes/clerk";
import { isUsablePasswordHash } from "../../server/modules/identity/identityProvider";

beforeEach(async () => {
  await resetDb();
});

describe("users.password is nullable (#160)", () => {
  it("is nullable in a database migrated through the journal", async () => {
    const { pool } = await import("../../server/db");
    const { rows } = await pool.query<{ is_nullable: string }>(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'password'`
    );

    expect(rows).toEqual([{ is_nullable: "YES" }]);
  });
});

describe("admin create invites at the IdentityProvider (#160)", () => {
  it("creates a User with no usable hash, sends a password-set invite, and grants Membership the usual way", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const email = uniqueEmail("invite-create");

    const res = await admin.agent.post("/api/admin/users").send({
      email,
      firstName: "Ivy",
      lastName: "Ted",
    });

    expect(res.status).toBe(201);
    expect(res.body.inviteSent).toBe(true);
    expect(clerkCreateInvitationCalls().map((call) => call.emailAddress)).toContain(email);

    const { pool } = await import("../../server/db");
    const user = (
      await pool.query<{
        id: string;
        password: string | null;
        last_generated_password: string | null;
      }>(`SELECT id, password, last_generated_password FROM users WHERE email = $1`, [email])
    ).rows[0];
    expect(user).toBeDefined();
    expect(isUsablePasswordHash(user.password)).toBe(false);
    expect(user.last_generated_password).toBeNull();

    const memberships = (
      await pool.query<{ id: string; archived_at: Date | null }>(
        `SELECT id, archived_at FROM memberships WHERE user_id = $1`,
        [user.id]
      )
    ).rows;
    expect(memberships).toHaveLength(1);
    expect(memberships[0].archived_at).toBeNull();
  });

  it("does not let a created User in without an active Membership, even after they accept the invite", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const email = uniqueEmail("invite-archived");

    const created = await admin.agent.post("/api/admin/users").send({
      email,
      firstName: "No",
      lastName: "Seat",
    });
    const userId = created.body.user.id as string;

    await admin.agent.patch(`/api/admin/users/${userId}/archive`).send({ isArchived: true });

    const clerk = createClerkClient({});
    const identity = await clerk.users.createUser({
      emailAddress: [email],
      passwordDigest: "$2b$04$CJHjh937SDvS7hh3rhGtDeDrY0sTbWMloGRi22XPxY7Zb9scpnnj2",
      passwordHasher: "bcrypt",
    });
    const { storage } = await import("../../server/storage");
    await storage.linkUserToIdentityProvider(userId, identity.id);

    const asInvited = newAgent(app).set("Authorization", `Bearer ${issueClerkSession(identity.id)}`);
    const denied = await asInvited.get("/api/projects");
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ message: "Unauthorized" });
  });
});

describe("admin reset invites at the IdentityProvider (#160)", () => {
  it("sends a password-set invite and leaves the existing hash untouched", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const { pool } = await import("../../server/db");
    const before = (
      await pool.query<{ password: string | null }>(`SELECT password FROM users WHERE id = $1`, [
        member.id,
      ])
    ).rows[0].password;

    const res = await admin.agent.post(`/api/admin/users/${member.id}/reset-password`);

    expect(res.status).toBe(200);
    expect(res.body.inviteSent).toBe(true);
    expect(clerkCreateInvitationCalls().map((call) => call.emailAddress)).toContain(member.email);

    const after = (
      await pool.query<{ password: string | null }>(`SELECT password FROM users WHERE id = $1`, [
        member.id,
      ])
    ).rows[0].password;
    expect(after).toBe(before);
    expect(isUsablePasswordHash(after)).toBe(true);
  });
});

describe("web password login stays unmounted (#160)", () => {
  it("answers 404 to POST /api/auth/login", async () => {
    const app = await makeApp();
    const res = await newAgent(app).post("/api/auth/login").send({
      email: "anyone@example.com",
      password: "password123",
    });
    expect(res.status).toBe(404);
  });
});
