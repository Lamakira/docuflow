import type { RequestHandler } from "express";
import {
  ReadOnlyWorkspaceError,
  SeatExhaustedError,
  assertOperationalWrite,
} from "../modules/billing";
import { sendProblem, READ_ONLY_WORKSPACE, SEAT_EXHAUSTED } from "./problem";
import { requestIdOf } from "./trace";
import type { PublicApiRequest } from "./types";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Router-level write-classification for `/api/v1`. Mutating methods go through
 * the same operational check; GET/HEAD/OPTIONS stay view. Capability denial
 * stays `forbidden`; Read-only Workspace and seat exhaustion are different.
 */
export const enforceOperationalWrite: RequestHandler = async (
  req: PublicApiRequest,
  res,
  next
) => {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }
  try {
    await assertOperationalWrite();
    next();
  } catch (error) {
    const requestId = req.publicApiRequestId ?? requestIdOf(req);
    if (error instanceof ReadOnlyWorkspaceError) {
      sendProblem(res, READ_ONLY_WORKSPACE, requestId);
      return;
    }
    if (error instanceof SeatExhaustedError) {
      sendProblem(res, SEAT_EXHAUSTED, requestId);
      return;
    }
    next(error);
  }
};
