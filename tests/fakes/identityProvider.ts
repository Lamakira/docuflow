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
  type PasswordSetInvite,
  type PasswordSetInviteRequest,
  type ProviderIdentity,
} from "../../server/modules/identity/identityProvider";

type Stored = ProviderIdentity & { passwordHash: string };

export class FakeIdentityProvider implements IdentityProvider {
  readonly imports: PasswordImportRequest[] = [];
  readonly invites: PasswordSetInviteRequest[] = [];
  private readonly byEmail = new Map<string, Stored>();
  private readonly sessions = new Map<string, IdentitySession>();
  private readonly pendingInvites = new Map<string, PasswordSetInvite>();
  private seq = 0;
  private inviteSeq = 0;

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

  async sendPasswordSetInvite(request: PasswordSetInviteRequest): Promise<PasswordSetInvite> {
    this.invites.push(request);
    const outstanding = this.pendingInvites.get(request.email);
    if (outstanding) return { ...outstanding, alreadyPending: true };
    this.inviteSeq += 1;
    const invite: PasswordSetInvite = {
      email: request.email,
      inviteId: `inv_fake_${this.inviteSeq}`,
      alreadyPending: false,
    };
    this.pendingInvites.set(request.email, invite);
    return invite;
  }

  async pendingPasswordSetInvites(): Promise<string[]> {
    return [...this.pendingInvites.keys()];
  }

  async findIdentityByEmail(email: string): Promise<ProviderIdentity | undefined> {
    const stored = this.byEmail.get(email);
    return stored ? { providerSubjectId: stored.providerSubjectId, email: stored.email } : undefined;
  }

  /**
   * Test helper — not on the port. Stands in for an invitee answering their
   * invite: the provider now holds the address, and the invitation is spent.
   */
  acceptPasswordSetInvite(email: string, passwordHash = "$2b$04$" + "x".repeat(53)): string {
    this.pendingInvites.delete(email);
    this.seq += 1;
    const stored: Stored = {
      providerSubjectId: `user_fake_${this.seq}`,
      email,
      passwordHash,
    };
    this.byEmail.set(email, stored);
    return stored.providerSubjectId;
  }
}
