/**
 * Password-set invites for OIDC-only Users (#109, ADR-0007, ADR-0017).
 *
 * The leftover the import (#108) names: an unlinked User has no digest to
 * carry over (#161), so instead of an import they are invited to set a password
 * at the provider. A User who is already linked is never invited. This is not
 * a Workspace Invitation and grants no Membership.
 *
 * The run also closes the loop the invite opens. An invitee who has answered
 * theirs is a User at the provider but still unlinked here, so the subject id is
 * written back exactly as the import writes one — which is what stops the
 * verifier from staying red once invites start being accepted, and what lets
 * that account reach a Workspace through the drain.
 */

import {
  IdentityProviderClosedError,
  type IdentityProvider,
} from "./identityProvider";
import { classifyUserForImport, type UserImportPersistence } from "./userImport";

export type PasswordSetInviteStatus = "invited" | "already-invited" | "accepted" | "failed";

export type PasswordSetInviteOutcome = {
  userId: string;
  email: string;
  status: PasswordSetInviteStatus;
  inviteId?: string;
  providerSubjectId?: string;
  detail?: string;
};

export type PasswordSetInviteReport = {
  outcomes: PasswordSetInviteOutcome[];
  counts: {
    invited: number;
    alreadyInvited: number;
    accepted: number;
    failed: number;
  };
  /**
   * The verifier ADR-0017 asks every data-movement run to carry, re-read from
   * the database and the provider rather than tallied in the loop: Users still
   * owed an invite for whom none is outstanding. Zero is done.
   */
  remainingToInvite: number;
};

/** The addresses an invite is owed, decided without reaching the provider. */
export async function planPasswordSetInvites(
  persistence: UserImportPersistence
): Promise<Array<{ userId: string; email: string }>> {
  const owed = await usersOwedAnInvite(persistence);
  return owed.map((user) => ({ userId: user.id, email: user.email }));
}

/**
 * Invite every OIDC-only User, and link the ones who have already answered.
 *
 * Idempotent twice over, like the import: an accepted invite becomes a link and
 * drops out of the list, and an outstanding one is returned by the port rather
 * than sent again — so a re-run after a partial one mails nobody twice.
 */
export async function sendPasswordSetInvites(deps: {
  persistence: UserImportPersistence;
  provider: IdentityProvider;
}): Promise<PasswordSetInviteReport> {
  const { persistence, provider } = deps;
  const owed = await usersOwedAnInvite(persistence);
  const outcomes: PasswordSetInviteOutcome[] = [];

  // Sequential for the same reason the import is: the provider is rate-limited,
  // and this one sends mail — a partial run has to be resumable by re-running
  // rather than by reasoning about interleaved writes.
  for (const user of owed) {
    try {
      outcomes.push(await settleOne(user, provider, persistence));
    } catch (error) {
      // Missing credentials fail every address identically, so surface it once
      // and stop rather than writing a report that says the whole list failed.
      if (error instanceof IdentityProviderClosedError) throw error;
      outcomes.push({
        userId: user.id,
        email: user.email,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const stillOwed = await usersOwedAnInvite(persistence);
  const pending = new Set(await provider.pendingPasswordSetInvites());

  return {
    outcomes,
    remainingToInvite: stillOwed.filter((user) => !pending.has(user.email)).length,
    counts: {
      invited: countOf(outcomes, "invited"),
      alreadyInvited: countOf(outcomes, "already-invited"),
      accepted: countOf(outcomes, "accepted"),
      failed: countOf(outcomes, "failed"),
    },
  };
}

async function settleOne(
  user: { id: string; email: string },
  provider: IdentityProvider,
  persistence: UserImportPersistence
): Promise<PasswordSetInviteOutcome> {
  // Asked before inviting: the provider already holding this address means the
  // invite was answered, and sending a second one would mail somebody who is
  // done. All that is missing then is the link.
  const identity = await provider.findIdentityByEmail(user.email);
  if (identity) {
    await persistence.linkUserToIdentityProvider(user.id, identity.providerSubjectId);
    return {
      userId: user.id,
      email: user.email,
      status: "accepted",
      providerSubjectId: identity.providerSubjectId,
    };
  }

  const invite = await provider.sendPasswordSetInvite({ email: user.email });
  return {
    userId: user.id,
    email: user.email,
    status: invite.alreadyPending ? "already-invited" : "invited",
    inviteId: invite.inviteId,
  };
}

function countOf(
  outcomes: PasswordSetInviteOutcome[],
  status: PasswordSetInviteStatus
): number {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

async function usersOwedAnInvite(
  persistence: UserImportPersistence
): Promise<Array<{ id: string; email: string }>> {
  const users = await persistence.listUsersForIdentityImport();
  return users
    .filter((user) => classifyUserForImport(user) === "password-set-invite")
    .map((user) => ({ id: user.id, email: user.email }));
}
