import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer, type Server } from "http";
import { installAsyncRoutes } from "./asyncRoutes";
import { buildIdentity, PROCESS_STARTED_AT } from "./buildInfo";
import { logError, logHttpRequest } from "./logger";
import { registerRoutes } from "./routes";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Assemble the Express application: security headers, rate limits, body
 * parsing, request logging, API routes, and the JSON error handler — in the
 * exact order production has always used. Boot-time migrations, static/Vite
 * serving, and listening remain the entry point's job (server/index.ts); the
 * test harness boots this app in-process instead.
 *
 * `stopBackgroundJobs` halts the periodic dispatchers the routes start. The
 * entry point never calls it — they run as long as the process does — but the
 * test harness must, so they cannot outlive the run that started them.
 */
export async function createApp(): Promise<{
  app: express.Express;
  httpServer: Server;
  stopBackgroundJobs: () => void;
}> {
  // Before any route: an async handler's rejection must reach the error handler.
  installAsyncRoutes();
  const app = express();
  app.set("trust proxy", 1);
  const httpServer = createServer(app);

  // ─── Security headers ───
  app.use(
    helmet({
      contentSecurityPolicy: false, // Vite dev server and inline scripts need this off
      crossOriginEmbedderPolicy: false, // Allow embedding external resources (GCS images, etc.)
    })
  );

  // ─── Rate limiting ───
  // Global: 120 requests per minute per IP (generous for SPA polling + API calls)
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later" },
    skip: (req) => {
      const path = req.originalUrl.split("?")[0];
      if (path === "/api/v1" || path.startsWith("/api/v1/")) return true;
      // A 429 here is painted as "sign-in is not configured".
      if (path === "/api/auth/config") return true;
      return false;
    },
    // TODO [PLACEHOLDER]: Tune these values after observing real traffic patterns.
    // Consider per-user rate limiting (keyed on session userId) for Desktop Agent.
  });
  // Clerk + SPA polling + HMR burn 120/min from localhost within seconds.
  // Test and production still enforce it.
  if (process.env.NODE_ENV !== "development") {
    app.use("/api/", globalLimiter);
  }

  // Stricter limit on auth endpoints to prevent brute force
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message: "Too many login attempts, please try again later" },
  });
  app.use("/api/login", authLimiter);
  app.use("/api/register", authLimiter);

  // Screenshot upload endpoints: tighter limit (10 uploads/min per IP)
  const agentScreenshotLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message: "Screenshot upload rate limit exceeded" },
  });
  app.use("/api/agent/screenshots/", agentScreenshotLimiter);

  // ─── Health check (before auth, unauthenticated) ───
  // Carries the build and the process start alongside liveness (#229): a stale
  // server is otherwise indistinguishable from a current one here, and that is
  // how the Phase 8 run lost its longest stretch.
  app.get("/health", (_req, res) => {
    const build = buildIdentity();
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      commit: build.commit,
      commitSource: build.source,
      startedAt: PROCESS_STARTED_AT.toISOString(),
    });
  });

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        try {
          req.rawBody = buf;
        } catch (e) {
          // Ignore rawBody errors
        }
      },
      limit: "10mb",
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "10mb" }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    // Through the structured logger since #26, so the request line carries the
    // trace id of the request it describes and reaches the same place every
    // other log record does. The response body it used to append is printed
    // outside production only — see logHttpRequest.
    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      logHttpRequest(
        {
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        capturedJsonResponse
      );
    });

    next();
  });

  const { stopBackgroundJobs } = await registerRoutes(httpServer, app);

  app.use(apiErrorHandler);

  return { app, httpServer, stopBackgroundJobs };
}

/**
 * The last word on an error. A 4xx keeps its message (body-parser's 400 and
 * 413 say what was wrong); a 5xx says nothing of its cause. After the response
 * has started there is nothing to answer: an unfinished one is cut, so the
 * client cannot mistake it for complete.
 */
export function apiErrorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const raw = err?.status ?? err?.statusCode;
  const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
  logError("unhandled-server-error", err, { status, path: req.path, method: req.method });
  if (res.headersSent) {
    if (!res.writableEnded) res.destroy();
    return;
  }
  const message = status < 500 && typeof err?.message === "string" && err.message ? err.message : "Internal Server Error";
  res.status(status).json({ message });
}
