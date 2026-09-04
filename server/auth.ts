import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { config } from "./config";
import { gateSessionWrite } from "./modules/billing/sessionWriteGate";
import {
  bearerToken,
  identityProvider,
  isDrainablePath,
  userIdFromIdentitySession,
  webPasswordAuthRetired,
} from "./modules/identity";
import {
  ArchivedMembershipError,
  NoActiveMembershipError,
  contextFromUser,
  runWithWorkspaceContext,
} from "./workspaceContext";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 7 days
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: config.database.connectionString,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      maxAge: sessionTtl,
      sameSite: "lax" as const,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  // Part of the session layer, so every route sees an IdentityProvider session
  // the same way — `/api/auth/user` included, which reads `getUserId` without
  // going through `isAuthenticated`.
  app.use(identitySession);

  // Replit OIDC used to live here. The routes stay mounted so a leftover
  // bookmark or the previous SPA's "Continue with Replit" button is told what
  // happened rather than falling through to the SPA shell.
  app.get("/api/login", webPasswordAuthRetired);
  app.get("/api/callback", webPasswordAuthRetired);
  app.get("/api/logout", webPasswordAuthRetired);
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
  if (!isDrainablePath(req.path)) return next();
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
