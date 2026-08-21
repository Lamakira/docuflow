import { and, eq } from "drizzle-orm";
import type { RequestHandler, Response } from "express";
import { publicApiIdempotencyKeys } from "@shared/schema";
import { db } from "../db";
import { inWorkspace, stampWorkspace } from "../workspaceContext";
import { sendProblem, CONFLICT } from "./problem";
import { requestIdOf } from "./trace";
import type { PublicApiRequest } from "./types";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function parseBody(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function requestPath(req: PublicApiRequest): string {
  return req.originalUrl.split("?")[0] ?? req.path;
}

function replay(res: Response, stored: { status: number; body: unknown; contentType: string }): void {
  res.status(stored.status);
  res.setHeader("Content-Type", stored.contentType);
  res.send(typeof stored.body === "string" ? stored.body : JSON.stringify(stored.body));
}

function lookup(serviceAccountId: string, key: string) {
  return db
    .select()
    .from(publicApiIdempotencyKeys)
    .where(
      and(
        eq(publicApiIdempotencyKeys.serviceAccountId, serviceAccountId),
        eq(publicApiIdempotencyKeys.idempotencyKey, key),
        inWorkspace(publicApiIdempotencyKeys)
      )
    )
    .limit(1);
}

function sameRequest(
  stored: { method: string; path: string },
  method: string,
  path: string
): boolean {
  return stored.method === method && stored.path === path;
}

/**
 * Optional Idempotency-Key stored-response replay on mutating `/api/v1`
 * requests (ADR-0011). Scoped to the authenticated Service Account. The same
 * key on a different method or path is a conflict, not a replay, so a kernel
 * 404 cannot satisfy a later catalogue POST.
 */
export const honorIdempotencyKey: RequestHandler = async (req: PublicApiRequest, res, next) => {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }
  const key = req.header("idempotency-key")?.trim();
  if (!key) {
    next();
    return;
  }
  const serviceAccountId = req.principalContext?.principal.serviceAccountId;
  if (!serviceAccountId) {
    next();
    return;
  }
  const path = requestPath(req);
  const requestId = req.publicApiRequestId ?? requestIdOf(req);

  try {
    const [stored] = await lookup(serviceAccountId, key);
    if (stored) {
      if (sameRequest(stored, req.method, path)) replay(res, stored);
      else sendProblem(res, CONFLICT, requestId);
      return;
    }

    const originalSend = res.send.bind(res);
    let captured = false;
    res.send = ((body?: unknown) => {
      if (captured) return originalSend(body as never);
      captured = true;
      const contentType = String(res.getHeader("Content-Type") ?? "application/json; charset=utf-8");
      const record = {
        serviceAccountId,
        idempotencyKey: key,
        method: req.method,
        path,
        status: res.statusCode,
        body: parseBody(body),
        contentType,
      };
      void db
        .insert(publicApiIdempotencyKeys)
        .values(stampWorkspace(record))
        .then(() => originalSend(body as never))
        .catch((error: unknown) => {
          const code = (error as { code?: string }).code;
          if (code === "23505") {
            return lookup(serviceAccountId, key).then(([winner]) => {
              if (!winner) {
                originalSend(body as never);
                return;
              }
              if (sameRequest(winner, req.method, path)) replay(res, winner);
              else sendProblem(res, CONFLICT, requestId);
            });
          }
          next(error);
        });
      return res;
    }) as Response["send"];

    next();
  } catch (error) {
    next(error);
  }
};
