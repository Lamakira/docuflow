import type { Express, Request, RequestHandler, Response, NextFunction } from "express";
import { Router } from "express";
import { logError } from "../logger";
import { principalContextFromApiKey } from "../modules/identity";
import { runWithWorkspaceContext } from "../workspaceContext";
import { registerPublicApiV1Catalogue } from "./catalogue";
import { registerPublicApiV1WebhookEndpoints } from "./webhookEndpoints";
import { honorIdempotencyKey } from "./idempotency";
import { sendProblem, INTERNAL, NOT_FOUND, UNAUTHORIZED } from "./problem";
import { enforcePublicApiRateLimit } from "./rateLimit";
import { requestIdOf, runWithRequestTrace } from "./trace";
import type { PublicApiRequest } from "./types";

export type { PublicApiRequest } from "./types";

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

const requireServiceAccount: RequestHandler = async (
  req: PublicApiRequest,
  res: Response,
  next: NextFunction
) => {
  return runWithRequestTrace(req, async () => {
    const requestId = requestIdOf(req);
    req.publicApiRequestId = requestId;

    const token = bearerToken(req);
    if (!token) {
      sendProblem(res, UNAUTHORIZED, requestId);
      return;
    }

    try {
      const ctx = await principalContextFromApiKey(token);
      if (!ctx) {
        sendProblem(res, UNAUTHORIZED, requestId);
        return;
      }
      req.principalContext = ctx;
      runWithWorkspaceContext(
        {
          workspaceId: ctx.workspaceId,
          principalKind: ctx.principal.kind,
          principalId: ctx.principal.serviceAccountId,
        },
        () => next()
      );
    } catch (error) {
      next(error);
    }
  });
};

/**
 * Public `/api/v1` (#126 kernel, #127 catalogue). Service Account API keys
 * only. Session cookies and Device tokens are not valid here.
 */
export function registerPublicApiV1(app: Express): void {
  const router = Router();
  router.use(requireServiceAccount);
  router.use(enforcePublicApiRateLimit);
  router.use(honorIdempotencyKey);
  router.get("/", (_req, res) => {
    res.json({ version: "v1" });
  });
  registerPublicApiV1Catalogue(router);
  registerPublicApiV1WebhookEndpoints(router);
  router.use((req: PublicApiRequest, res) => {
    sendProblem(res, NOT_FOUND, req.publicApiRequestId ?? requestIdOf(req));
  });
  router.use((err: unknown, req: PublicApiRequest, res: Response, _next: NextFunction) => {
    logError("public-api-v1-error", err, { path: req.path, method: req.method });
    sendProblem(res, INTERNAL, req.publicApiRequestId ?? requestIdOf(req));
  });
  app.use("/api/v1", router);
}
