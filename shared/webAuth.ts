/**
 * The contract of `GET /api/auth/config` (#110, ADR-0007).
 *
 * Shared because both ends have to agree on it: the server answers with this
 * shape, and the SPA decides from it whether to mount a sign-in box at all.
 */

export type WebAuthConfig = {
  /** Clerk's publishable key. Public by design; the secret never leaves the server. */
  publishableKey: string | null;
  /**
   * Whether a session minted against that key would be read. False means this
   * deployment cannot sign anyone in — a missing key at either end — and the
   * sign-in page says so rather than offering a box that cannot work.
   */
  enabled: boolean;
};
