/**
 * In-memory IdentityProvider (ADR-0018: fakes only).
 *
 * Tests speak to the port, not to Clerk types. Import is by bcrypt hash;
 * Clerk user ids never appear on this surface.
 *
 * Imports the port module, not the identity barrel, so constructing a fake does
 * not boot the process-wide provider or load `server/config.ts`.
 */

import bcrypt from "bcrypt";
import {
  IdentityProviderError,
  IdentityProviderImportError,
  IdentitySessionError,
  isUsablePasswordHash,
  type IdentityProvider,
  type IdentitySession,
  type PasswordImportRequest,
  type ProviderIdentity,
} from "../../server/modules/identity/identityProvider";

type Stored = ProviderIdentity & { passwordHash: string };

export class FakeIdentityProvider implements IdentityProvider {
  readonly imports: PasswordImportRequest[] = [];
  private readonly byEmail = new Map<string, Stored>();
  private readonly sessions = new Map<string, IdentitySession>();
  private seq = 0;

  async importPasswordUser(request: PasswordImportRequest): Promise<ProviderIdentity> {
    this.imports.push(request);
    if (!isUsablePasswordHash(request.passwordHash)) {
      throw new IdentityProviderImportError(
        `${request.email} has no usable password hash and cannot be imported as a password User`
      );
    }
    const existing = this.byEmail.get(request.email);
    if (existing) {
      return { providerSubjectId: existing.providerSubjectId, email: existing.email };
    }
    this.seq += 1;
    const stored: Stored = {
      providerSubjectId: `user_fake_${this.seq}`,
      email: request.email,
      passwordHash: request.passwordHash,
    };
    this.byEmail.set(request.email, stored);
    return { providerSubjectId: stored.providerSubjectId, email: stored.email };
  }

  async authenticate(email: string, password: string): Promise<ProviderIdentity> {
    const stored = this.byEmail.get(email);
    if (!stored || !(await bcrypt.compare(password, stored.passwordHash))) {
      throw new IdentityProviderError("Invalid email or password");
    }
    return { providerSubjectId: stored.providerSubjectId, email: stored.email };
  }

  /** Test helper — not on the port. Maps a linked subject to a session token. */
  issueSessionToken(providerSubjectId: string): string {
    const stored = [...this.byEmail.values()].find(
      (identity) => identity.providerSubjectId === providerSubjectId
    );
    if (!stored) throw new IdentitySessionError();
    const token = `sess_fake_${providerSubjectId}`;
    this.sessions.set(token, {
      providerSubjectId: stored.providerSubjectId,
      email: stored.email,
    });
    return token;
  }

  async verifySessionToken(token: string): Promise<IdentitySession> {
    const session = this.sessions.get(token);
    if (!session) throw new IdentitySessionError();
    return session;
  }
}
