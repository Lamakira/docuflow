/**
 * Web authentication after the Clerk cutover (#110, ADR-0007, ADR-0017).
 *
 * The drain (#109) gave a User two ways into the same Workspace. This is the
 * ticket that takes the first one away: DocuFlow no longer verifies a password
 * or mints a session of its own for the browser, so the IdentityProvider session
 * resolved by `dualAuthSession` is the only credential the web presents.
 * Authorization is untouched — the Membership still decides what that User may
 * do, and Clerk cannot grant Workspace authority.
 *
 * `POST /api/auth/login` and `POST /api/auth/register` stay mounted rather than
 * being deleted, so a browser still running the previous SPA build is told what
 * happened instead of getting a 404. They are removed with the rest of the
 * legacy paths in #111.
 *
 * Two password surfaces deliberately survive this ticket: the desktop agent's
 * `POST /api/agent/auth/login`, which #105 leaves on its own token path, and the
 * admin reset that writes `users.password`. Neither is a web session.
 */

import type { RequestHandler } from "express";
import type { WebAuthConfig } from "@shared/webAuth";
import { config, webSignInAvailable } from "../../config";

export const WEB_PASSWORD_AUTH_RETIRED =
  "Password sign-in has moved to Clerk. Sign in from the DocuFlow sign-in page.";

/**
 * Answered before the body is read. Validating first would let a caller tell a
 * known address from an unknown one on an endpoint that no longer authenticates
 * anyone, and there is nothing a well-formed payload could make this route do.
 */
export const webPasswordAuthRetired: RequestHandler = (_req, res) => {
  res.status(410).json({ message: WEB_PASSWORD_AUTH_RETIRED });
};

/**
 * Served at runtime rather than baked into the bundle: one image is built and
 * deployed to every environment (ADR-0018), so the key a given deployment signs
 * in against cannot be a build-time constant.
 *
 * `enabled` is `webSignInAvailable()` rather than a second opinion about it, so
 * this and the boot line cannot disagree.
 */
export function webAuthConfig(): WebAuthConfig {
  return {
    publishableKey: config.identity.publishableKey ?? null,
    enabled: webSignInAvailable(),
  };
}

/** Public: the SPA has to read this before anyone can sign in. */
export const webAuthConfigRoute: RequestHandler = (_req, res) => {
  res.json(webAuthConfig());
};
