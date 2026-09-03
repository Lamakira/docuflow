import bcrypt from "bcrypt";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import memoize from "memoizee";
import { storage } from "./storage";
import { config, identityDualAuthEnabled, mcpApiKey } from "./config";
import { gateSessionWrite } from "./modules/billing/sessionWriteGate";
import {
  bearerToken,
  identityProvider,
  isDrainablePath,
  userIdFromIdentitySession,
} from "./modules/identity";
import {
  ArchivedMembershipError,
  NoActiveMembershipError,
  contextFromUser,
  runWithWorkspaceContext,
} from "./workspaceContext";

const SALT_ROUNDS = 12;

// Memoized OIDC configuration for Replit Auth
const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(config.replitAuth.issuerUrl),
      config.replitAuth.clientId as string
    );
  },
  { maxAge: 3600 * 1000 }
);

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

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertReplitUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  // Part of the session layer, so every route sees an IdentityProvider session
  // the same way it sees a legacy one — `/api/auth/user` included, which reads
  // `getUserId` without going through `isAuthenticated`.
  app.use(dualAuthSession);

  const registeredStrategies = new Set<string>();

  const ensureStrategy = async (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const oidcConfig = await getOidcConfig();
      const verify: VerifyFunction = async (
        tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
        verified: passport.AuthenticateCallback
      ) => {
        const user = {};
        updateUserSession(user, tokens);
        await upsertReplitUser(tokens.claims());
        verified(null, user);
      };
      const strategy = new Strategy(
        {
          name: strategyName,
          config: oidcConfig,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  // Replit OIDC login route
  app.get("/api/login", async (req, res, next) => {
    try {
      await ensureStrategy(req.hostname);
      passport.authenticate(`replitauth:${req.hostname}`, {
        prompt: "login consent",
        scope: ["openid", "email", "profile", "offline_access"],
      })(req, res, next);
    } catch (error) {
      console.error("OIDC login error:", error);
      res.redirect("/auth?error=oidc_failed");
    }
  });

  // Replit OIDC callback route
  app.get("/api/callback", async (req, res, next) => {
    console.log("OIDC callback received");
    try {
      await ensureStrategy(req.hostname);
      passport.authenticate(`replitauth:${req.hostname}`, {
        successReturnToOrRedirect: "/",
        failureRedirect: "/auth",
      })(req, res, (err: any) => {
        if (err) {
          console.error("Passport auth error:", err);
          return res.redirect("/auth?error=auth_failed");
        }
        next();
      });
    } catch (error) {
      console.error("OIDC callback error:", error);
      res.redirect("/auth?error=oidc_failed");
    }
  });

  // Replit OIDC logout route
  app.get("/api/logout", async (req, res) => {
    try {
      const oidcConfig = await getOidcConfig();
      req.logout(() => {
        res.redirect(
          client.buildEndSessionUrl(oidcConfig, {
            client_id: config.replitAuth.clientId as string,
            post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
          }).href
        );
      });
    } catch (error) {
      console.error("OIDC logout error:", error);
      req.logout(() => {
        res.redirect("/auth");
      });
    }
  });
}

/**
 * The IdentityProvider session (#109 as the drain, #110 as the web's only way
 * in). While the flag is on, an `Authorization: Bearer` provider session token
 * is resolved to the `users.id` it is linked to and left on the request,
 * alongside — never instead of — whatever legacy session is present. Flag off,
 * this is a single boolean and a `next()`, so the rollback is a flag flip.
 *
 * Since #110 retired password sign-in, flag-off also means no browser can sign
 * in at all: the rollback of the cutover is that flip plus redeploying the
 * previous image, which is what puts `/api/auth/login` back. #111 removes the
 * flag and leaves this path unconditional.
 *
 * The Device and Service Account bearer paths are skipped: their header already
 * carries a token of their own, and this phase does not touch them.
 */
export const dualAuthSession: RequestHandler = async (req, res, next) => {
  if (!identityDualAuthEnabled()) return next();
  if (!isDrainablePath(req.path)) return next();
  // A legacy session already answers `getUserId`, and this is behind it, so
  // resolving the token would spend a provider round trip on nothing.
  if (getUserId(req)) return next();
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
 * Keep `users.last_login_at` moving now that the retired login route is no
 * longer writing it (#110). Clerk owns the sign-in, so the first request of a
 * session is the closest thing to a login moment this side can see; the write
 * itself is conditional on an hour having passed, so most calls touch no row.
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
  const apiKey = req.headers["x-api-key"] as string | undefined;
  const expectedKey = mcpApiKey();
  if (apiKey && expectedKey && apiKey === expectedKey) {
    const adminUser = await storage.getMainAdmin();
    if (adminUser) {
      (req.session as any).userId = adminUser.id;
      return enterWorkspace(req, res, next);
    }
  }

  if (req.session && (req.session as any).userId) {
    return enterWorkspace(req, res, next);
  }

  const user = req.user as any;
  if (req.isAuthenticated?.() && user?.claims?.sub) {
    const now = Math.floor(Date.now() / 1000);
    if (user.expires_at && now > user.expires_at) {
      const refreshToken = user.refresh_token;
      if (!refreshToken) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      try {
        const config = await getOidcConfig();
        const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
        user.claims = tokenResponse.claims();
        user.access_token = tokenResponse.access_token;
        user.refresh_token = tokenResponse.refresh_token;
        user.expires_at = user.claims?.exp;
      } catch (error) {
        return res.status(401).json({ message: "Unauthorized" });
      }
    }
    return enterWorkspace(req, res, next);
  }

  // Last, so the drain adds a way in and reorders nothing: a User who still has
  // a legacy session enters through it exactly as they did before the flag.
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
  // Check email/password session first
  if (req.session?.userId) {
    return req.session.userId;
  }
  // Check Replit OIDC auth
  if (req.user?.claims?.sub) {
    return req.user.claims.sub;
  }
  // Check the IdentityProvider session the dual-auth drain resolved (#109)
  if (req.identitySessionUserId) {
    return req.identitySessionUserId;
  }
  return undefined;
}
