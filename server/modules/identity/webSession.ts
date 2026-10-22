/**
 * IdentityProvider session resolution (#109 as the drain, #111 as the only web
 * path, #162 as web-session vocabulary; ADR-0007, ADR-0017).
 *
 * An `Authorization: Bearer` session the IdentityProvider issued is resolved to
 * the `users.id` the import (#108) linked its subject to. `WorkspaceContext` is
 * built from the Membership exactly as before — authentication moved,
 * authorization did not.
 *
 * Fails closed: an unverifiable token, a provider with no credentials, and a
 * subject nobody is linked to all resolve to nobody, which the caller answers
 * as `Unauthorized` rather than falling back to another identity.
 */

import { IdentityProviderError, type IdentityProvider } from "./identityProvider";

/**
 * Route prefixes whose `Authorization: Bearer` header already means something
 * else, and which a web session therefore never reads: Device access tokens on
 * the desktop agent (which this phase leaves untouched), Service Account
 * secrets on the public API, and the release CI token on the internal
 * endpoints.
 */
export const PATHS_WITHOUT_WEB_SESSION = ["/api/agent", "/api/v1", "/api/internal"] as const;

/**
 * The exceptions inside `/api/agent`: routes under that prefix that are the
 * web's own Device management BFF, guarded by `isAuthenticated` and reached from
 * the browser, not by a Device. They are read like any other `/api/` route —
 * since #110 retired password sign-in, this is the only way a signed-in User can
 * list or revoke their own Devices, or mint a pairing code (#158).
 *
 * Matched exactly rather than by prefix, so a Device-token route that merely
 * starts with the same text is not pulled in with them.
 */
export const WEB_SESSION_AGENT_PATHS = [
  "/api/agent/devices",
  "/api/agent/device/revoke",
  "/api/agent/devices/revoke-machine",
  "/api/agent/pairing/start",
] as const;

export function isWebSessionPath(path: string): boolean {
  if ((WEB_SESSION_AGENT_PATHS as readonly string[]).includes(path)) return true;
  return !PATHS_WITHOUT_WEB_SESSION.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * A Cookie header as a name -> value map. First occurrence of a name wins;
 * values are percent-decoded when they can be, kept raw when they cannot.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || Object.prototype.hasOwnProperty.call(cookies, name)) continue;
    const raw = part.slice(separator + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // keep the raw value
    }
    cookies[name] = value;
  }
  return cookies;
}

export type WebSessionCredential = { token: string; source: "header" | "cookie" };

/**
 * A request this app's own pages started, or one the person started themselves
 * (address bar, bookmark). Clerk's cookie is SameSite=Lax, so a link on another
 * site still carries it on a top-level GET; refusing `cross-site` and
 * `same-site` keeps another site from driving a GET with the session. A browser
 * too old to send the header is let through, as it was before the header existed.
 */
function fromThisSite(secFetchSite: string | undefined): boolean {
  return secFetchSite === undefined || secFetchSite === "same-origin" || secFetchSite === "none";
}

/**
 * Where a web session token may come from (#329).
 *
 * An `Authorization` header, whatever it holds, is the credential: when one is
 * present the cookie is never consulted, even if the header is malformed.
 * Only with no header at all, and only for GET and HEAD, is the provider's
 * first-party session cookie read. Browser-loaded requests (`<img src>`,
 * `<a href download>`) cannot add a header, and safe methods change nothing, so
 * a cross-site form, image or link can never write anything with the cookie
 * (CSRF). Writes need the header the SPA adds; Clerk's cookie is SameSite=Lax
 * anyway, and a request another site started is refused outright
 * (`Sec-Fetch-Site`). A cookie token is also refused unless it was minted for
 * one of this app's origins (see `resolveIdentitySession`'s `authorizedParties`).
 */
export function webSessionCredential(
  request: {
    method: string;
    headers: { authorization?: string; cookie?: string; "sec-fetch-site"?: string };
  },
  provider: IdentityProvider,
): WebSessionCredential | undefined {
  const { authorization, cookie } = request.headers;
  if (authorization !== undefined) {
    const token = bearerToken(authorization);
    return token ? { token, source: "header" } : undefined;
  }
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  if (!fromThisSite(request.headers["sec-fetch-site"])) return undefined;
  const token = provider.sessionTokenFromCookies(parseCookieHeader(cookie));
  return token ? { token, source: "cookie" } : undefined;
}

export interface WebSessionPersistence {
  /** The User the import linked to this subject id, if any. */
  getUserByIdentityProviderSubjectId(subjectId: string): Promise<{ id: string } | undefined>;
}

export type ResolvedIdentitySession = {
  userId?: string;
  subjectId: string;
  secondFactorVerified: boolean;
  platformStaff: boolean;
};

/**
 * The session behind a token: the linked User when there is one, and the
 * claims DocuFlow authorizes on (#300). A subject the provider will vouch for
 * but nobody imported is not a User here — Platform Staff are that case on
 * purpose, and they are not given a `users.id`.
 */
export async function resolveIdentitySession(deps: {
  provider: IdentityProvider;
  persistence: WebSessionPersistence;
  token: string;
  /**
   * When given, the token's `azp` must be one of these origins, else the session
   * is refused (a token naming no party is refused too). Used for cookie-borne
   * tokens, which the browser attaches on its own.
   */
  authorizedParties?: readonly string[];
}): Promise<ResolvedIdentitySession | undefined> {
  const { provider, persistence, token } = deps;
  let session;
  try {
    session = await provider.verifySessionToken(token);
  } catch (error) {
    // Every port failure — an invalid token, absent credentials, a provider that
    // cannot be reached — is the same answer: this request has no Clerk-mapped
    // identity.
    if (error instanceof IdentityProviderError) return undefined;
    throw error;
  }

  if (
    deps.authorizedParties !== undefined &&
    (session.authorizedParty === null || !deps.authorizedParties.includes(session.authorizedParty))
  ) {
    return undefined;
  }

  const user = await persistence.getUserByIdentityProviderSubjectId(session.providerSubjectId);
  return {
    userId: user?.id,
    subjectId: session.providerSubjectId,
    secondFactorVerified: session.secondFactorVerified,
    platformStaff: session.platformStaff,
  };
}

/**
 * The `users.id` behind an IdentityProvider session token, or `undefined` when
 * the token does not name one.
 */
export async function userIdFromIdentitySession(deps: {
  provider: IdentityProvider;
  persistence: WebSessionPersistence;
  token: string;
}): Promise<string | undefined> {
  const resolved = await resolveIdentitySession(deps);
  return resolved?.userId;
}
