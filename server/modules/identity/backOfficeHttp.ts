/**
 * The back office surface (#314). Every `/api/platform/*` route is behind
 * `requirePlatformStaff`: a Platform Staff session with a verified second
 * factor. The one customer-side route, `POST /api/support-requests`, is a
 * signed-in Member writing to support from their own Workspace.
 *
 * Express 4 does not catch a rejected async handler, so every route goes
 * through `route`, which turns a known refusal into `{ message }` and hands
 * anything else to the app's error handler.
 */

import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { supportCategoryValues, supportStatusValues } from "@shared/schema";
import { getUserId, isAuthenticated } from "../../auth";
import {
  BillingPinMissingError,
  BillingProviderClosedError,
  BillingProviderError,
  InvalidBillingTransitionError,
  OfferedPlanUnknownError,
  PaidSubscriptionError,
} from "../billing";
import {
  extendTrialFor,
  listAuditEvents,
  listDisputes,
  listOwnSupportAccess,
  listSubscriptionRows,
  listSupportRequestRows,
  listUserWorkspaces,
  listWorkspaceRows,
  offerPlanTo,
  setCancelAtPeriodEndFor,
  workspaceDetail,
} from "./backOfficeWorkspaces";
import {
  answerSupportRequest,
  createSupportRequest,
  noteSupportRequest,
  SupportAnswerEmailError,
  SupportRequestNotFoundError,
  supportRequestDetail,
  updateSupportRequest,
} from "./backOfficeSupport";
import { platformStats, platformStatsSeries, STATS_PERIODS } from "./backOfficeStats";
import { listPlatformStaff, PlatformStaffNotFoundError, WorkspaceNotFoundError } from "./operatorAccess";
import { requirePlatformStaff } from "./operatorHttp";

type Responder = Pick<Response, "status">;

/** Refusals that carry their own `statusCode`. */
const REFUSALS = [
  WorkspaceNotFoundError,
  SupportRequestNotFoundError,
  PlatformStaffNotFoundError,
  PaidSubscriptionError,
  OfferedPlanUnknownError,
  SupportAnswerEmailError,
] as const;

function refuse(res: Responder, error: unknown): boolean {
  if (REFUSALS.some((type) => error instanceof type)) {
    const refusal = error as Error & { statusCode: number };
    res.status(refusal.statusCode).json({ message: refusal.message });
    return true;
  }
  // These carry no `statusCode`. A closed provider is checked before the
  // provider error it extends.
  let status: number | null = null;
  if (error instanceof z.ZodError) status = 400;
  else if (error instanceof BillingPinMissingError || error instanceof InvalidBillingTransitionError) status = 409;
  else if (error instanceof BillingProviderClosedError) status = 400;
  else if (error instanceof BillingProviderError) status = 502;
  if (status == null) return false;
  const message =
    error instanceof z.ZodError ? (error.errors[0]?.message ?? "Invalid request") : (error as Error).message;
  res.status(status).json({ message });
  return true;
}

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch((error: unknown) => {
      if (res.headersSent) return next(error);
      if (!refuse(res, error)) next(error);
    });
  };
}

function staffIdOf(req: Request): string {
  return (req as { platformStaffId?: string }).platformStaffId as string;
}

const trialExtensionBody = z.object({ days: z.number().int().min(1).max(90) });
const offeredPlanBody = z.object({
  planKey: z.string().min(1),
  days: z.number().int().min(1).max(365),
  seats: z.number().int().min(1).optional(),
});
const cancelBody = z.object({ cancel: z.boolean() });
const entryBody = z.object({ body: z.string().trim().min(1).max(10000) });
const supportPatchBody = z
  .object({
    status: z.enum(supportStatusValues).optional(),
    assignedStaffId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => value.status !== undefined || value.assignedStaffId !== undefined, {
    message: "Nothing to change",
  });
const supportRequestBody = z.object({
  category: z.enum(supportCategoryValues),
  message: z.string().trim().min(1).max(5000),
});
const statsQuery = z.object({
  days: z
    .enum(STATS_PERIODS.map(String) as [string, ...string[]], {
      errorMap: () => ({ message: "Choose 7, 30 or 90 days" }),
    })
    .default("30"),
});

function queryText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function registerBackOfficeRoutes(app: Express): void {
  app.post(
    "/api/support-requests",
    isAuthenticated,
    route(async (req, res) => {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const input = supportRequestBody.parse(req.body);
      res.status(201).json(await createSupportRequest(userId, input));
    })
  );

  app.get("/api/platform/workspaces", requirePlatformStaff, route(async (_req, res) => {
    res.json(await listWorkspaceRows());
  }));

  app.get("/api/platform/workspaces/:id", requirePlatformStaff, route(async (req, res) => {
    res.json(await workspaceDetail(req.params.id));
  }));

  app.post("/api/platform/workspaces/:id/trial-extension", requirePlatformStaff, route(async (req, res) => {
    const input = trialExtensionBody.parse(req.body);
    res.json(await extendTrialFor(req.params.id, staffIdOf(req), input));
  }));

  app.post("/api/platform/workspaces/:id/offered-plan", requirePlatformStaff, route(async (req, res) => {
    const input = offeredPlanBody.parse(req.body);
    res.json(await offerPlanTo(req.params.id, staffIdOf(req), input));
  }));

  app.post("/api/platform/workspaces/:id/cancel-at-period-end", requirePlatformStaff, route(async (req, res) => {
    const input = cancelBody.parse(req.body);
    res.json(await setCancelAtPeriodEndFor(req.params.id, staffIdOf(req), input));
  }));

  app.get("/api/platform/users/:id/workspaces", requirePlatformStaff, route(async (req, res) => {
    res.json(await listUserWorkspaces(req.params.id));
  }));

  app.get("/api/platform/subscriptions", requirePlatformStaff, route(async (_req, res) => {
    res.json(await listSubscriptionRows());
  }));

  app.get("/api/platform/disputes", requirePlatformStaff, route(async (_req, res) => {
    res.json(await listDisputes());
  }));

  app.get("/api/platform/support-requests", requirePlatformStaff, route(async (_req, res) => {
    res.json(await listSupportRequestRows());
  }));

  app.get("/api/platform/support-requests/:id", requirePlatformStaff, route(async (req, res) => {
    res.json(await supportRequestDetail(req.params.id));
  }));

  app.patch("/api/platform/support-requests/:id", requirePlatformStaff, route(async (req, res) => {
    const patch = supportPatchBody.parse(req.body);
    res.json(await updateSupportRequest(staffIdOf(req), req.params.id, patch));
  }));

  app.post("/api/platform/support-requests/:id/answers", requirePlatformStaff, route(async (req, res) => {
    const { body } = entryBody.parse(req.body);
    res.status(201).json(await answerSupportRequest(staffIdOf(req), req.params.id, body));
  }));

  app.post("/api/platform/support-requests/:id/notes", requirePlatformStaff, route(async (req, res) => {
    const { body } = entryBody.parse(req.body);
    res.status(201).json(await noteSupportRequest(staffIdOf(req), req.params.id, body));
  }));

  app.get("/api/platform/stats", requirePlatformStaff, route(async (req, res) => {
    const { days } = statsQuery.parse({ days: queryText(req.query.days) });
    res.json(await platformStats(Number(days)));
  }));

  app.get("/api/platform/stats/series", requirePlatformStaff, route(async (req, res) => {
    const { days } = statsQuery.parse({ days: queryText(req.query.days) });
    res.json(await platformStatsSeries(Number(days)));
  }));

  app.get("/api/platform/staff", requirePlatformStaff, route(async (_req, res) => {
    res.json(await listPlatformStaff());
  }));

  app.get("/api/platform/support-access", requirePlatformStaff, route(async (req, res) => {
    res.json(await listOwnSupportAccess(staffIdOf(req)));
  }));

  app.get("/api/platform/audit-events", requirePlatformStaff, route(async (req, res) => {
    res.json(
      await listAuditEvents({
        workspaceId: queryText(req.query.workspaceId),
        platformStaffId: queryText(req.query.platformStaffId),
        action: queryText(req.query.action),
      })
    );
  }));
}
