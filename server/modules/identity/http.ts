import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../../auth";
import {
  createServiceAccount,
  listServiceAccounts,
  revokeServiceAccount,
  rotateServiceAccountSecret,
  ServiceAccountNotFoundError,
  ServiceAccountRevokedError,
  UnknownCapabilityError,
  updateServiceAccount,
} from "./serviceAccounts";
import { requireAdministration } from "../../workspaceRole";

const name = z
  .string({ required_error: "Give the Service Account a name" })
  .trim()
  .min(1, "Give the Service Account a name")
  .max(100, "A Service Account name is at most 100 characters");

// A Service Account without a Capability can do nothing (F109).
const capabilityIds = z
  .array(z.string(), { required_error: "Choose at least one Capability" })
  .min(1, "Choose at least one Capability");

const createBody = z.object({ name, capabilityIds });

const updateBody = z
  .object({ name: name.optional(), capabilityIds: capabilityIds.optional() })
  .refine((body) => body.name !== undefined || body.capabilityIds !== undefined, {
    message: "Nothing to change",
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
  app.post("/api/service-accounts", isAuthenticated, requireAdministration, async (req, res) => {
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

  app.get("/api/service-accounts", isAuthenticated, requireAdministration, async (_req, res) => {
    res.json(await listServiceAccounts());
  });

  app.patch("/api/service-accounts/:id", isAuthenticated, requireAdministration, async (req, res) => {
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }
    try {
      res.json(await updateServiceAccount(req.params.id, parsed.data));
    } catch (error) {
      if (notFound(res, error)) return;
      if (error instanceof ServiceAccountRevokedError) {
        return res.status(409).json({ message: error.message });
      }
      if (error instanceof UnknownCapabilityError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }
  });

  app.post("/api/service-accounts/:id/revoke", isAuthenticated, requireAdministration, async (req, res) => {
    try {
      await revokeServiceAccount(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });

  app.post("/api/service-accounts/:id/rotate", isAuthenticated, requireAdministration, async (req, res) => {
    try {
      res.json(await rotateServiceAccountSecret(req.params.id));
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });
}
