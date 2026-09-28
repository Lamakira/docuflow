import type { RequestHandler } from "express";
import {
  PlanFeatureNotIncludedError,
  ReadOnlyWorkspaceError,
  SeatExhaustedError,
  assertOperationalWrite,
  assertRequestEntitled,
} from "../modules/billing";
import { sendProblem, PLAN_UPGRADE_REQUIRED, READ_ONLY_WORKSPACE, SEAT_EXHAUSTED } from "./problem";
import { requestIdOf } from "./trace";
import type { PublicApiRequest } from "./types";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Router-level write-classification for `/api/v1`. Mutating methods go through
 * the same operational check; GET/HEAD/OPTIONS stay view. Capability denial
 * stays `forbidden`; Read-only Workspace, a Plan without the area, and seat
 * exhaustion are different.
 */
export const enforceOperationalWrite: RequestHandler = async (
  req: PublicApiRequest,
  res,
  next
) => {
  try {
    await assertRequestEntitled(req.method, `${req.baseUrl}${req.path}`);
    if (MUTATING.has(req.method)) await assertOperationalWrite();
    next();
  } catch (error) {
    const requestId = req.publicApiRequestId ?? requestIdOf(req);
    if (error instanceof ReadOnlyWorkspaceError) {
      sendProblem(res, READ_ONLY_WORKSPACE, requestId);
      return;
    }
    if (error instanceof PlanFeatureNotIncludedError) {
      sendProblem(res, PLAN_UPGRADE_REQUIRED, requestId);
      return;
    }
    if (error instanceof SeatExhaustedError) {
      sendProblem(res, SEAT_EXHAUSTED, requestId);
      return;
    }
    next(error);
  }
};
