import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isAuthenticated } from "../../auth";
import {
  canManageServiceAccounts,
  createServiceAccount,
  listServiceAccounts,
  revokeServiceAccount,
  rotateServiceAccountSecret,
  ServiceAccountNotFoundError,
  UnknownCapabilityError,
} from "./serviceAccounts";

const createBody = z.object({
  name: z.string().min(1),
  capabilityIds: z.array(z.string()).optional(),
});

function notFound(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown) {
  if (error instanceof ServiceAccountNotFoundError) {
    res.status(404).json({ message: error.message });
    return true;
  }
  return false;
}

/**
 * Web BFF for Service Accounts. Session cookies only. Owner or Administrator
 * Workspace Role. `{ message }` errors, matching today's `/api/*`.
 */
export function registerServiceAccountRoutes(app: Express): void {
  const requireManager: RequestHandler = async (_req, res, next) => {
    if (!(await canManageServiceAccounts())) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };

  app.post("/api/service-accounts", isAuthenticated, requireManager, async (req, res) => {
    try {
      const body = createBody.parse(req.body);
      const created = await createServiceAccount(body);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid request" });
      }
      if (error instanceof UnknownCapabilityError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }
  });

  app.get("/api/service-accounts", isAuthenticated, requireManager, async (_req, res) => {
    res.json(await listServiceAccounts());
  });

  app.post("/api/service-accounts/:id/revoke", isAuthenticated, requireManager, async (req, res) => {
    try {
      await revokeServiceAccount(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });

  app.post("/api/service-accounts/:id/rotate", isAuthenticated, requireManager, async (req, res) => {
    try {
      res.json(await rotateServiceAccountSecret(req.params.id));
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });
}
