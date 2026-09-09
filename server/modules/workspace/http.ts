import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isAuthenticated, getUserId } from "../../auth";
import {
  canManageWebhookEndpoints,
  createWebhookEndpoint,
  disableWebhookEndpoint,
  enableWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookEndpoints,
  rotateWebhookEndpointSecret,
  UnknownWebhookEventTypeError,
  WebhookEndpointNotFoundError,
} from "./webhookEndpoints";
import {
  InvalidActiveWorkspaceError,
  listMemberships,
  setActiveWorkspace,
} from "./activeWorkspace";

const createBody = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.string()).min(1),
});

function notFound(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown) {
  if (error instanceof WebhookEndpointNotFoundError) {
    res.status(404).json({ message: error.message });
    return true;
  }
  return false;
}

/**
 * Web BFF for Webhook Endpoints. Session cookies only. Owner or Administrator
 * Workspace Role. `{ message }` errors, matching today's `/api/*`.
 */
export function registerWebhookEndpointRoutes(app: Express): void {
  const requireManager: RequestHandler = async (_req, res, next) => {
    if (!(await canManageWebhookEndpoints())) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };

  app.post("/api/webhook-endpoints", isAuthenticated, requireManager, async (req, res) => {
    try {
      const body = createBody.parse(req.body);
      const created = await createWebhookEndpoint(body);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid request" });
      }
      if (error instanceof UnknownWebhookEventTypeError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }
  });

  app.get("/api/webhook-endpoints", isAuthenticated, requireManager, async (_req, res) => {
    res.json(await listWebhookEndpoints());
  });

  app.get("/api/webhook-endpoints/:id", isAuthenticated, requireManager, async (req, res) => {
    try {
      res.json(await getWebhookEndpoint(req.params.id));
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });

  app.post("/api/webhook-endpoints/:id/disable", isAuthenticated, requireManager, async (req, res) => {
    try {
      await disableWebhookEndpoint(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });

  app.post("/api/webhook-endpoints/:id/enable", isAuthenticated, requireManager, async (req, res) => {
    try {
      await enableWebhookEndpoint(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });

  app.post("/api/webhook-endpoints/:id/rotate", isAuthenticated, requireManager, async (req, res) => {
    try {
      res.json(await rotateWebhookEndpointSecret(req.params.id));
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });
}

/**
 * User-global Membership list and Active Workspace preference (#183).
 * Session cookies only. Errors stay `{ message }`.
 */
export function registerActiveWorkspaceRoutes(app: Express): void {
  app.get("/api/memberships", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    res.json(await listMemberships(userId));
  });

  app.put("/api/memberships/active", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const parsed = z.object({ workspaceId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }
    try {
      res.json(await setActiveWorkspace(userId, parsed.data.workspaceId));
    } catch (error) {
      if (error instanceof InvalidActiveWorkspaceError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      throw error;
    }
  });
}
