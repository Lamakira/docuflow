import type { RequestHandler, Response, NextFunction } from "express";
import { sendProblem, FORBIDDEN } from "./problem";
import { requestIdOf } from "./trace";
import type { PublicApiRequest } from "./types";

export function requireCapability(capabilityId: string): RequestHandler {
  return (req: PublicApiRequest, res: Response, next: NextFunction) => {
    const granted = req.principalContext?.capabilities ?? [];
    if (!granted.includes(capabilityId)) {
      sendProblem(res, FORBIDDEN, req.publicApiRequestId ?? requestIdOf(req));
      return;
    }
    next();
  };
}
