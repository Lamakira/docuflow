import type { Express } from "express";
import { z } from "zod";
import { getUserId, isAuthenticated } from "../../auth";
import {
  DeliveryPreferenceNotFoundError,
  getDeliveryPreference,
  putDeliveryPreference,
} from "./deliveryPreference";

const putBody = z.object({
  emailByCategory: z.record(z.boolean()),
});

/**
 * Delivery Preference BFF (#210). Session cookies. Scoped to Active Workspace.
 * Errors stay `{ message }`.
 */
export function registerDeliveryPreferenceRoutes(app: Express): void {
  app.get("/api/notifications/delivery-preferences", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    res.json({ emailByCategory: await getDeliveryPreference(userId) });
  });

  app.put("/api/notifications/delivery-preferences", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }
    try {
      res.json({ emailByCategory: await putDeliveryPreference(userId, parsed.data.emailByCategory) });
    } catch (error) {
      if (error instanceof DeliveryPreferenceNotFoundError) {
        return res.status(404).json({ message: error.message });
      }
      throw error;
    }
  });
}
