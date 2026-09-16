import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import { gateSessionWrite } from "./modules/billing/sessionWriteGate";
import {
  bearerToken,
  identityProvider,
  isWebSessionPath,
  userIdFromIdentitySession,
} from "./modules/identity";
import {
  ArchivedMembershipError,
  NoActiveMembershipError,
  contextFromUser,
  runWithWorkspaceContext,
} from "./workspaceContext";

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);

  // Part of the session layer, so every route sees an IdentityProvider session
  // the same way — `/api/auth/user` included, which reads `getUserId` without
  // going through `isAuthenticated`.
  app.use(identitySession);
}

/**
 * The IdentityProvider session (#111, ADR-0007, ADR-0017). An
 * `Authorization: Bearer` provider session token is resolved to the `users.id`
 * it is linked to and left on the request. That is the only web way in: Clerk
 * owns the credential, and DocuFlow builds `WorkspaceContext` from the
 * Membership.
 *
 * The Device and Service Account bearer paths are skipped: their header already
 * carries a token of their own, and this phase does not touch them.
 */
export const identitySession: RequestHandler = async (req, res, next) => {
  if (!isWebSessionPath(req.path)) return next();
  const token = bearerToken(req.headers.authorization);
  if (!token) return next();
  try {
    const userId = await userIdFromIdentitySession({
      provider: identityProvider,
      persistence: storage,
      token,
    });
    (req as any).identitySessionUserId = userId;
    if (userId) await recordProviderSessionLogin(userId);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Keep `users.last_login_at` moving now that no login route writes it (#110).
 * Clerk owns the sign-in, so the first request of a session is the closest
 * thing to a login moment this side can see; the write itself is conditional
 * on an hour having passed, so most calls touch no row.
 *
 * A failed stamp is logged and swallowed: an admin list column going stale is
 * not a reason to refuse an otherwise valid session.
 */
async function recordProviderSessionLogin(userId: string): Promise<void> {
  try {
    await storage.touchUserLastLogin(userId);
  } catch (error) {
    console.error("Failed to record IdentityProvider session login:", error);
  }
}

/**
 * An identity session, with no Workspace entered (#217). The routes a User who
 * belongs nowhere must still reach — creating their first Workspace (Flow 1)
 * and deleting their account (Flow 10) — cannot go through `isAuthenticated`,
 * because that binds the request to a Membership they do not have. Everything
 * else stays on `isAuthenticated`: this is not a way around authorization, it
 * is the absence of a Workspace to authorize against.
 */
export const isIdentified: RequestHandler = (req, res, next) => {
  if ((req as any).identitySessionUserId) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if ((req as any).identitySessionUserId) {
    return enterWorkspace(req, res, next);
  }
  return res.status(401).json({ message: "Unauthorized" });
};

/**
 * Bind the rest of this request to the User's active Membership. Archived
 * Memberships and Users with none cannot enter the Workspace.
 */
async function enterWorkspace(req: any, res: any, next: (err?: unknown) => void) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const ctx = await contextFromUser(userId);
    return runWithWorkspaceContext(ctx, () => gateSessionWrite(req, res, next));
  } catch (error) {
    if (error instanceof ArchivedMembershipError || error instanceof NoActiveMembershipError) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next(error);
  }
}

export function getUserId(req: any): string | undefined {
  return req.identitySessionUserId;
}
