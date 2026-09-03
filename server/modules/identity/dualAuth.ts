/**
 * The dual-auth drain (#109, ADR-0007, ADR-0017).
 *
 * For the length of the drain window a User has two ways into the same
 * Workspace: the legacy session (email/password or Replit OIDC) they already
 * hold, and a session the IdentityProvider issued against the subject id the
 * import (#108) linked them to. Both resolve to one `users.id`, so
 * `WorkspaceContext` is built from the Membership exactly as before —
 * authentication moved, authorization did not.
 *
 * Fails closed: an unverifiable token, a provider with no credentials, and a
 * subject nobody is linked to all resolve to nobody, which the caller answers
 * as `Unauthorized` rather than falling back to another identity.
 */

import { IdentityProviderError, type IdentityProvider } from "./identityProvider";

/**
 * Route prefixes whose `Authorization: Bearer` header already means something
 * else, and which the drain therefore never reads: Device access tokens on the
 * desktop agent (which this phase leaves untouched), Service Account secrets on
 * the public API, and the release CI token on the internal endpoints.
 */
export const PATHS_NOT_DRAINED = ["/api/agent", "/api/v1", "/api/internal"] as const;

export function isDrainablePath(path: string): boolean {
  return !PATHS_NOT_DRAINED.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

export interface DualAuthPersistence {
  /** The User the import linked to this subject id, if any. */
  getUserByIdentityProviderSubjectId(subjectId: string): Promise<{ id: string } | undefined>;
}

/**
 * The `users.id` behind an IdentityProvider session token, or `undefined` when
 * the token does not name one. The link is read from DocuFlow's own table: a
 * subject the provider will vouch for but nobody imported is not a User here.
 */
export async function userIdFromIdentitySession(deps: {
  provider: IdentityProvider;
  persistence: DualAuthPersistence;
  token: string;
}): Promise<string | undefined> {
  const { provider, persistence, token } = deps;
  let providerSubjectId: string;
  try {
    ({ providerSubjectId } = await provider.verifySessionToken(token));
  } catch (error) {
    // Every port failure — an invalid token, absent credentials, a provider that
    // cannot be reached — is the same answer during a drain: this request has no
    // Clerk-mapped identity, and the legacy session is still there for the User.
    if (error instanceof IdentityProviderError) return undefined;
    throw error;
  }

  const user = await persistence.getUserByIdentityProviderSubjectId(providerSubjectId);
  return user?.id;
}
