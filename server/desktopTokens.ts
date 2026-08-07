/**
 * desktopTokens.ts — the short-lived access tokens the desktop agent presents.
 *
 * Hand-assembled HS256 JWTs: three base64url segments, the third an HMAC over
 * the first two. No library, and no state of its own — the keys come from
 * `server/config.ts`, which reads them from the environment, so a token outlives
 * the process that issued it. A restart, a deploy, or a second replica keeps
 * accepting the tokens already in the fleet's hands.
 *
 * Every token names its key in the header (`kid`). That is what makes a rotation
 * survivable: for one token lifetime both keys are configured, tokens signed
 * with either verify, and each new one is stamped with the incoming key — so the
 * outgoing key can be dropped once nothing carries its name any more.
 * docs/CONFIGURATION.md holds the procedure.
 *
 * Device tokens are a different credential and are not touched here: opaque,
 * long-lived, and stored as a hash by `server/agentRoutes.ts`.
 */

import { createHmac } from "crypto";
import { config, type SigningKey } from "./config";

/** An hour, unchanged since the protocol's first version. */
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

/** The key every token issued by this process is signed with. */
const signingKey: SigningKey = config.desktopTokens.current;

/**
 * Every key a presented token may have been signed with: this process's, plus
 * the one on its way out while a rotation is in flight.
 */
const verificationKeys: SigningKey[] = config.desktopTokens.previous
  ? [config.desktopTokens.current, config.desktopTokens.previous]
  : [config.desktopTokens.current];

/** The header this module writes, and the one field it reads back. */
interface TokenHeader {
  alg: string;
  typ: string;
  /** Names the signing key. Absent on tokens minted before the keys were versioned. */
  kid?: string;
}

/** The claims, spelled the way the JWT registers spell them. */
interface TokenPayload {
  sub: string; // deviceId
  uid: string; // userId
  exp: number; // unix seconds
  iat: number;
}

/** What a token asserts, once its signature has been checked. */
export interface AccessTokenClaims {
  deviceId: string;
  userId: string;
  /** Unix seconds. Whether that has passed is the caller's to decide. */
  expiresAt: number;
}

function base64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function sign(key: SigningKey, data: string): string {
  return base64urlEncode(createHmac("sha256", key.secret).update(data).digest());
}

/** Mint an access token for a device, signed with this process's current key. */
export function issueAccessToken(
  deviceId: string,
  userId: string
): { accessToken: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  const header: TokenHeader = { alg: "HS256", typ: "JWT", kid: signingKey.id };
  const payload: TokenPayload = {
    sub: deviceId,
    uid: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  };

  const data = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(
    JSON.stringify(payload)
  )}`;
  return { accessToken: `${data}.${sign(signingKey, data)}`, expiresAt };
}

/**
 * What a presented token claims, or null if this deployment did not sign it.
 *
 * Expiry is deliberately not checked here: an expired token and an unsigned one
 * are two different answers to the client, and the caller is what tells them
 * apart.
 */
export function verifyAccessToken(token: string): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const data = `${parts[0]}.${parts[1]}`;
  if (!keysNamedBy(parts[0]).some((key) => signatureMatches(key, data, parts[2]))) return null;

  const payload = readPayload(parts[1]);
  if (!payload) return null;

  return { deviceId: payload.sub, userId: payload.uid, expiresAt: payload.exp };
}

/**
 * The keys a token's header points at. A `kid` names exactly one, so an id this
 * deployment does not hold leaves nothing to check the signature against. A
 * token carrying no `kid` predates the versioning and is checked against every
 * key it could have come from; those disappear within one token lifetime of the
 * deploy that introduced this.
 */
function keysNamedBy(encodedHeader: string): SigningKey[] {
  let header: unknown;
  try {
    header = JSON.parse(base64urlDecode(encodedHeader).toString());
  } catch {
    return [];
  }

  const kid = (header as TokenHeader | null)?.kid;
  if (typeof kid !== "string") return verificationKeys;
  return verificationKeys.filter((key) => key.id === kid);
}

/** Constant-time comparison: returning at the first differing byte leaks where it was. */
function signatureMatches(key: SigningKey, data: string, signature: string): boolean {
  const expected = sign(key, data);
  if (expected.length !== signature.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * The claims segment, or null when it is not the shape this module writes. Only
 * a holder of a signing key can get this far, so the check is not a defence — it
 * is what keeps a malformed token an authentication failure rather than a crash
 * in the middleware reading the claims.
 */
function readPayload(segment: string): TokenPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecode(segment).toString());
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { sub, uid, exp } = parsed as Record<string, unknown>;
  if (typeof sub !== "string" || typeof uid !== "string" || typeof exp !== "number") return null;

  return parsed as TokenPayload;
}
