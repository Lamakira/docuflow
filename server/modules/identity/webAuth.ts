/**
 * Web authentication after Clerk is the only path (#111, ADR-0007, ADR-0017).
 *
 * DocuFlow no longer verifies a password, mints a session of its own, or
 * impersonates the Owner through `X-API-Key`. The browser presents an
 * IdentityProvider session; `identitySession` resolves it to a `users.id`, and
 * authorization is untouched — the Membership still decides what that User may
 * do, and Clerk cannot grant Workspace authority.
 *
 * `GET /api/login`, `/api/callback`, and `/api/logout` stay mounted rather than
 * being deleted, so a leftover Replit OIDC bookmark is told what happened
 * instead of getting the SPA shell. `POST /api/auth/login` and
 * `/api/auth/register` are gone with the rest of the password web path.
 *
 * One password surface deliberately survives until a later ticket: the admin
 * reset that writes `users.password`. The desktop agent's
 * `POST /api/agent/auth/login` is 410 (#159); Devices pair from a signed-in
 * web session. Neither leftover is a web session.
 */

import type { RequestHandler } from "express";
import type { WebAuthConfig } from "@shared/webAuth";
import { config, webSignInAvailable } from "../../config";

export const WEB_PASSWORD_AUTH_RETIRED =
  "This sign-in path has moved to Clerk. Sign in from the DocuFlow sign-in page.";

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
