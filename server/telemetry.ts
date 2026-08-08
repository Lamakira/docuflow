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
 * ADR-0016 allows telemetry to carry IDs only. Spans leave through an exporter
 * wrapped by `server/telemetryRedaction.ts`, which drops attributes named after
 * content and cuts query strings — the search terms and signed-URL signatures —
 * off every URL. `enhancedDatabaseReporting` stays off so query *parameters*
 * never become attributes, and no header is copied onto a span. The rule and the
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
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace";
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
  type IMetricReader,
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

  if (exporter === "console") {
    return {
      spanProcessors: [
        new SimpleSpanProcessor({ exporter: redactingExporter(new ConsoleSpanExporter()) }),
      ],
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new ConsoleMetricExporter(),
          exportIntervalMillis: metricExportIntervalMs,
        }),
      ],
      // No log processor: server/logger.ts has already written every record to
      // this same console, in one readable line with its trace id, having
      // applied the same redaction. A second machine-readable copy of it — each
      // one repeating the full resource block — would only bury the first.
      logRecordProcessors: [],
    };
  }

  if (exporter === "otlp" && otlpEndpoint) {
    const headers = otlpHeaders;
    return {
      spanProcessors: [
        new BatchSpanProcessor({
          exporter: redactingExporter(new OTLPTraceExporter({ url: otlpUrl("traces"), headers })),
        }),
      ],
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: otlpUrl("metrics"), headers }),
          exportIntervalMillis: metricExportIntervalMs,
        }),
      ],
      logRecordProcessors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({ url: otlpUrl("logs"), headers }),
        }),
      ],
    };
  }

  // `none`: instrumentation still runs and logs still carry a trace id, but
  // nothing is collected for export and nothing is written anywhere.
  return { spanProcessors: [], metricReaders: [], logRecordProcessors: [] };
}

/**
 * Head sampling. Left at the SDK default when every trace is wanted, which is
 * the case for an internal single tenant; the knob exists so Phase 2 can trade
 * detail against a sink's ingest bill without a deploy of application code.
 * Parent-based, so a sampled request keeps its whole trace.
 */
function buildSampler(): Sampler | undefined {
  const { traceSampleRate } = config.telemetry;
  if (traceSampleRate >= 1) return undefined;
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(traceSampleRate) });
}

let sdk: NodeSDK | undefined;

/**
 * Start the SDK, unless this process is configured to export nothing — in which
 * case nothing is patched at all. That is what keeps `npm test` honest: no
 * exporter to silence, no batch to flush, and no instrumentation between a suite
 * and the app it booted (#26's "instrumentation must not change behavior").
 */
export function startTelemetry(): void {
  if (sdk || config.telemetry.exporter === "none") return;

  // Silent by default: an OTLP endpoint that cannot be reached is a
  // misconfiguration worth one line on the console, not something to discover
  // in Phase 2 by noticing an empty dashboard.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const pipelines = buildPipelines();
  const sampler = buildSampler();

  sdk = new NodeSDK({
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.telemetry.serviceName,
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.nodeEnv,
      })
    ),
    ...pipelines,
    ...(sampler ? { sampler } : {}),
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
      // The statement itself is Drizzle-parameterised SQL — $1, not values.
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
