import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_ATTRIBUTE_LENGTH,
  redactAttributes,
  redactAttributesInPlace,
  redactUrl,
} from "../../server/telemetryRedaction";

/**
 * The ADR-0016 rule that #26 put in the way of everything the server exports:
 * telemetry carries IDs, and never what was in the row, the request, or the file.
 *
 * The rule is exercised here rather than through a running SDK on purpose.
 * Starting one inside the harness would patch express and pg for whatever ran
 * next in the same worker, which is the opposite of what the ticket asks for —
 * that the suites stay uninstrumented. What a started SDK does with these
 * attributes is one wrapper (`redactingExporter` in server/telemetry.ts) around
 * the same function.
 */

describe("telemetry redaction — what may not leave the process", () => {
  it("drops fields named after content, whatever the casing or separator", async () => {
    const redacted = redactAttributes({
      userId: "u-1",
      email: "someone@example.com",
      userEmail: "someone@example.com",
      "user.email": "someone@example.com",
      user_email: "someone@example.com",
      documentTitle: "Q3 board pack",
      fileName: "salaries.xlsx",
      messageBody: "the whole email",
      searchTerm: "restructuring",
    });

    expect(redacted).toEqual({ userId: "u-1" });
  });

  it("drops the URL query string the HTTP instrumentation collects", async () => {
    // `url.query` is set verbatim from the request by
    // @opentelemetry/instrumentation-http — for /api/documents?search=… it is
    // the user's search terms, in a span, in a sink.
    const redacted = redactAttributes({
      "url.path": "/api/documents",
      "url.query": "search=quarterly%20redundancies",
      "url.scheme": "https",
      "http.route": "/api/documents",
      "http.response.status_code": 200,
    });

    expect(redacted).toEqual({
      "url.path": "/api/documents",
      "url.scheme": "https",
      "http.route": "/api/documents",
      "http.response.status_code": 200,
    });
  });

  it("keeps the IDs and the technical metadata a trace is read for", async () => {
    const attributes = {
      entryId: "e-1",
      deviceId: "d-1",
      crmProjectId: 42,
      status: 401,
      durationMs: 29,
      "http.request.method": "POST",
      "client.address": "127.0.0.1",
      "user_agent.original": "DocuFlow-Agent/0.1.4",
      "exception.message": "connection terminated unexpectedly",
    };

    expect(redactAttributes(attributes)).toEqual(attributes);
  });

  it("keeps the SQL statement, under whichever name the pg instrumentation uses", async () => {
    // `query` and `text` are both denied segments, so the blunt key rule reads
    // `db.query.text` as content and empties every query span of the one thing
    // it is read for. The value is parameterised — `$1`, never the address.
    const statement = "select * from users where email = $1";

    expect(
      redactAttributes({ "db.query.text": statement, "db.statement": statement })
    ).toEqual({ "db.query.text": statement, "db.statement": statement });

    // The exception is the exact key and nothing near it: a hand-written field
    // that happens to hold a query must still be dropped.
    expect(redactAttributes({ "search.query.text": statement, dbQueryText: statement })).toEqual(
      {}
    );
  });

  it("keeps a stack trace whole and still cuts everything else", async () => {
    const stack = `Error: connection terminated\n${"    at handler (server/routes.ts:1:1)\n".repeat(50)}`;
    expect(stack.length).toBeGreaterThan(MAX_ATTRIBUTE_LENGTH);

    const redacted = redactAttributes({
      "exception.stacktrace": stack,
      "exception.message": "y".repeat(5_000),
    });

    // Five frames of a stack are not worth exporting; a 5000-character error
    // message is a thrower quoting something it should not have.
    expect(redacted["exception.stacktrace"]).toBe(stack);
    expect(String(redacted["exception.message"])).toHaveLength(MAX_ATTRIBUTE_LENGTH + 1);
  });

  it("cuts a URL back to its path, taking the signature with the query", async () => {
    // A signed storage URL carries its credential in the query string; the
    // object it points at is a UUID, which is exactly what should survive.
    const signed =
      "https://storage.googleapis.com/bucket/uploads/9f1c?X-Goog-Signature=deadbeef&X-Goog-Expires=900";

    expect(redactUrl(signed)).toBe("https://storage.googleapis.com/bucket/uploads/9f1c");
    expect(redactUrl("https://user:pa55w0rd@collector.internal/v1/traces#frag")).toBe(
      "https://collector.internal/v1/traces"
    );
    expect(redactUrl("/api/documents?search=secret")).toBe("/api/documents");
    // Not a URL, nothing to cut: `url.path` and `url.scheme` arrive here too.
    expect(redactUrl("/api/documents")).toBe("/api/documents");
    expect(redactUrl("https")).toBe("https");
  });

  it("caps a value that is too long to be an identifier", async () => {
    const redacted = redactAttributes({ note: "x".repeat(5_000), reason: "y".repeat(5_000) });

    expect(redacted.note).toBeUndefined();
    expect(String(redacted.reason)).toHaveLength(MAX_ATTRIBUTE_LENGTH + 1); // + the ellipsis
  });

  it("passes numbers, booleans, and arrays through, scrubbing strings inside them", async () => {
    const redacted = redactAttributes({
      count: 3,
      idempotent: true,
      ids: ["a", "b"],
      urls: ["https://example.com/x?token=abc"],
      absent: undefined,
    });

    expect(redacted).toEqual({
      count: 3,
      idempotent: true,
      ids: ["a", "b"],
      urls: ["https://example.com/x"],
    });
  });

  it("returns a new object, and mutates only when asked to", async () => {
    const original = { userId: "u-1", email: "someone@example.com" };

    const copy = redactAttributes(original);
    expect(copy).not.toBe(original);
    expect(original.email).toBe("someone@example.com");

    // The span exporter has no way to replace a finished span's attribute bag.
    redactAttributesInPlace(original);
    expect(original).toEqual({ userId: "u-1" });
  });
});

describe("logger — one rule for the console and the export", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = "test";
    vi.resetModules();
  });

  it("keeps a field named after content out of the line it prints", async () => {
    const { logInfo } = await import("../../server/logger");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logInfo("agent.auth.login.failed", { reason: "user_not_found", email: "someone@example.com" });

    const line = spy.mock.calls.flat().join("\n");
    expect(line).toContain("agent.auth.login.failed");
    expect(line).toContain("user_not_found");
    expect(line).not.toContain("someone@example.com");
  });

  it("prints an error's message and adds no trace ids when nothing is traced", async () => {
    const { logError } = await import("../../server/logger");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logError("agent.timer.start.failed", new Error("connection terminated"), { userId: "u-1" });

    const line = spy.mock.calls.flat().join("\n");
    expect(line).toContain("ERR: connection terminated");
    expect(line).toContain("u-1");
    // No SDK is running in the harness, so there is no span to correlate with.
    expect(line).not.toContain("trace=");
  });

  it("puts an error's message through the same rule as every other field", async () => {
    const { logError } = await import("../../server/logger");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    // A thrower that quotes the row it failed on. The console line and the
    // exported record are built from one redacted bag, so neither can be the
    // one that ships the whole of it.
    logError("document.index.failed", new Error("z".repeat(5_000)));

    const line = spy.mock.calls.flat().join("\n");
    expect(line).toContain("…");
    expect(line).not.toContain("z".repeat(MAX_ATTRIBUTE_LENGTH + 1));
  });

  it("shows the response body while developing and never in production", async () => {
    const local = await import("../../server/logger");
    const localSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    local.logHttpRequest(
      { method: "GET", path: "/api/documents", status: 200, durationMs: 12 },
      { documents: [{ title: "Q3 board pack" }] }
    );

    const localLine = localSpy.mock.calls.flat().join("\n");
    expect(localLine).toContain("Q3 board pack");
    expect(localLine).toContain('"durationMs":12');
    localSpy.mockRestore();

    // Same call, in the environment where the line is shipped rather than read
    // off a terminal: method, path, status, duration, and nothing else.
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const shipped = await import("../../server/logger");
    const shippedSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    shipped.logHttpRequest(
      { method: "GET", path: "/api/documents", status: 200, durationMs: 12 },
      { documents: [{ title: "Q3 board pack" }] }
    );

    const shippedLine = shippedSpy.mock.calls.flat().join("\n");
    expect(shippedLine).not.toContain("Q3 board pack");
    expect(shippedLine).toContain('"status":200');
  });
});

describe("telemetry SDK — off under test", () => {
  afterEach(() => {
    delete process.env.OTEL_EXPORTER;
    process.env.NODE_ENV = "test";
    vi.resetModules();
  });

  /**
   * Starting registers the handlers that flush and then exit the process —
   * which a test run must never acquire. Their absence is the observable
   * difference between an SDK that started and one that did not, and the only
   * one that can be asserted without starting one in this worker.
   */
  const signalListeners = () =>
    process.listenerCount("SIGTERM") + process.listenerCount("SIGINT");

  it("starts nothing when it is imported by a suite", async () => {
    const before = signalListeners();

    await import("../../server/telemetry");

    expect(signalListeners()).toBe(before);
  });

  it("is the environment that stops it, not the exporter", async () => {
    // The distinction matters in the other direction: `OTEL_EXPORTER=none` is
    // where production runs until Phase 2, and it has to stay instrumented so
    // its log lines carry a trace id. `NODE_ENV=test` is the one case that
    // skips the SDK — so an exporter named in a suite must not start one.
    process.env.OTEL_EXPORTER = "console";
    vi.resetModules();
    const before = signalListeners();

    await import("../../server/telemetry");

    expect(signalListeners()).toBe(before);
  });
});
