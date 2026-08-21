import { randomBytes } from "node:crypto";
import { context, trace, TraceFlags, INVALID_TRACEID } from "@opentelemetry/api";
import type { Request } from "express";

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i;

function traceIdFrom(req: Request): string {
  const fromSpan = trace.getActiveSpan()?.spanContext().traceId;
  if (fromSpan && fromSpan !== INVALID_TRACEID) return fromSpan;

  const header = req.header("traceparent");
  const match = header ? TRACEPARENT.exec(header.trim()) : null;
  if (match) return match[1].toLowerCase();

  return randomBytes(16).toString("hex");
}

/**
 * The public error `requestId` is the OpenTelemetry trace id already in the
 * runtime — not a second identifier (docs/OBSERVABILITY.md). When the SDK
 * has not started a span (tests), bind the W3C `traceparent` or a minted id
 * as the active span context so the request still has one trace id.
 */
export function requestIdOf(req: Request): string {
  return traceIdFrom(req);
}

export function runWithRequestTrace<T>(req: Request, fn: () => T): T {
  const active = trace.getActiveSpan()?.spanContext();
  if (active && active.traceId !== INVALID_TRACEID) return fn();

  return context.with(
    trace.setSpanContext(context.active(), {
      traceId: traceIdFrom(req),
      spanId: randomBytes(8).toString("hex"),
      traceFlags: TraceFlags.NONE,
      isRemote: Boolean(req.header("traceparent")),
    }),
    fn
  );
}
