import type { Express } from "express";
import { isAuthenticated, getUserId } from "../../auth";
import { cancelAtPeriodEnd, getBillingProjection, InvalidBillingTransitionError } from "./index";

/**
 * Web BFF billing recovery. Session cookies. `{ message }` errors.
 * Operational writes are denied by write-classification; these routes remain.
 * Period end is owned by the billing pin, not the request body.
 */
export function registerBillingRoutes(app: Express): void {
  app.get("/api/billing/subscription", isAuthenticated, async (_req, res) => {
    res.json(await getBillingProjection());
  });

  app.post("/api/billing/cancel-at-period-end", isAuthenticated, async (req, res) => {
    try {
      const actor = { kind: "user" as const, id: getUserId(req) };
      res.json(await cancelAtPeriodEnd(actor));
    } catch (error) {
      if (error instanceof InvalidBillingTransitionError) {
        res.status(400).json({ message: error.message });
        return;
      }
      throw error;
    }
  });
}
