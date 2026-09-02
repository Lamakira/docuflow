import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isAuthenticated, getUserId } from "../../auth";
import {
  BillingProviderClosedError,
  BillingWebhookSignatureError,
  InvalidBillingTransitionError,
  InvalidCheckoutError,
  PaymentMethodUpdateUnavailableError,
  SeatCapacityFloorError,
  SeatChangeUnavailableError,
  SeededWorkspaceCheckoutError,
  UnknownBillingWebhookError,
  billingProvider,
  cancelAtPeriodEnd,
  canManageBilling,
  changeSeats,
  createBillingJobsPort,
  getSubscriptionStatus,
  ingestBillingWebhook,
  startCheckout,
  startPaymentMethodUpdate,
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

const checkoutBody = z.object({
  planKey: z.enum(["pro"]),
  seatQuantity: z.number().int().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const seatsBody = z.object({
  seatQuantity: z.number().int().min(1),
});

const paymentMethodBody = z.object({
  returnUrl: z.string().url(),
});

function actorOf(req: { session?: unknown; user?: unknown }) {
  return { kind: "user" as const, id: getUserId(req) };
}

function sendBillingError(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  error: unknown
): boolean {
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: error.errors[0]?.message ?? "Invalid request" });
    return true;
  }
  if (
    error instanceof SeededWorkspaceCheckoutError ||
    error instanceof InvalidCheckoutError ||
    error instanceof PaymentMethodUpdateUnavailableError ||
    error instanceof SeatCapacityFloorError ||
    error instanceof SeatChangeUnavailableError ||
    error instanceof InvalidBillingTransitionError ||
    error instanceof BillingProviderClosedError
  ) {
    res.status(400).json({ message: error.message });
    return true;
  }
  return false;
}

/**
 * Web BFF billing commands plus the unauthenticated Stripe webhook inbox.
 * Session cookies. Owner or Administrator. `{ message }` errors. Webhook HTTP
 * returns without applying Entitlements (ADR-0013).
 */
export function registerBillingRoutes(app: Express): void {
  const requireManager: RequestHandler = async (_req, res, next) => {
    if (!(await canManageBilling())) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };

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

  app.get("/api/billing/subscription", isAuthenticated, requireManager, async (_req, res) => {
    res.json(await getSubscriptionStatus());
  });

  app.post("/api/billing/checkout", isAuthenticated, requireManager, async (req, res) => {
    try {
      const body = checkoutBody.parse(req.body);
      res.json(await startCheckout(body, actorOf(req), billingProvider));
    } catch (error) {
      if (!sendBillingError(res, error)) throw error;
    }
  });

  app.post("/api/billing/seats", isAuthenticated, requireManager, async (req, res) => {
    try {
      const body = seatsBody.parse(req.body);
      res.json(await changeSeats(body.seatQuantity, actorOf(req), billingProvider));
    } catch (error) {
      if (!sendBillingError(res, error)) throw error;
    }
  });

  app.post("/api/billing/payment-method", isAuthenticated, requireManager, async (req, res) => {
    try {
      const body = paymentMethodBody.parse(req.body);
      res.json(await startPaymentMethodUpdate(body, actorOf(req), billingProvider));
    } catch (error) {
      if (!sendBillingError(res, error)) throw error;
    }
  });

  app.post("/api/billing/cancel-at-period-end", isAuthenticated, requireManager, async (req, res) => {
    try {
      res.json(await cancelAtPeriodEnd(actorOf(req)));
    } catch (error) {
      if (!sendBillingError(res, error)) throw error;
    }
  });
}
