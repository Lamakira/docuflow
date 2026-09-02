import type { Request, Response, NextFunction } from "express";
import { ReadOnlyWorkspaceError, SeatExhaustedError, assertOperationalWrite } from "./writeClassification";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const BILLING_RECOVERY_PATHS = new Set([
  "/api/billing/cancel-at-period-end",
  "/api/billing/checkout",
  "/api/billing/payment-method",
]);

export function isBillingRecoveryPath(path: string): boolean {
  return BILLING_RECOVERY_PATHS.has(path);
}

/**
 * Session/agent adapter for the central write-classification check.
 * Billing-recovery paths remain; GET/HEAD/OPTIONS are view.
 */
export async function gateSessionWrite(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }
  const path = (req.path || req.originalUrl.split("?")[0]) as string;
  if (isBillingRecoveryPath(path)) {
    next();
    return;
  }
  try {
    await assertOperationalWrite();
    next();
  } catch (error) {
    if (error instanceof ReadOnlyWorkspaceError || error instanceof SeatExhaustedError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    next(error);
  }
}
