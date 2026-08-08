/**
 * The OpenTelemetry baseline (#26, ADR-0017 Phase 1, ADR-0016).
 *
 * One seam, started once, that every later phase points somewhere: traces for
 * HTTP and PostgreSQL, metrics for the process and its requests, and the log
 * records `server/logger.ts` already produces — all three carrying the same
 * trace id, so a slow request, the queries it ran, and the lines it logged are
 * one thing to look at rather than three. ADR-0016 puts Better Stack and Sentry
 * behind a collector in Phase 2; what that phase has to do is set
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, not touch application code.
 *
 * ── Why this module is imported for its side effect, first, in server/index.ts
 *
 * Automatic instrumentation works by patching modules as they are loaded, which
 * it can only do to a module nothing has loaded yet. `import "./telemetry"` at
 * the top of the entry point is what puts this ahead of express and pg; move it
 * below them and the SDK still starts, still exports, and produces almost
 * nothing. Two consequences are load-bearing and easy to undo by accident:
 *
 *   `script/build.ts` must not bundle an instrumented library into
 *   dist/index.cjs — a bundled express is not a module that gets required, so it
 *   is not a module that can be patched. That is why express is external there.
 *
 *   The production Neon driver (`@neondatabase/serverless`) reaches PostgreSQL
 *   over WebSockets and has no instrumentation; query spans appear under
 *   `DB_DRIVER=pg` and not otherwise. Recorded in docs/OBSERVABILITY.md as a
 *   known gap rather than worked around here.
 *
 * ── What it refuses to send
 *
 * ADR-0016 allows telemetry to carry IDs only. Spans and metrics both leave
 * through an exporter wrapped by `server/telemetryRedaction.ts`, which drops
 * attributes named after content and cuts query strings — the search terms and
 * signed-URL signatures — off every URL; log records get the same rule inside
 * `server/logger.ts`, which is where they are built. All three signals, one
 * function. `enhancedDatabaseReporting` stays off so query *parameters* never
 * become attributes, and no header is copied onto a span. The rule and the
 * convention that goes with it are docs/OBSERVABILITY.md.
 */

import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
} from "@opentelemetry/semantic-conventions";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace";
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
  type IMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation, ExpressLayerType } from "@opentelemetry/instrumentation-express";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";

import { config } from "./config";
import { MAX_ATTRIBUTE_LENGTH, redactAttributesInPlace } from "./telemetryRedaction";

/** How long shutdown waits for a flush before the process leaves anyway. */
const SHUTDOWN_TIMEOUT_MS = 3_000;

/**
 * Paths a trace is not worth starting for: the container's own health probe,
 * which runs every 30 seconds forever, and the dev server's asset traffic, which
 * would bury the request being looked at under a hundred module fetches.
 */
function isUninterestingRequest(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0];
  return (
    path === "/health" ||
    path.startsWith("/@") ||
    path.startsWith("/src/") ||
    path.startsWith("/node_modules/")
  );
}

/**
 * The ADR-0016 rule applied on the way out, to whatever the instrumentations
 * collected. Wrapping the exporter rather than adding a span processor keeps it
 * deterministic: attributes are scrubbed as part of exporting them, not in a
 * processor that happens to run before the one that serialises.
 */
function redactingExporter(inner: SpanExporter): SpanExporter {
  return {
    export(spans, resultCallback) {
      for (const span of spans) {
        redactAttributesInPlace(span.attributes);
        for (const event of span.events) {
          if (event.attributes) redactAttributesInPlace(event.attributes);
        }
      }
      inner.export(spans, resultCallback);
    },
    shutdown: () => inner.shutdown(),
    forceFlush: inner.forceFlush ? () => inner.forceFlush!() : undefined,
  };
}

/**
 * The same rule for the third signal. Metric *labels* are attributes too, and
 * ADR-0016 names them alongside spans and logs; today every one of them is
 * generated by an instrumentation (`http.route`, `http.response.status_code`),
 * but the seam has to exist before the first hand-written counter, not after.
 *
 * The two `select*` hooks are delegated rather than defaulted: they are how an
 * OTLP exporter states the temporality and aggregation its collector wants, and
 * a wrapper that answered for it would quietly change what is exported.
 */
function redactingMetricExporter(inner: PushMetricExporter): PushMetricExporter {
  return {
    export(metrics, resultCallback) {
      for (const scope of metrics.scopeMetrics) {
        for (const metric of scope.metrics) {
          for (const point of metric.dataPoints) {
            redactAttributesInPlace(point.attributes);
          }
        }
      }
      inner.export(metrics, resultCallback);
    },
    forceFlush: () => inner.forceFlush(),
    shutdown: () => inner.shutdown(),
    ...(inner.selectAggregation
      ? { selectAggregation: (kind) => inner.selectAggregation!(kind) }
      : {}),
    ...(inner.selectAggregationTemporality
      ? { selectAggregationTemporality: (kind) => inner.selectAggregationTemporality!(kind) }
      : {}),
  };
}

/**
 * A span processor that receives every span and forwards none.
 *
 * Not the same thing as no processor at all: `NodeSDK` only registers a tracer
 * provider when it has at least one processor, and without a registered
 * provider the API hands out non-recording spans — no span context, so no
 * `trace=` on a log line. Under `OTEL_EXPORTER=none` that correlation is the
 * whole of what telemetry is still doing, so the processor exists to keep the
 * provider real while the destination is nothing.
 */
const DISCARDING_SPAN_PROCESSOR: SpanProcessor = {
  onStart: () => {},
  onEnd: () => {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

function otlpUrl(signal: "traces" | "metrics" | "logs"): string {
  return `${config.telemetry.otlpEndpoint}/v1/${signal}`;
}

/**
 * The exporters for one destination. Console output is written span by span so
 * that a request traced locally prints while it is still the thing on screen;
 * OTLP batches, because a collector should be talked to in batches.
 */
function buildPipelines(): {
  spanProcessors: SpanProcessor[];
  metricReaders: IMetricReader[];
  logRecordProcessors: LogRecordProcessor[];
} {
  const { exporter, otlpEndpoint, otlpHeaders, metricExportIntervalMs } = config.telemetry;

  switch (exporter) {
    case "console":
      return {
        spanProcessors: [
          new SimpleSpanProcessor({ exporter: redactingExporter(new ConsoleSpanExporter()) }),
        ],
        metricReaders: [
          new PeriodicExportingMetricReader({
            exporter: redactingMetricExporter(new ConsoleMetricExporter()),
            exportIntervalMillis: metricExportIntervalMs,
          }),
        ],
        // No log processor: server/logger.ts has already written every record to
        // this same console, in one readable line with its trace id, having
        // applied the same redaction. A second machine-readable copy of it — each
        // one repeating the full resource block — would only bury the first.
        logRecordProcessors: [],
      };

    case "otlp":
      // `otlpEndpoint` is guaranteed by server/config.ts, which refuses to boot
      // an OTLP exporter without one rather than let it retry into the void.
      return {
        spanProcessors: [
          new BatchSpanProcessor({
            exporter: redactingExporter(
              new OTLPTraceExporter({ url: otlpUrl("traces"), headers: otlpHeaders })
            ),
          }),
        ],
        metricReaders: [
          new PeriodicExportingMetricReader({
            exporter: redactingMetricExporter(
              new OTLPMetricExporter({ url: otlpUrl("metrics"), headers: otlpHeaders })
            ),
            exportIntervalMillis: metricExportIntervalMs,
          }),
        ],
        logRecordProcessors: [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({ url: otlpUrl("logs"), headers: otlpHeaders }),
          }),
        ],
      };

    case "none":
      // Instrumented, collected, and thrown away — which is what makes a log
      // line in this mode still carry the id of the request it came from. No
      // metric reader: a metric has no trace to correlate with, so collecting
      // one nobody reads would be cost without a reason.
      return {
        spanProcessors: [DISCARDING_SPAN_PROCESSOR],
        metricReaders: [],
        logRecordProcessors: [],
      };
  }
}

let sdk: NodeSDK | undefined;

/**
 * Start the SDK — in every process except a test run, whatever the exporter is.
 *
 * `OTEL_EXPORTER=none` is a statement about a *destination*, not about
 * instrumentation: production runs it until Phase 2 names a collector, and a
 * production process that had patched nothing would have no trace ids on its
 * log lines and no instrumentation to point at a sink when Phase 2 arrives. It
 * is the one thing #26 asks not to be a code change.
 *
 * The harness is the real exception, and it is the environment that names it.
 * Under `NODE_ENV=test` nothing is patched at all: no exporter to silence, no
 * batch to flush, and nothing between a suite and the app it booted (#26's
 * "instrumentation must not change behavior").
 */
export function startTelemetry(): void {
  if (sdk || config.nodeEnv === "test") return;

  // Silent by default: an OTLP endpoint that cannot be reached is a
  // misconfiguration worth one line on the console, not something to discover
  // in Phase 2 by noticing an empty dashboard.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  sdk = new NodeSDK({
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.telemetry.serviceName,
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.nodeEnv,
      })
    ),
    ...buildPipelines(),
    // A second guard under the key rule in server/telemetryRedaction.ts: an
    // attribute that is not an ID cannot become one by being long.
    spanLimits: { attributeValueLengthLimit: MAX_ATTRIBUTE_LENGTH },
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => isUninterestingRequest(request.url),
      }),
      // Route and handler spans only. Every request passes through helmet, two
      // rate limiters, the body parsers, the session, and passport; a span each
      // would treble the size of a trace to say what the middleware stack in
      // server/app.ts already says in order.
      new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
      // `enhancedDatabaseReporting` stays off: it attaches the query's
      // parameters, which is exactly the payload ADR-0016 keeps out of spans.
      // The statement itself is Drizzle-parameterised SQL — $1, not values —
      // and reaches an exporter only because `db.query.text` is named in
      // `TECHNICAL_KEYS`; the key rule would otherwise read it as content.
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new RuntimeNodeInstrumentation(),
    ],
  });

  sdk.start();

  // Flush before the process leaves. Without a listener Node exits on SIGTERM
  // immediately and the last batch of spans dies with it; with one, the exit
  // becomes ours to perform, which is why each handler ends in `process.exit`.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void shutdownTelemetry().finally(() => process.exit(0));
    });
  }
}

/** Flush and stop, or give up after {@link SHUTDOWN_TIMEOUT_MS} and let the process go. */
export async function shutdownTelemetry(): Promise<void> {
  const running = sdk;
  if (!running) return;
  sdk = undefined;

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      running.shutdown(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error(`[telemetry] shutdown failed: ${(error as Error).message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

startTelemetry();
