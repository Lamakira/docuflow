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
  type ProviderIdentity,
} from "./identityProvider";

type ClerkUser = {
  id: string;
  emailAddresses?: Array<{ emailAddress: string }>;
};

function emailOf(user: ClerkUser, fallback?: string): string {
  return user.emailAddresses?.[0]?.emailAddress ?? fallback ?? "";
}

function toIdentity(user: ClerkUser, fallbackEmail?: string): ProviderIdentity {
  const email = emailOf(user, fallbackEmail);
  if (!user.id || !email) {
    throw new IdentityProviderError("Clerk User is missing a subject id or email");
  }
  return { providerSubjectId: user.id, email };
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
      const payload = await verifyToken(token, { secretKey: this.secretKey });
      const subject = payload.sub;
      if (!subject) throw new IdentitySessionError();
      const user = await this.clerk.users.getUser(subject);
      return toIdentity(user);
    } catch (error) {
      if (error instanceof IdentityProviderError) throw error;
      throw new IdentitySessionError();
    }
  }

  private async findByEmail(email: string): Promise<ClerkUser | null> {
    const list = await this.clerk.users.getUserList({ emailAddress: [email] });
    return list.data[0] ?? null;
  }
}
