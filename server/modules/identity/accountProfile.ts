/**
 * Account profile sync (#316; ADR-0007).
 *
 * A User manages their account through Clerk's `<UserProfile />`: Clerk owns the
 * credential and the profile, and nothing here edits either. DocuFlow still
 * keeps its own `users` row, and that row has to follow the provider — People,
 * registers, Audit Events and emails all print the names it holds, and
 * Invitations find the User by its address.
 *
 * The body is never believed. The browser only says "something changed"; the
 * server re-reads the User from the IdentityProvider by the session's subject
 * and writes what the provider reports, so nobody can name themselves, or
 * somebody else's address, by posting it.
 *
 * An address another User already holds is refused rather than merged, for the
 * same reason registration refuses one: the `users` row is matched by address
 * for Invitations, so adopting a held address would hand this User the
 * Invitations, and the Memberships behind them, meant for the other. Nothing on
 * the row changes in that case, names included — a half-applied sync would hide
 * the refusal.
 */

import { and, eq, ne } from "drizzle-orm";
import type { RequestHandler } from "express";
import { toSafeUser, users, type User } from "@shared/schema";
import { db } from "../../db";
import { identityProvider } from "./index";
import { IdentityProviderError, type ProviderIdentity } from "./identityProvider";

export class AccountProfileUnauthorizedError extends Error {
  readonly statusCode = 401;
  constructor() {
    super("Unauthorized");
    this.name = "AccountProfileUnauthorizedError";
  }
}

export class AccountProfileUnverifiedEmailError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Confirm your new email address before it becomes your DocuFlow address.");
    this.name = "AccountProfileUnverifiedEmailError";
  }
}

export class AccountProfileEmailTakenError extends Error {
  readonly statusCode = 409;
  constructor() {
    super(
      "That email address belongs to another DocuFlow account. " +
        "Make your previous address primary again, or contact support."
    );
    this.name = "AccountProfileEmailTakenError";
  }
}

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Bring the User's row in line with what the provider holds for the session's
 * subject. The address is only moved when it is verified and nobody else has it;
 * the rest of the profile is the provider's to set.
 */
export async function syncAccountProfile(input: {
  userId: string | undefined;
  subjectId: string | undefined;
}): Promise<User> {
  if (!input.userId || !input.subjectId) throw new AccountProfileUnauthorizedError();
  const identity = await identityFromSubject(input.subjectId);

  const [current] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!current) throw new AccountProfileUnauthorizedError();

  const emailChanged = identity.email !== current.email;
  if (emailChanged) {
    const [holder] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, identity.email), ne(users.id, input.userId)))
      .limit(1);
    if (holder) throw new AccountProfileEmailTakenError();
    // Checked after the held-address test and only for a change: an unchanged
    // address was accepted when the row was written, and refusing it now would
    // stop a name or photo from following.
    if (identity.emailVerified !== true) throw new AccountProfileUnverifiedEmailError();
  }

  try {
    const [updated] = await db
      .update(users)
      .set({
        firstName: identity.firstName ?? null,
        lastName: identity.lastName ?? null,
        profileImageUrl: identity.imageUrl ?? null,
        ...(emailChanged ? { email: identity.email } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId))
      .returning();
    if (!updated) throw new AccountProfileUnauthorizedError();
    return updated;
  } catch (error) {
    // Two Users racing for the same address both pass the read above; the
    // unique index decides, and the loser gets the same answer.
    if ((error as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new AccountProfileEmailTakenError();
    }
    throw error;
  }
}

/**
 * Any provider failure is the same answer: a session whose subject the provider
 * will not describe, or describes without an address, is not one to write from.
 */
async function identityFromSubject(subjectId: string): Promise<ProviderIdentity> {
  let identity: ProviderIdentity | undefined;
  try {
    identity = await identityProvider.findIdentityBySubjectId(subjectId);
  } catch (error) {
    if (error instanceof IdentityProviderError) throw new AccountProfileUnauthorizedError();
    throw error;
  }
  if (!identity?.email) throw new AccountProfileUnauthorizedError();
  return identity;
}

/**
 * `POST /api/account/profile/sync`. Mounted behind `isIdentified`, not
 * `isAuthenticated`: no Workspace is entered, so one that requires a second
 * factor does not block a User from keeping their own profile current. The
 * request body is ignored entirely.
 */
export const accountProfileSyncRoute: RequestHandler = async (req, res) => {
  try {
    const session = req as { identitySessionUserId?: string; sessionSubjectId?: string };
    const user = await syncAccountProfile({
      userId: session.identitySessionUserId,
      subjectId: session.sessionSubjectId,
    });
    res.json(toSafeUser(user));
  } catch (error) {
    if (
      error instanceof AccountProfileUnauthorizedError ||
      error instanceof AccountProfileUnverifiedEmailError ||
      error instanceof AccountProfileEmailTakenError
    ) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    throw error;
  }
};
