/**
 * What DocuFlow reads off a Clerk session (#300, ADR-0007).
 *
 * Clerk owns the factor. These claims are the authorization decision: a
 * verified second factor is `fva`'s second age (minutes, `-1` when absent) or
 * `twoFactorEnabled`. Platform Staff tokens carry `pla: "staff"` unless they
 * were verified by the dedicated staff instance, which the caller treats as
 * the pool itself.
 */

export function secondFactorVerified(claims: {
  fva?: unknown;
  twoFactorEnabled?: unknown;
}): boolean {
  if (claims.twoFactorEnabled === true) return true;
  if (!Array.isArray(claims.fva) || claims.fva.length < 2) return false;
  const age = claims.fva[1];
  return typeof age === "number" && Number.isFinite(age) && age >= 0;
}

export function isPlatformStaffToken(claims: { pla?: unknown }): boolean {
  return claims.pla === "staff";
}

export const SUPPORT_GRANT_DEFAULT_HOURS = 24;
export const SUPPORT_GRANT_MAX_HOURS = 24 * 7;

export class GrantDurationError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("A Support Access Grant lasts 24 hours by default and 7 days at most");
    this.name = "GrantDurationError";
  }
}

/** Default 24 hours. Longer than 7 days is refused. */
export function grantExpiresAt(now: Date, hours: number | undefined): Date {
  const span = hours ?? SUPPORT_GRANT_DEFAULT_HOURS;
  if (!Number.isInteger(span) || span < 1 || span > SUPPORT_GRANT_MAX_HOURS) {
    throw new GrantDurationError();
  }
  return new Date(now.getTime() + span * 60 * 60 * 1000);
}
