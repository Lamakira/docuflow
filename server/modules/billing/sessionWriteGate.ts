import type { Request, Response, NextFunction } from "express";
import { ReadOnlyWorkspaceError, SeatExhaustedError, assertOperationalWrite } from "./writeClassification";
import { PlanFeatureNotIncludedError, assertRequestEntitled } from "./featureGate";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const BILLING_RECOVERY_PATHS = new Set([
  "/api/billing/cancel-at-period-end",
  "/api/billing/checkout",
  "/api/billing/payment-method",
  "/api/billing/plan",
]);

export function isBillingRecoveryPath(path: string): boolean {
  return BILLING_RECOVERY_PATHS.has(path);
}

/**
 * Session/agent adapter for the central write-classification check.
 * The Plan's feature Entitlements come first: an area the Plan leaves out is
 * refused with the Plan that includes it, reads of kept data excepted.
 * Billing-recovery paths remain; GET/HEAD/OPTIONS are view.
 */
export async function gateSessionWrite(req: Request, res: Response, next: NextFunction): Promise<void> {
  const path = (req.path || req.originalUrl.split("?")[0]) as string;
  try {
    await assertRequestEntitled(req.method, path);
    if (MUTATING.has(req.method) && !isBillingRecoveryPath(path)) {
      await assertOperationalWrite();
    }
    next();
  } catch (error) {
    if (error instanceof PlanFeatureNotIncludedError) {
      res.status(error.statusCode).json(error.body());
      return;
    }
    if (error instanceof ReadOnlyWorkspaceError || error instanceof SeatExhaustedError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    next(error);
  }
}
