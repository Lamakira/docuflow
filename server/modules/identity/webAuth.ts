/**
 * Web authentication after Clerk is the only path (#111, #162, ADR-0007,
 * ADR-0017).
 *
 * DocuFlow no longer verifies a password, mints a session of its own, or
 * impersonates the Owner through `X-API-Key`. The browser presents an
 * IdentityProvider session; `identitySession` resolves it to a `users.id`, and
 * authorization is untouched — the Membership still decides what that User may
 * do, and Clerk cannot grant Workspace authority.
 *
 * `GET /api/login`, `/api/callback`, `/api/logout`, and `POST /api/auth/logout`
 * are unmounted. A leftover bookmark is a 404, not a kept handler.
 * `POST /api/auth/login` and `/api/auth/register` are gone with the rest of the
 * password web path.
 *
 * Credentials live at the IdentityProvider. Admin reset sends a password-set
 * invite (#160) and does not write a digest. The desktop agent's
 * `POST /api/agent/auth/login` is 410 (#159); Devices pair from a signed-in
 * web session. Neither leftover is a web session.
 */

import type { RequestHandler } from "express";
import type { WebAuthConfig } from "@shared/webAuth";
import { config, webSignInAvailable } from "../../config";

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
