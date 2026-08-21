import request from "supertest";
import type { Express } from "express";

export type Agent = ReturnType<typeof request.agent>;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** Cookie-persisting supertest agent already carrying this user's session. */
  agent: Agent;
}

const DEFAULT_PASSWORD = "password123";

let sequence = 0;

/** Unique per call, so a suite can register many users without collisions. */
export function uniqueEmail(prefix = "user"): string {
  sequence += 1;
  return `${prefix}-${sequence}@example.com`;
}

/**
 * A cookie-persisting agent that presents a unique client IP.
 *
 * The app rate-limits `/api/` to 120 requests per minute per IP and trusts one
 * proxy hop, so every request from 127.0.0.1 would otherwise share a single
 * budget and a long suite would start collecting 429s. Giving each agent its own
 * forwarded address keeps the real limiter in the chain while stopping unrelated
 * tests from spending each other's budget; `rate-limits.test.ts` characterizes
 * the limiter itself on a fixed address.
 */
export function newAgent(app: Express): Agent {
  sequence += 1;
  const octet = sequence % 250;
  const block = Math.floor(sequence / 250) % 250;
  return request.agent(app).set("X-Forwarded-For", `10.${block}.0.${octet + 1}`);
}

/**
 * Register through the real endpoint and keep the resulting session. Registration
 * logs the user in, so the returned agent is authenticated immediately.
 */
export async function registerUser(
  app: Express,
  overrides: { email?: string; password?: string; firstName?: string; lastName?: string } = {}
): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const agent = newAgent(app);

  const res = await agent.post("/api/auth/register").send({
    email,
    password,
    firstName: overrides.firstName,
    lastName: overrides.lastName,
  });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { id: res.body.id, email, password, agent };
}

/**
 * Register a user and grant the admin role.
 *
 * Promotion is a direct database write on purpose: the only routes that can grant
 * admin are themselves admin-only, so an HTTP-only path would have no way to
 * create the first one. `isAdmin` re-reads the role from the database on every
 * request, so the existing session picks the change up without re-login.
 */
export async function registerAdmin(
  app: Express,
  overrides: { email?: string; password?: string; firstName?: string; lastName?: string } = {}
): Promise<TestUser> {
  const user = await registerUser(app, { email: overrides.email ?? uniqueEmail("admin"), ...overrides });
  await promoteToAdmin(user.id);
  return user;
}

export async function promoteToAdmin(userId: string): Promise<void> {
  await updateUserRow(userId, "role = 'admin'");
}

/** Flag a user as the SuperAdmin — the account admin routes refuse to modify. */
export async function makeMainAdmin(userId: string): Promise<void> {
  await updateUserRow(userId, "is_main_admin = 1");
}

/** Grant the daily-updates dashboard permission to a non-admin user. */
export async function grantDailyUpdatesAccess(userId: string): Promise<void> {
  await updateUserRow(userId, "can_view_daily_updates = 1");
}

const SEEDED_ROLE_IDS = {
  owner: "seeded-owner",
  administrator: "seeded-administrator",
  member: "seeded-member",
} as const;

/**
 * Assign a built-in Workspace Role on the seeded Membership.
 *
 * Service Account BFF routes authorize on Workspace Role, not `users.role`.
 */
export async function setWorkspaceRole(
  userId: string,
  slug: keyof typeof SEEDED_ROLE_IDS
): Promise<void> {
  const { pool } = await import("../../server/db");
  await pool.query(`UPDATE memberships SET workspace_role_id = $1 WHERE user_id = $2`, [
    SEEDED_ROLE_IDS[slug],
    userId,
  ]);
}

async function updateUserRow(userId: string, assignment: string): Promise<void> {
  const { pool } = await import("../../server/db");
  await pool.query(`UPDATE users SET ${assignment} WHERE id = $1`, [userId]);
}

/** Log an existing user in on a fresh agent (new cookie jar). */
export async function login(app: Express, email: string, password = DEFAULT_PASSWORD): Promise<Agent> {
  const agent = newAgent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}
