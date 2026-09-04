import request from "supertest";
import type { Express } from "express";

export type Agent = ReturnType<typeof request.agent>;

export interface TestUser {
  id: string;
  email: string;
  /**
   * The password on `users.password`. Since #159 no HTTP surface checks it —
   * web sign-in is Clerk (#110) and agent enrollment is pairing. Kept so
   * suites that still write or email the hash can name the value they wrote.
   */
  password: string;
  /** Agent already carrying this user's IdentityProvider session token. */
  agent: Agent;
}

const DEFAULT_PASSWORD = "password123";

let sequence = 0;

/** Unique per call, so a suite can create many users without collisions. */
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
 * bcrypt at the app's own cost, computed once per distinct password.
 *
 * Twelve rounds is deliberately slow, and the harness hashes the same handful of
 * passwords hundreds of times; caching keeps the real cost factor on the stored
 * hash — which is what the import reads — without paying it per user.
 */
const hashes = new Map<string, Promise<string>>();

function passwordHash(password: string): Promise<string> {
  let hash = hashes.get(password);
  if (!hash) {
    hash = import("../../server/auth").then(({ hashPassword }) => hashPassword(password));
    hashes.set(password, hash);
  }
  return hash;
}

/**
 * A User who signs in the way the web signs in after #110: the row is created
 * directly, imported into the IdentityProvider by bcrypt hash the way #108 does
 * it, and the returned agent carries a provider session token on every request.
 *
 * Created through storage rather than over HTTP because there is no longer a
 * registration endpoint to post to — `POST /api/auth/register` is retired, and
 * `tests/smoke/web-auth-cutover.test.ts` is where that is proven.
 */
export async function registerUser(
  app: Express,
  overrides: { email?: string; password?: string; firstName?: string; lastName?: string } = {}
): Promise<TestUser> {
  const user = await createUnlinkedUser(overrides);
  return { ...user, agent: await signIn(app, user.id) };
}

/**
 * A User row with a real bcrypt hash and no IdentityProvider link — the state
 * every User was in before the #108 import ran, and the one the import suites
 * are about.
 *
 * No agent comes back, because linking is what makes signing in possible. A
 * suite that wants one anyway passes the id to `signIn`, which links first.
 */
export async function createUnlinkedUser(
  overrides: { email?: string; password?: string; firstName?: string; lastName?: string } = {}
): Promise<Omit<TestUser, "agent">> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const { storage } = await import("../../server/storage");

  const user = await storage.createUser({
    email,
    password: await passwordHash(password),
    firstName: overrides.firstName ?? null,
    lastName: overrides.lastName ?? null,
    profileImageUrl: null,
  });

  return { id: user.id, email, password };
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

/**
 * Sign an existing User in on a fresh agent — a second browser, in other words.
 *
 * Links the User to the IdentityProvider if the suite has not already, then
 * mints a session token for the subject that came back. The provider is reached
 * through the port; `vitest.config.ts` aliases the Clerk SDK to
 * `tests/fakes/clerk.ts`, so no run leaves the process.
 */
export async function signIn(app: Express, userId: string): Promise<Agent> {
  const { storage } = await import("../../server/storage");
  const { identityProvider } = await import("../../server/modules/identity");
  const { issueClerkSession } = await import("../fakes/clerk");

  const user = await storage.getUserWithPassword(userId);
  if (!user) throw new Error(`signIn: no User ${userId}`);

  let subjectId = user.identityProviderSubjectId;
  if (!subjectId) {
    const identity = await identityProvider.importPasswordUser({
      email: user.email,
      passwordHash: user.password,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    subjectId = identity.providerSubjectId;
    await storage.linkUserToIdentityProvider(user.id, subjectId);
  }

  return newAgent(app).set("Authorization", `Bearer ${issueClerkSession(subjectId)}`);
}

/** Sign an existing User in by address, for suites that only kept the email. */
export async function login(app: Express, email: string): Promise<Agent> {
  const { storage } = await import("../../server/storage");
  const user = await storage.getUserByEmail(email);
  if (!user) throw new Error(`login: no User with email ${email}`);
  return signIn(app, user.id);
}
