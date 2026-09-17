/**
 * Clerk IdentityProvider adapter (#106, ADR-0007). The only server module that
 * imports `@clerk/backend`. Clerk user ids become `providerSubjectId` here;
 * DocuFlow never stores Clerk types as authorization truth.
 */

import { createClerkClient, verifyToken } from "@clerk/backend";
import {
  IdentityProviderClosedError,
  IdentityProviderError,
  IdentityProviderImportError,
  IdentitySessionError,
  isUsablePasswordHash,
  type IdentityProvider,
  type IdentityProviderConfig,
  type IdentitySession,
  type PasswordImportRequest,
  type PasswordSetInvite,
  type PasswordSetInviteRequest,
  type ProviderIdentity,
} from "./identityProvider";

type ClerkEmailAddress = {
  id?: string;
  emailAddress: string;
  verification?: { status?: string | null } | null;
};

type ClerkUser = {
  id: string;
  emailAddresses?: ClerkEmailAddress[];
  primaryEmailAddressId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/**
 * The address Clerk calls primary, not merely the first one it listed. A Clerk
 * User may hold several, in an order nothing promises, and the one this side
 * builds an identity from decides which DocuFlow `users` row a session can
 * become — so a secondary address that happened to sort first must not be it.
 * With no primary named, a sole address is unambiguous and anything else is not.
 */
function primaryAddressOf(user: ClerkUser): ClerkEmailAddress | undefined {
  const addresses = user.emailAddresses ?? [];
  if (user.primaryEmailAddressId) {
    return addresses.find((address) => address.id === user.primaryEmailAddressId);
  }
  return addresses.length === 1 ? addresses[0] : undefined;
}

type ClerkInvitation = {
  id: string;
  emailAddress: string;
};

function emailOf(user: ClerkUser, fallback?: string): string {
  return primaryAddressOf(user)?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? fallback ?? "";
}

function toIdentity(user: ClerkUser, fallbackEmail?: string): ProviderIdentity {
  const email = emailOf(user, fallbackEmail);
  if (!user.id || !email) {
    throw new IdentityProviderError("Clerk User is missing a subject id or email");
  }
  const primary = primaryAddressOf(user);
  return {
    providerSubjectId: user.id,
    email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    // Only the primary address can carry the verdict, and only when it is the
    // address being reported: a confirmed secondary says nothing about this one.
    emailVerified:
      primary?.emailAddress === email && primary?.verification?.status === "verified",
  };
}

/** @clerk/backend `verifyToken` returns `{ data }` or `{ errors }`, not a bare payload. */
function sessionPayloadFromVerifyResult(result: unknown): { sub?: string } {
  if (!result || typeof result !== "object") throw new IdentitySessionError();
  const record = result as { data?: { sub?: string }; errors?: unknown[]; sub?: string };
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    throw new IdentitySessionError();
  }
  if (record.data && typeof record.data === "object") {
    return record.data;
  }
  return record;
}

export class ClerkIdentityProvider implements IdentityProvider {
  private readonly clerk: ReturnType<typeof createClerkClient>;
  private readonly secretKey: string;

  constructor(identity: IdentityProviderConfig) {
    if (!identity.secretKey) {
      throw new IdentityProviderClosedError();
    }
    this.secretKey = identity.secretKey;
    this.clerk = createClerkClient({
      secretKey: identity.secretKey,
      publishableKey: identity.publishableKey,
    });
  }

  async importPasswordUser(request: PasswordImportRequest): Promise<ProviderIdentity> {
    if (!isUsablePasswordHash(request.passwordHash)) {
      throw new IdentityProviderImportError(
        `${request.email} has no usable password hash and cannot be imported as a password User`
      );
    }
    const existing = await this.findByEmail(request.email);
    if (existing) return toIdentity(existing, request.email);

    try {
      const created = await this.clerk.users.createUser({
        emailAddress: [request.email],
        passwordDigest: request.passwordHash,
        passwordHasher: "bcrypt",
        ...(request.firstName ? { firstName: request.firstName } : {}),
        ...(request.lastName ? { lastName: request.lastName } : {}),
      });
      return toIdentity(created, request.email);
    } catch (error) {
      throw new IdentityProviderError(
        error instanceof Error ? error.message : "Clerk import failed"
      );
    }
  }

  async authenticate(email: string, password: string): Promise<ProviderIdentity> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new IdentityProviderError("Invalid email or password");
    }
    try {
      await this.clerk.users.verifyPassword({ userId: user.id, password });
    } catch {
      throw new IdentityProviderError("Invalid email or password");
    }
    return toIdentity(user, email);
  }

  async verifySessionToken(token: string): Promise<IdentitySession> {
    try {
      const payload = sessionPayloadFromVerifyResult(
        await verifyToken(token, { secretKey: this.secretKey }),
      );
      const subject = payload.sub;
      if (typeof subject !== "string" || subject.length === 0) throw new IdentitySessionError();
      return { providerSubjectId: subject };
    } catch (error) {
      if (error instanceof IdentityProviderError) throw error;
      if (process.env.NODE_ENV !== "test") {
        console.error(
          "Clerk session token rejected:",
          error instanceof Error ? error.message : error,
        );
      }
      throw new IdentitySessionError();
    }
  }

  /**
   * Idempotent the same way the import is: an outstanding invitation for this
   * address is returned rather than a second one being sent, so re-running the
   * drain does not mail the same person twice.
   */
  async sendPasswordSetInvite(request: PasswordSetInviteRequest): Promise<PasswordSetInvite> {
    const outstanding = await this.findPendingInvitation(request.email);
    if (outstanding) {
      return { email: request.email, inviteId: outstanding.id, alreadyPending: true };
    }
    try {
      const created = await this.clerk.invitations.createInvitation({
        emailAddress: request.email,
      });
      return { email: request.email, inviteId: created.id, alreadyPending: false };
    } catch (error) {
      throw new IdentityProviderError(
        error instanceof Error ? error.message : "Clerk password-set invite failed"
      );
    }
  }

  async pendingPasswordSetInvites(): Promise<string[]> {
    return (await this.listPendingInvitations()).map((invitation) => invitation.emailAddress);
  }

  async findIdentityByEmail(email: string): Promise<ProviderIdentity | undefined> {
    const user = await this.findByEmail(email);
    return user ? toIdentity(user, email) : undefined;
  }

  /**
   * A subject the provider will not vouch for is `undefined`, not a throw: the
   * caller's answer to "who is this?" is "nobody", and registration refuses on
   * that rather than on an exception it would have to classify.
   */
  async findIdentityBySubjectId(providerSubjectId: string): Promise<ProviderIdentity | undefined> {
    let user: ClerkUser;
    try {
      user = await this.clerk.users.getUser(providerSubjectId);
    } catch {
      return undefined;
    }
    return toIdentity(user);
  }

  private async findByEmail(email: string): Promise<ClerkUser | null> {
    const list = await this.clerk.users.getUserList({ emailAddress: [email] });
    return list.data[0] ?? null;
  }

  private async findPendingInvitation(email: string): Promise<ClerkInvitation | null> {
    const pending = await this.listPendingInvitations();
    return pending.find((invitation) => invitation.emailAddress === email) ?? null;
  }

  private async listPendingInvitations(): Promise<ClerkInvitation[]> {
    const list = await this.clerk.invitations.getInvitationList({ status: "pending" });
    return list.data ?? [];
  }
}
