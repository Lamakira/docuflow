import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer, type Server } from "http";
import { logError } from "./logger";
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
    // TODO [PLACEHOLDER]: Tune these values after observing real traffic patterns.
    // Consider per-user rate limiting (keyed on session userId) for Desktop Agent.
  });
  app.use("/api/", globalLimiter);

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
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
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

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        log(logLine);
      }
    });

    next();
  });

  const { stopBackgroundJobs } = await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    logError("unhandled-server-error", err, {
      status,
      path: _req.path,
      method: _req.method,
    });
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  return { app, httpServer, stopBackgroundJobs };
}
