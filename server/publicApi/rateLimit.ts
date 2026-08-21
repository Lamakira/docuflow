import type { RequestHandler } from "express";
import { PUBLIC_API_RATE_LIMITS } from "../modules/billing";
import { sendProblem, RATE_LIMITED } from "./problem";
import { requestIdOf } from "./trace";
import type { PublicApiRequest } from "./types";

const WINDOW_MS = 60_000;

type Bucket = { windowStart: number; count: number };

const serviceAccountBuckets = new Map<string, Bucket>();
const workspaceBuckets = new Map<string, Bucket>();

function take(bucket: Bucket, limit: number, now: number): boolean {
  if (now - bucket.windowStart >= WINDOW_MS) {
    bucket.windowStart = now;
    bucket.count = 0;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function bucketOf(store: Map<string, Bucket>, key: string, now: number): Bucket {
  const existing = store.get(key);
  if (existing) return existing;
  const created = { windowStart: now, count: 0 };
  store.set(key, created);
  return created;
}

/** Interval-refill token bucket: `limit` tokens per 60s per key. */
function allow(serviceAccountId: string, workspaceId: string, now = Date.now()): boolean {
  const sa = bucketOf(serviceAccountBuckets, serviceAccountId, now);
  const ws = bucketOf(workspaceBuckets, workspaceId, now);
  const saOk =
    now - sa.windowStart >= WINDOW_MS || sa.count < PUBLIC_API_RATE_LIMITS.serviceAccountRequestsPerMinute;
  const wsOk =
    now - ws.windowStart >= WINDOW_MS || ws.count < PUBLIC_API_RATE_LIMITS.workspaceRequestsPerMinute;
  if (!saOk || !wsOk) return false;
  take(sa, PUBLIC_API_RATE_LIMITS.serviceAccountRequestsPerMinute, now);
  take(ws, PUBLIC_API_RATE_LIMITS.workspaceRequestsPerMinute, now);
  return true;
}

export function resetPublicApiRateBuckets(): void {
  serviceAccountBuckets.clear();
  workspaceBuckets.clear();
}

/**
 * Token bucket per Service Account plus a per-Workspace aggregate. Limits
 * come from the Billing-shell default until the Plan Registry exists.
 */
export const enforcePublicApiRateLimit: RequestHandler = (req: PublicApiRequest, res, next) => {
  const ctx = req.principalContext;
  if (!ctx) {
    next();
    return;
  }
  if (!allow(ctx.principal.serviceAccountId, ctx.workspaceId)) {
    sendProblem(res, RATE_LIMITED, req.publicApiRequestId ?? requestIdOf(req));
    return;
  }
  next();
};
