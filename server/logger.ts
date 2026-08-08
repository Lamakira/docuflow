/**
 * Structured logger for DocuFlow server.
 *
 * One call produces two things: the console line a developer reads, and — when
 * telemetry is exporting (#26, `server/telemetry.ts`) — an OpenTelemetry log
 * record carrying the same event, the same fields, and the trace and span it
 * happened inside. That is the "one instrumentation seam, not two logging
 * systems" ADR-0016 asks for: `logInfo` is still the only thing application code
 * calls, and where those lines end up is a variable, not a rewrite.
 *
 * Both outputs pass the same rule first. `server/telemetryRedaction.ts` drops
 * fields named after content and cuts query strings off URLs, so what reaches a
 * sink in Phase 2 and what reaches the terminal are the same IDs-only record —
 * a field this refuses to export is a field a developer should not be reading
 * out of production logs either. The convention that goes with it, including
 * what to name a field so it survives, is docs/OBSERVABILITY.md.
 *
 * With no SDK started — every test run, and any script that imports this — the
 * OpenTelemetry calls resolve to no-ops and the console output is what it always
 * was, plus the trace ids when there are any.
 */

import { trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

import { config } from "./config";
import { redactAttributes, type TelemetryAttributes } from "./telemetryRedaction";

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  /** Structured context data */
  data?: Record<string, unknown>;
  /** Error details if applicable */
  error?: {
    message: string;
    stack?: string;
  };
}

/** The instrumentation scope every record this module emits is attributed to. */
const LOGGER_NAME = "docuflow.server";

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

/**
 * The request a log line belongs to, named the way every OpenTelemetry backend
 * expects to correlate on. Empty until an SDK is running: the API's default
 * tracer records nothing, so there is no active span to ask.
 */
function traceContext(): string {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext) return "";
  return ` trace=${spanContext.traceId} span=${spanContext.spanId}`;
}

function formatLog(entry: LogEntry, data: TelemetryAttributes | undefined): string {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  // Human-readable prefix + JSON payload for machine parsing
  const prefix = `${time} [${entry.level.toUpperCase()}] ${entry.event}`;
  const payload = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
  const errStr = entry.error ? ` ERR: ${entry.error.message}` : "";

  return `${prefix}${payload}${errStr}${traceContext()}`;
}

/**
 * The one path out. `consoleTail` is for what may be printed locally and must
 * never be exported — today only the response body in the request line below.
 */
function write(entry: LogEntry, consoleTail = ""): void {
  const data = entry.data
    ? redactAttributes(entry.data as TelemetryAttributes)
    : undefined;

  const line = `${formatLog(entry, data)}${consoleTail}`;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);

  // A no-op until server/telemetry.ts registers a logger provider. Fetched per
  // call rather than held: this module is imported by scripts and suites that
  // never start an SDK, and caching the no-op would outlive one that did start.
  logs.getLogger(LOGGER_NAME).emit({
    severityNumber: SEVERITY[entry.level],
    severityText: entry.level.toUpperCase(),
    body: entry.event,
    attributes: {
      ...data,
      ...(entry.error
        ? {
            "exception.message": entry.error.message,
            ...(entry.error.stack ? { "exception.stacktrace": entry.error.stack } : {}),
          }
        : {}),
    },
  });
}

/** Log an info-level event */
export function logInfo(event: string, data?: Record<string, unknown>): void {
  write({ timestamp: new Date().toISOString(), level: "info", event, data });
}

/** Log a warning-level event */
export function logWarn(event: string, data?: Record<string, unknown>): void {
  write({ timestamp: new Date().toISOString(), level: "warn", event, data });
}

/** Log an error-level event */
export function logError(event: string, err: unknown, data?: Record<string, unknown>): void {
  const error = err instanceof Error
    ? { message: err.message, stack: err.stack }
    : { message: String(err) };

  write({ timestamp: new Date().toISOString(), level: "error", event, data, error });
}

/**
 * One finished API request.
 *
 * The response body is the reason this is not a plain `logInfo`. It is the
 * fastest way to see what the server actually answered, and it is also every
 * document title, file name, and email address the API returns — so it is
 * printed where a developer is watching and nowhere else. Outside development
 * and the test harness the line is method, path, status, and duration: what an
 * SLO is measured from, and nothing that ADR-0016 keeps out of a sink.
 */
export function logHttpRequest(
  request: { method: string; path: string; status: number; durationMs: number },
  responseBody?: unknown
): void {
  const tail =
    !config.isProduction && responseBody !== undefined
      ? ` :: ${JSON.stringify(responseBody)}`
      : "";

  write(
    {
      timestamp: new Date().toISOString(),
      level: "info",
      event: "http.request",
      data: {
        method: request.method,
        path: request.path,
        status: request.status,
        durationMs: request.durationMs,
      },
    },
    tail
  );
}

// ─── Time tracking specific loggers ───

export function logTimeEvent(
  action: "start" | "pause" | "resume" | "stop" | "heartbeat",
  entryId: string,
  userId: string,
  extra?: Record<string, unknown>
): void {
  logInfo(`time-tracking.${action}`, { entryId, userId, ...extra });
}

export function logStaleSession(entryId: string, userId: string, lastActivity: string | null): void {
  logWarn("time-tracking.stale-session", { entryId, userId, lastActivity });
}

export function logScreenshotEvent(
  action: "captured" | "upload-failed" | "metadata-saved",
  entryId: string,
  extra?: Record<string, unknown>
): void {
  logInfo(`screenshot.${action}`, { entryId, ...extra });
}
