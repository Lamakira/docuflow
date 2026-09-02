import type { Express } from "express";
import { isAuthenticated, getUserId } from "../../auth";
import {
  BillingProviderClosedError,
  BillingWebhookSignatureError,
  UnknownBillingWebhookError,
  billingProvider,
  cancelAtPeriodEnd,
  createBillingJobsPort,
  getBillingProjection,
  ingestBillingWebhook,
  InvalidBillingTransitionError,
} from "./index";

function stripeSignature(req: { headers: Record<string, unknown> }): string {
  const header = req.headers["stripe-signature"];
  return typeof header === "string" ? header : Array.isArray(header) ? (header[0] ?? "") : "";
}

function webhookPayload(req: { rawBody?: unknown; body?: unknown }): string {
  const raw = req.rawBody;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (typeof raw === "string") return raw;
  return typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
}

/**
 * Web BFF billing recovery plus the unauthenticated Stripe webhook inbox.
 * Session cookies on recovery. `{ message }` errors. Webhook HTTP returns
 * without applying Entitlements (ADR-0013).
 */
export function registerBillingRoutes(app: Express): void {
  app.post("/api/billing/webhooks", async (req, res) => {
    try {
      await ingestBillingWebhook({
        provider: billingProvider,
        jobs: createBillingJobsPort(),
        payload: webhookPayload(req),
        signature: stripeSignature(req),
      });
      res.status(200).json({ received: true });
    } catch (error) {
      if (
        error instanceof BillingWebhookSignatureError ||
        error instanceof UnknownBillingWebhookError ||
        error instanceof BillingProviderClosedError
      ) {
        res.status(400).json({ message: error.message });
        return;
      }
      throw error;
    }
  });

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
