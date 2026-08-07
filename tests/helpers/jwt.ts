import { createHmac } from "crypto";

/**
 * The harness's own HS256, written out rather than imported from
 * `server/desktopTokens.ts`: a suite that signed with the code under test could
 * not tell a correct implementation from a merely self-consistent one. One copy
 * of it, so the oracle stays a single thing to check by eye.
 *
 * Header and claims are passed whole, which is what lets a suite mint shapes the
 * server no longer writes — an expired token, or one naming no key at all.
 */

export function base64url(value: string | Buffer): string {
  return (typeof value === "string" ? Buffer.from(value) : value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** One base64url segment, back to the object it was written from. */
export function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
  );
}

/** What a token's header says — which key signed it, and how. Unverified. */
export function headerOf(token: string): Record<string, unknown> {
  return decodeSegment(token.split(".")[0]);
}

/** A signed token: the two encoded segments, then the HMAC over both. */
export function signJwt(secret: string, header: object, payload: object): string {
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  return `${data}.${base64url(createHmac("sha256", secret).update(data).digest())}`;
}
