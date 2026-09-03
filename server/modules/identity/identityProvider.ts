/**
 * IdentityProvider port (#106, ADR-0007). Application code that talks to Clerk
 * talks only to this surface. Clerk types stay inside the adapter.
 */

export type IdentityProviderConfig = {
  secretKey?: string;
  publishableKey?: string;
};

export class IdentityProviderError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "IdentityProviderError";
  }
}

export class IdentityProviderClosedError extends IdentityProviderError {
  constructor(detail = "Clerk credentials are not configured") {
    super(detail);
    this.name = "IdentityProviderClosedError";
  }
}

export class IdentityProviderImportError extends IdentityProviderError {
  constructor(detail: string) {
    super(detail);
    this.name = "IdentityProviderImportError";
  }
}

export class IdentitySessionError extends IdentityProviderError {
  constructor(detail = "invalid session token") {
    super(detail);
    this.name = "IdentitySessionError";
  }
}

export type PasswordImportRequest = {
  email: string;
  passwordHash: string;
  firstName?: string | null;
  lastName?: string | null;
};

export type ProviderIdentity = {
  providerSubjectId: string;
  email: string;
};

export type IdentitySession = {
  providerSubjectId: string;
  email: string;
};

export type PasswordSetInviteRequest = {
  email: string;
};

export type PasswordSetInvite = {
  email: string;
  inviteId: string;
  /** True when the provider already held an outstanding invite, so nothing new was sent. */
  alreadyPending: boolean;
};

export interface IdentityProvider {
  importPasswordUser(request: PasswordImportRequest): Promise<ProviderIdentity>;
  authenticate(email: string, password: string): Promise<ProviderIdentity>;
  verifySessionToken(token: string): Promise<IdentitySession>;
  /**
   * Invite an address to set a password at the provider (#109). This is what an
   * OIDC-only User gets in place of an import — it is not a Workspace
   * Invitation, and it grants no Membership.
   */
  sendPasswordSetInvite(request: PasswordSetInviteRequest): Promise<PasswordSetInvite>;
  /** Addresses with an outstanding invite, for the drain's verifier. */
  pendingPasswordSetInvites(): Promise<string[]>;
  /**
   * The identity this provider already holds for an address, if any. An invitee
   * who has set their password has one, which is how the drain tells an accepted
   * invite from an unanswered one.
   */
  findIdentityByEmail(email: string): Promise<ProviderIdentity | undefined>;
}

/** bcrypt as stored on `users.password`. The OIDC placeholder is not usable. */
const BCRYPT = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isUsablePasswordHash(hash: string | null | undefined): boolean {
  return typeof hash === "string" && BCRYPT.test(hash);
}

export class UnconfiguredIdentityProvider implements IdentityProvider {
  async importPasswordUser(): Promise<ProviderIdentity> {
    this.closed();
  }

  async authenticate(): Promise<ProviderIdentity> {
    this.closed();
  }

  async verifySessionToken(): Promise<IdentitySession> {
    this.closed();
  }

  async sendPasswordSetInvite(): Promise<PasswordSetInvite> {
    this.closed();
  }

  async pendingPasswordSetInvites(): Promise<string[]> {
    this.closed();
  }

  async findIdentityByEmail(): Promise<ProviderIdentity | undefined> {
    this.closed();
  }

  private closed(): never {
    throw new IdentityProviderClosedError();
  }
}
