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

export interface IdentityProvider {
  importPasswordUser(request: PasswordImportRequest): Promise<ProviderIdentity>;
  authenticate(email: string, password: string): Promise<ProviderIdentity>;
  verifySessionToken(token: string): Promise<IdentitySession>;
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

  private closed(): never {
    throw new IdentityProviderClosedError();
  }
}
