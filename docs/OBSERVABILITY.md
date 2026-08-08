# Observability

The OpenTelemetry baseline (#26, ADR-0017 Phase 1, ADR-0016): one instrumented
seam, started once, that Phase 2 points at Better Stack and Sentry by setting a
variable rather than by touching application code.

Two files hold all of it. [`server/telemetry.ts`](../server/telemetry.ts) starts
the SDK; [`server/telemetryRedaction.ts`](../server/telemetryRedaction.ts) is the
rule about what may leave the process. [docs/CONFIGURATION.md](CONFIGURATION.md)
lists the variables.

## What is collected

| Signal | Source | What you get |
| --- | --- | --- |
| Traces | `instrumentation-http`, `instrumentation-express`, `instrumentation-pg` | A span per API request, named `POST /api/agent/auth/login` with `http.route` on it, and a child span per SQL query underneath, carrying `db.query.text` |
| Metrics | the same HTTP instrumentation, plus `instrumentation-runtime-node` | `http.server.request.duration` by route and status, and event-loop, heap, and GC metrics for the process |
| Logs | [`server/logger.ts`](../server/logger.ts) | Every `logInfo` / `logWarn` / `logError`, as an OTLP log record carrying the trace and span it happened inside. Under the console exporter the readable line is the record — there is no second copy |

Two kinds of request get no span at all (`isUninterestingRequest` in
`server/telemetry.ts`): `/health`, which the container probes every 30 seconds
forever, and the dev server's own asset traffic — `/@…`, `/src/…`,
`/node_modules/…` — which would bury the request being looked at under a hundred
module fetches. Middleware layers get no span either: helmet, two rate limiters,
the body parsers, the session, and passport run on every request, and a span
each would treble a trace to say what `server/app.ts` already says in order.

The three signals share a trace id, which is what makes them one thing to read.
Every console line the logger writes ends in `trace=<id> span=<id>` when there is
an active span, so a line copied out of a terminal is enough to find the request
it came from. This holds under `OTEL_EXPORTER=none` too — the process is still
instrumented, the spans are simply discarded instead of exported — which is what
production has out of this ticket.

W3C `traceparent` is the request id *inside* the process: it is read off an
incoming request when one sends it, generated when one does not, and propagated
onward — so there is no second request-id header to maintain. It is not yet
handed back to a caller; ADR-0011's problem+json request id is under Known gaps.

## The rule for new code: IDs only

ADR-0016 commits this deployment to telemetry that **carries IDs only**. A span,
a log record, or a metric label may name *which* row, request, device, or route
something happened to. It may never carry *what was in it*.

In ADR-0015's terms, telemetry is a **Workspace-Operational** surface and only
that. No **Identity**, **Sensitive-Evidence**, **Financial**, or **Secret** Data
Class field belongs in a span, a log record, or a metric label — which is where
the specific lists below come from.

May be named:

- identifiers — `userId`, `entryId`, `deviceId`, `crmProjectId`, storage keys
  (they are UUIDs);
- enumerations and outcomes — `reason: "user_not_found"`, `status: 401`,
  `clientType`, `os`;
- counts, sizes, and durations — `eventCount`, `durationMs`, `finalDuration`;
- route templates and technical metadata — `http.route`, `db.query.text`
  (Drizzle-parameterised, `$1` and not values), user agents, addresses,
  `exception.message` and `exception.stacktrace`.

May never be named: document text or titles, file names, email addresses or
bodies, transcripts, chat prompts and completions, client and contact names,
machine names their owners chose, tokens, secrets, signatures, and anything a
user typed — including a search term, which arrives as a query string.

When a field would help but is not allowed, log the id of the row that holds it.
`{ documentId }` is one query away from the title, and the query is authorised.

### The backstop, and its edges

`server/telemetryRedaction.ts` is the one function all three signals go through:
span attributes and metric labels on their way to an exporter, and log records
and the console line inside `server/logger.ts`, where they are built.

- an attribute whose key has a segment naming content — `email`, `title`, `body`,
  `name`, `token`, `search`, singular or plural, dotted or camelCase — is
  **dropped**, so `userEmail`, `user.email`, and `documentTitle` all go;
- a URL-ish attribute keeps its scheme, host, and path, and loses its query
  string, fragment, and userinfo — that is what takes the search terms out of
  `url.full` and the signature out of a signed storage URL;
- anything longer than 512 characters is cut, on the grounds that it was not an
  identifier.

Four exceptions, each argued for one key at a time rather than by pattern:

- **`db.query.text`** (and `db.statement`, its name before semantic conventions
  1.30) is kept although `query` and `text` are both denied segments. The value
  is parameterised SQL and `enhancedDatabaseReporting` is off, so no bound value
  reaches it; without the exception a query span carries timings and nothing
  that says which query was slow.
- **`exception.stacktrace`** is exempt from the 512-character cut, because five
  frames of a stack are not worth exporting. It is still subject to the key
  rule, and whatever a thrower put in the message is `exception.message`, which
  is capped like everything else.
- **Resource attributes** are outside the rule by design: `service.name`,
  `host.name`, and the process attributes identify the instance a signal came
  from, which is what an operator needs to tell two replicas apart.
- **The response body on a request line.** `logHttpRequest` appends the JSON the
  API answered with to the *console line only*, outside production, past the
  rule — it is the fastest way to see what the server actually said, and it is
  also every document title and email address the API returns. Nothing exported
  ever carries it, and in production it is not printed either. It is the single
  hole in "one rule for the console and the export", and it is deliberate.

Two consequences worth knowing. `db.name` and `express.name` are dropped as
collateral of the `name` rule — the span's own name and `http.route` say the same
thing. And the rule reads keys, not values: a field called `documentSummary`
would sail straight through it. **The backstop is not the rule.** It catches what
an instrumentation collects on our behalf; what our own code passes is a review
question, and this section is what to review against.

## Seeing a trace locally

```bash
npm run dev
curl -i -X POST localhost:5000/api/agent/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"someone@example.com","password":"wrong","deviceMeta":{"deviceName":"laptop","platform":"darwin"}}'
```

The console prints the spans as they end — the HTTP span, the express handler,
each query — then the log lines with the matching `trace=`. A metric dump follows
every 60 seconds (`OTEL_METRIC_EXPORT_INTERVAL_MS` shortens it).

The failed login is also the shortest demonstration of the rule: the address that
was tried appears nowhere in the output.

To exercise the OTLP path instead, run a collector locally and set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`. ADR-0018 keeps this
repository off remote collectors until Phase 2 (`ALLOW_REMOTE_OTLP` is the
deliberate opt-out).

## Load-bearing details

Automatic instrumentation patches a library **as it is loaded**, which puts three
constraints on the tree. Each is quiet when broken: telemetry keeps arriving, it
just stops saying anything useful.

- **`import "./telemetry"` is the first line of `server/index.ts`.** Below
  express or pg, the SDK still starts and still exports, and produces almost
  nothing.
- **An instrumented library must not be bundled.** `script/bundles.ts` marks
  `express` external for exactly this reason — a bundled module is never
  required, so it is never patched. `pg` and every `@opentelemetry/*` package are
  external too.
- **Development needs an ESM loader hook.** `npm run dev` loads the server as ES
  modules through tsx, where a patched copy handed back to `require` never
  reaches an `import`; `--import ./server/telemetryEsmHook.mjs` on the dev script
  is what registers it. Production runs the CommonJS bundle and needs nothing.

## Known gaps

- **The Neon driver is not instrumented.** `@neondatabase/serverless` reaches
  PostgreSQL over WebSockets and has no OpenTelemetry instrumentation, so query
  spans appear under `DB_DRIVER=pg` and not under the default driver. Phase 2
  decides whether that matters enough to wrap the pool.
- **No error tracker yet.** ADR-0016 puts Sentry in Phase 2 for web and desktop
  errors. Server-side, `logError` already produces an OTLP record with
  `exception.message` and `exception.stacktrace`, which is what Phase 2 has to
  point somewhere.
- **No collector, no sinks, no dashboards.** ADR-0018 keeps them out of this
  environment; this ticket is the instrumentation they will plug into.
- **No trace id reaches a client.** ADR-0011 requires the public surfaces to
  answer errors as RFC 9457 problem+json carrying a request id; the legacy web
  API still answers `{ message }`, and nothing puts `traceparent` on a response.
  That is Phase 7's contract-surface work, not this ticket's — recorded here
  because the request id it will use already exists, and should be the trace id
  rather than a second identifier invented alongside it.
