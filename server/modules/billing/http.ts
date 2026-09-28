import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated, getUserId } from "../../auth";
import {
  BillingCurrencyUnavailableError,
  BillingProviderClosedError,
  BillingProviderError,
  BillingWebhookSignatureError,
  FEATURE_KEYS,
  PLAN_LABEL,
  PLAN_LADDER,
  PLAN_REGISTRY,
  PLAN_REGISTRY_VERSION,
  PRICED_PLAN_KEYS,
  changePlan,
  minimumPlanFor,
  planStanding,
  readPlanIntent,
  InvalidBillingTransitionError,
  InvalidCheckoutError,
  PaymentMethodUpdateUnavailableError,
  SeatCapacityFloorError,
  SeatChangeUnavailableError,
  SeededWorkspaceCheckoutError,
  UnknownBillingWebhookError,
  billingProvider,
  cancelAtPeriodEnd,
  changeSeats,
  createBillingJobsPort,
  getSubscriptionStatus,
  ingestBillingWebhook,
  startCheckout,
  startPaymentMethodUpdate,
} from "./index";
import { requireAdministration } from "../../workspaceRole";

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

const pricedPlan = z.enum(PRICED_PLAN_KEYS, {
  errorMap: () => ({ message: "Choose Starter, Growth or Business." }),
});
const billingInterval = z.enum(["monthly", "annual"], {
  errorMap: () => ({ message: "Choose monthly or annual billing." }),
});

const checkoutBody = z.object({
  planKey: pricedPlan,
  interval: billingInterval,
  seatQuantity: z.number().int().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const planBody = z.object({
  planKey: pricedPlan,
  interval: billingInterval,
});

const seatsBody = z.object({
  seatQuantity: z.number().int().min(1),
});

const paymentMethodBody = z.object({
  returnUrl: z.string().url(),
});

function actorOf(req: Request) {
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
  if (error instanceof BillingCurrencyUnavailableError) {
    res.status(409).json({ message: error.message });
    return true;
  }
  if (error instanceof BillingProviderError) {
    res.status(502).json({ message: error.message });
    return true;
  }
  return false;
}

/**
 * Express 4 does not catch a rejected async handler: a rethrow inside one is an
 * unhandled rejection, and Node ends the process. Every billing route goes
 * through here, so a known refusal is a `{ message }` and anything else reaches
 * the app's error handler instead.
 */
function billingRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch((error: unknown) => {
      if (res.headersSent) return next(error);
      if (!sendBillingError(res, error)) next(error);
    });
  };
}

/** What the Workspace's Plan includes, for navigation and upgrade prompts. Any member may read it. */
async function entitlementSummary() {
  const { projection, entitlements } = await planStanding();
  const intent = await readPlanIntent();
  const plans = PLAN_REGISTRY[PLAN_REGISTRY_VERSION] ?? {};
  return {
    planKey: projection.planKey,
    planLabel: PLAN_LABEL[projection.planKey],
    registryVersion: projection.registryVersion,
    billingState: projection.billingState,
    billingInterval: projection.billingInterval,
    trialEndsAt: projection.trialEndsAt,
    intendedPlanKey: intent?.planKey ?? null,
    intendedInterval: intent?.interval ?? null,
    features: entitlements.features,
    screenshotProjectCapacity: entitlements.screenshotProjectCapacity,
    requiredPlan: Object.fromEntries(FEATURE_KEYS.map((feature) => [feature, minimumPlanFor(feature)])),
    plans: PLAN_LADDER.filter((planKey) => plans[planKey]).map((planKey) => ({
      planKey,
      label: PLAN_LABEL[planKey],
      features: plans[planKey]!.features,
      screenshotProjectCapacity: plans[planKey]!.screenshotProjectCapacity,
      priced: (PRICED_PLAN_KEYS as readonly string[]).includes(planKey),
    })),
  };
}

/**
 * Web BFF billing commands plus the unauthenticated Stripe webhook inbox.
 * IdentityProvider session. Owner or Administrator. `{ message }` errors. Webhook HTTP
 * returns without applying Entitlements (ADR-0013).
 */
export function registerBillingRoutes(app: Express): void {
  app.post(
    "/api/billing/webhooks",
    billingRoute(async (req, res) => {
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
    })
  );

  app.get(
    "/api/billing/subscription",
    isAuthenticated,
    requireAdministration,
    billingRoute(async (_req, res) => {
      res.json(await getSubscriptionStatus());
    })
  );

  app.post(
    "/api/billing/checkout",
    isAuthenticated,
    requireAdministration,
    billingRoute(async (req, res) => {
      const body = checkoutBody.parse(req.body);
      res.json(await startCheckout(body, actorOf(req), billingProvider));
    })
  );

  app.get(
    "/api/billing/entitlements",
    isAuthenticated,
    billingRoute(async (_req, res) => {
      res.json(await entitlementSummary());
    })
  );

  app.post(
    "/api/billing/plan",
    isAuthenticated,
    requireAdministration,
    billingRoute(async (req, res) => {
      const body = planBody.parse(req.body);
      res.json(await changePlan(body, actorOf(req), billingProvider));
    })
  );

  app.post(
    "/api/billing/seats",
    isAuthenticated,
    requireAdministration,
    billingRoute(async (req, res) => {
      const body = seatsBody.parse(req.body);
      res.json(await changeSeats(body.seatQuantity, actorOf(req), billingProvider));
    })
  );

  app.post(
    "/api/billing/payment-method",
    isAuthenticated,
    requireAdministration,
    billingRoute(async (req, res) => {
      const body = paymentMethodBody.parse(req.body);
      res.json(await startPaymentMethodUpdate(body, actorOf(req), billingProvider));
    })
  );

  app.post(
    "/api/billing/cancel-at-period-end",
    isAuthenticated,
    requireAdministration,
    billingRoute(async (req, res) => {
      res.json(await cancelAtPeriodEnd(actorOf(req)));
    })
  );
}
