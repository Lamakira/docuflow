import type { RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID } from "@shared/schema";
import {
  createWebhookEndpoint,
  disableWebhookEndpoint,
  enableWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookEndpoints,
  rotateWebhookEndpointSecret,
  UnknownWebhookEventTypeError,
  WebhookEndpointNotFoundError,
  type WebhookEndpointView,
} from "../modules/workspace";
import { requireCapability } from "./capabilities";
import { cursorPage, decodeCursor, rfc3339Utc } from "./cursor";
import { sendProblem, BAD_REQUEST, NOT_FOUND } from "./problem";
import { requestIdOf } from "./trace";
import type { PublicApiRequest } from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const createBody = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.string()).min(1),
});

function requestId(req: PublicApiRequest): string {
  return req.publicApiRequestId ?? requestIdOf(req);
}

function run(fn: (req: PublicApiRequest, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req as PublicApiRequest, res).catch(next);
  };
}

function notFoundOrThrow(req: PublicApiRequest, res: Response, error: unknown): boolean {
  if (error instanceof WebhookEndpointNotFoundError) {
    sendProblem(res, NOT_FOUND, requestId(req));
    return true;
  }
  return false;
}

function publicEndpoint(row: WebhookEndpointView) {
  return {
    id: row.id,
    url: row.url,
    eventTypes: row.eventTypes,
    createdAt: row.createdAt ? rfc3339Utc(row.createdAt) : null,
    disabledAt: row.disabledAt ? rfc3339Utc(row.disabledAt) : null,
  };
}

/**
 * Public `/api/v1` Webhook Endpoints (#129). Capability-gated. Cursor-only
 * lists. An Endpoint confers no read of domain records.
 */
export function registerPublicApiV1WebhookEndpoints(router: Router): void {
  const manage = requireCapability(WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID);

  router.post(
    "/webhook-endpoints",
    manage,
    run(async (req, res) => {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) {
        sendProblem(res, BAD_REQUEST, requestId(req));
        return;
      }
      try {
        const created = await createWebhookEndpoint(parsed.data);
        res.status(201).json({
          ...publicEndpoint(created),
          plaintextSecret: created.plaintextSecret,
        });
      } catch (error) {
        if (error instanceof UnknownWebhookEventTypeError) {
          sendProblem(res, BAD_REQUEST, requestId(req));
          return;
        }
        throw error;
      }
    })
  );

  router.get(
    "/webhook-endpoints",
    manage,
    run(async (req, res) => {
      const limitRaw = req.query.limit;
      const limit =
        limitRaw === undefined
          ? DEFAULT_LIMIT
          : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1) {
        sendProblem(res, BAD_REQUEST, requestId(req));
        return;
      }
      const pageSize = Math.min(limit, MAX_LIMIT);
      const rows = (await listWebhookEndpoints()).map(publicEndpoint);
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      let remaining = rows;
      if (cursor) {
        const decoded = decodeCursor(cursor);
        const id = decoded && typeof decoded.id === "string" ? decoded.id : null;
        if (!id) {
          sendProblem(res, BAD_REQUEST, requestId(req));
          return;
        }
        const idx = remaining.findIndex((row) => row.id === id);
        remaining = idx === -1 ? [] : remaining.slice(idx + 1);
      }
      res.json(cursorPage(remaining.slice(0, pageSize + 1), pageSize));
    })
  );

  router.get(
    "/webhook-endpoints/:id",
    manage,
    run(async (req, res) => {
      try {
        res.json(publicEndpoint(await getWebhookEndpoint(req.params.id)));
      } catch (error) {
        if (!notFoundOrThrow(req, res, error)) throw error;
      }
    })
  );

  router.post(
    "/webhook-endpoints/:id/disable",
    manage,
    run(async (req, res) => {
      try {
        await disableWebhookEndpoint(req.params.id);
        res.json({ ok: true });
      } catch (error) {
        if (!notFoundOrThrow(req, res, error)) throw error;
      }
    })
  );

  router.post(
    "/webhook-endpoints/:id/enable",
    manage,
    run(async (req, res) => {
      try {
        await enableWebhookEndpoint(req.params.id);
        res.json({ ok: true });
      } catch (error) {
        if (!notFoundOrThrow(req, res, error)) throw error;
      }
    })
  );

  router.post(
    "/webhook-endpoints/:id/rotate",
    manage,
    run(async (req, res) => {
      try {
        const rotated = await rotateWebhookEndpointSecret(req.params.id);
        res.json(rotated);
      } catch (error) {
        if (!notFoundOrThrow(req, res, error)) throw error;
      }
    })
  );
}
