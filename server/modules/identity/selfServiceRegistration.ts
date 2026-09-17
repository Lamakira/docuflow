/**
 * Self-service registration (#230, Flow 1 steps 1–2; ADR-0007).
 *
 * Reverses the closure #110 recorded. The reason written down then was that an
 * account created at Clerk's sign-up "would be a dead end", because a subject
 * with no linked User reached nothing. #217 built the room behind that door: a
 * User with no Membership names a first Workspace, becomes its Owner, and
 * enters `Trialing`. What was missing is the step between — Flow 1 step 2,
 * where DocuFlow receives an authenticated identity and links or creates its
 * own `User`.
 *
 * Clerk still owns every credential surface. Nothing here reads a password, and
 * the address is taken from the provider rather than from the request body: the
 * caller proves who they are with a session, and the session is the only thing
 * this route believes.
 *
 * Three rules keep that from being a way in to somebody else's Workspaces:
 *
 *  - **The address must be a verified primary at the provider.** The `users`
 *    row is found by address in more places than this one — `listInvitationsForUser`
 *    matches on it, and `resolveInvitee` accepts a subject whose row carries the
 *    invited address. So a row written under an address nobody challenged is not
 *    a cosmetic error: register as `ada@acme.com` before anyone invites the real
 *    Ada, and the Invitation meant for her is offered to, and accepted by, whoever
 *    claimed it first. DocuFlow refuses to write the row instead.
 *  - **An address this DocuFlow already holds is refused, linked or not.** The
 *    tempting behaviour is to adopt an unlinked row on a matching address, the
 *    way Invitation acceptance does. Acceptance can: possession of the token
 *    sent to that address is proof of control over it. A sign-up is not — the
 *    provider reports an address this side never challenged — so adopting on a
 *    match would hand a stranger an existing User, its role included. Linking
 *    a legacy account stays where Phase 5 put it, with the #108 import.
 *  - **The new User joins no Workspace.** `storage.createUser` seeds a
 *    Membership in the seeded Workspace, which for a stranger off the internet
 *    is somebody else's data, so the row is written here instead.
 */

import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";
import { toSafeUser, users, type User } from "@shared/schema";
import { db } from "../../db";
import { identityProvider } from "./index";
import { IdentityProviderError, type ProviderIdentity } from "./identityProvider";
import { bearerToken } from "./webSession";

export class RegistrationUnauthorizedError extends Error {
  readonly statusCode = 401;
  constructor() {
    super("Unauthorized");
    this.name = "RegistrationUnauthorizedError";
  }
}

export class RegistrationUnverifiedEmailError extends Error {
  readonly statusCode = 403;
  constructor() {
    super(
      "Confirm your email address with your sign-in provider, then reload this page"
    );
    this.name = "RegistrationUnverifiedEmailError";
  }
}

export class RegistrationEmailTakenError extends Error {
  readonly statusCode = 409;
  constructor() {
    super(
      "A DocuFlow account already exists for that email address. Sign in with it, " +
        "or ask an Administrator to link it to your new sign-in"
    );
    this.name = "RegistrationEmailTakenError";
  }
}

export type RegistrationOutcome = {
  user: User;
  /** False when the identity already had a User — a reload, or a second tab. */
  created: boolean;
};

/**
 * The User behind a provider session, creating it if this is the first time the
 * session has been presented. Idempotent: the browser returns from Clerk once
 * per sign-up, but a reload, a second tab, and a retry all arrive here too.
 *
 * `resolvedUserId` is what the `identitySession` middleware already worked out
 * for this request. When it is set the provider has nothing left to tell us, so
 * the repeat calls — which are most of them — cost no round trip.
 */
export async function registerIdentity(input: {
  authorization: string | undefined;
  resolvedUserId?: string;
}): Promise<RegistrationOutcome> {
  if (input.resolvedUserId) {
    const existing = await userById(input.resolvedUserId);
    if (existing) return { user: existing, created: false };
  }

  const identity = await identityFromSession(input.authorization);

  const linked = await userBySubject(identity.providerSubjectId);
  if (linked) return { user: linked, created: false };

  // Checked here rather than in the adapter, and only on the way to a new row:
  // the port reports what the provider says, and what to do about an
  // unconfirmed address is this side's decision. A subject that already has a
  // User is past it — the row exists, and refusing now would lock them out of
  // an account rather than prevent one.
  if (identity.emailVerified !== true) throw new RegistrationUnverifiedEmailError();

  // Two first requests from the same browser — the second tab this route is
  // idempotent for — both miss the select above and both reach this insert.
  // The conflict makes the loser write nothing rather than crash on the unique
  // address, and the read below then answers with whichever row won.
  const [created] = await db
    .insert(users)
    .values({
      email: identity.email,
      firstName: identity.firstName ?? null,
      lastName: identity.lastName ?? null,
      identityProviderSubjectId: identity.providerSubjectId,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return { user: created, created: true };

  const raced = await userBySubject(identity.providerSubjectId);
  if (raced) return { user: raced, created: false };
  // Nothing was written and this subject still has no row, so the address is
  // what collided: somebody else already holds it here.
  throw new RegistrationEmailTakenError();
}

async function userById(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

async function userBySubject(providerSubjectId: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.identityProviderSubjectId, providerSubjectId))
    .limit(1);
  return user;
}

/**
 * Who the session says this is, with the address the User will be created
 * under. Every provider failure is the same answer — a session this side cannot
 * resolve authenticates nobody, and there is nothing to register.
 */
async function identityFromSession(authorization: string | undefined): Promise<ProviderIdentity> {
  const token = bearerToken(authorization);
  if (!token) throw new RegistrationUnauthorizedError();

  const { providerSubjectId } = await orUnauthorized(() =>
    identityProvider.verifySessionToken(token)
  );
  const identity = await orUnauthorized(() =>
    identityProvider.findIdentityBySubjectId(providerSubjectId)
  );
  // A verified session whose subject the provider will not describe, or
  // describes without an address, cannot become a `users` row: the address is
  // the column, and inventing one would make an account nobody can be invited
  // to or recover.
  if (!identity?.email) throw new RegistrationUnauthorizedError();
  return identity;
}

async function orUnauthorized<T>(ask: () => Promise<T>): Promise<T> {
  try {
    return await ask();
  } catch (error) {
    if (error instanceof IdentityProviderError) throw new RegistrationUnauthorizedError();
    throw error;
  }
}

/**
 * `POST /api/auth/user` — the return from Clerk's sign-up. Mounted beside the
 * `GET` that reads the same row, and outside `isAuthenticated`, because the
 * whole point is that there is not yet a User to authenticate, let alone a
 * Membership to enter a Workspace with.
 *
 * The already-resolved id is read off the request the way `getUserId` does
 * rather than through it: `server/auth.ts` imports this module's barrel, so
 * importing it back would close a cycle.
 */
export const selfServiceRegistrationRoute: RequestHandler = async (req, res) => {
  try {
    const outcome = await registerIdentity({
      authorization: req.headers.authorization,
      resolvedUserId: (req as { identitySessionUserId?: string }).identitySessionUserId,
    });
    res.status(outcome.created ? 201 : 200).json(toSafeUser(outcome.user));
  } catch (error) {
    if (
      error instanceof RegistrationUnauthorizedError ||
      error instanceof RegistrationUnverifiedEmailError ||
      error instanceof RegistrationEmailTakenError
    ) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    throw error;
  }
};
