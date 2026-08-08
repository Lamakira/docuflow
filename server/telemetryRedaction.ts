/**
 * The IDs-only telemetry rule (#26, ADR-0016), written as code.
 *
 * ADR-0016 commits this deployment to telemetry that "carries IDs only": a
 * span, a log record, or a metric label may name *which* row, request, device,
 * or route something happened to, and never *what was in it*. No document text,
 * no file names, no email addresses or bodies, no transcripts, no prompts, no
 * credentials.
 *
 * Two things put payload in telemetry, and this module answers both:
 *
 *   Attributes an instrumentation collects for us. The one real leak among them
 *   is the URL query string — `/api/documents?search=<whatever the user typed>`
 *   — plus signed storage URLs, whose signature is a credential travelling in
 *   the query. Every URL-shaped attribute is therefore cut back to scheme, host,
 *   and path before it leaves the process.
 *
 *   Attributes our own code passes to the logger. Those are keyed by hand, so
 *   the rule is applied to the key: an attribute whose name contains a segment
 *   naming payload — `email`, `title`, `body`, `name` — is dropped rather than
 *   exported. It costs a few technical attributes that happen to end in a denied
 *   word (`db.name`, `express.name`); the span's own name and `http.route` carry
 *   the same information, so the trade is cheap and the rule stays one line long
 *   to explain: telemetry may not carry a field whose name says it is content.
 *
 * The rule is deliberately blunt, and it is not a substitute for not collecting
 * payload in the first place — a key called `documentSummary` passes it. It is
 * the backstop under the convention in docs/OBSERVABILITY.md, which is what a
 * reviewer should be reading against.
 *
 * Two exact keys are named exceptions, because a blunt rule reading names gets
 * them wrong: {@link TECHNICAL_KEYS}, whose names say content and whose values
 * are not, and {@link UNCAPPED_KEYS}, which are technical and legitimately
 * longer than an identifier. Both are exact keys, never segments — the
 * exception has to be argued for one attribute at a time.
 *
 * Kept free of every OpenTelemetry import on purpose: `server/logger.ts` runs
 * this on the way to console output as well, in processes and tests where no SDK
 * was ever started, so one rule covers everything the server emits.
 */

/**
 * A telemetry attribute value, in the shape both the traces SDK and the logs SDK
 * accept. Declared here rather than imported so this module stays dependency
 * free; it is structurally what `@opentelemetry/api` calls `AttributeValue`.
 */
export type TelemetryValue = string | number | boolean | Array<string | number | boolean | null | undefined>;

export type TelemetryAttributes = Record<string, TelemetryValue | undefined>;

/**
 * A name segment that says the value is content. Matched against every segment
 * of an attribute key, so `email`, `userEmail`, `user.email`, and `user_email`
 * are all caught by the one entry.
 *
 * `message` is deliberately absent: `exception.message` is the most useful field
 * an error span or log record has, and an error message that quotes a document
 * is a bug in the thrower, not something to paper over here.
 */
const PAYLOAD_SEGMENTS = new Set([
  "email",
  "mail",
  "name",
  "title",
  "subject",
  "body",
  "content",
  "text",
  "filename",
  "file",
  "prompt",
  "transcript",
  "description",
  "note",
  "comment",
  "query",
  "search",
  "password",
  "secret",
  "token",
  "signature",
  "credential",
]);

/**
 * Keys the payload rule must not drop: their names contain a denied segment and
 * their values are technical metadata, so the blunt rule gets them wrong.
 *
 * `db.query.text` is the whole reason this set exists. `instrumentation-pg`
 * names the SQL statement `db.query.text` (it was `db.statement` before semantic
 * conventions 1.30, and both spellings are kept here so an SDK upgrade in either
 * direction does not silently empty a query span). Its segments are `query` and
 * `text` — two denied words for a value that is Drizzle-parameterised SQL, `$1`
 * and never the value bound to it, with `enhancedDatabaseReporting` off so the
 * parameters never arrive at all. Without this exception a query span carries
 * timings and nothing that says which query was slow.
 */
const TECHNICAL_KEYS = new Set(["db.query.text", "db.statement"]);

/**
 * Anything longer than this is not an ID. Strings are cut here so a value that
 * slipped through the key rule cannot ship a document in one attribute; the
 * traces SDK is configured with the same limit (`spanLimits` in
 * server/telemetry.ts) for the attributes this module never sees.
 */
export const MAX_ATTRIBUTE_LENGTH = 512;

/**
 * Keys exempt from {@link MAX_ATTRIBUTE_LENGTH}, because the length is the point.
 *
 * A stack trace is frames and file paths — technical metadata by every reading
 * of ADR-0016 — and five frames of one is not worth exporting. Whatever payload
 * a thrower put in the message is `exception.message`, which the key rule sees
 * separately. Span attributes are still cut by the SDK's own `spanLimits`; this
 * exemption is what keeps a log record's stack whole.
 */
const UNCAPPED_KEYS = new Set(["exception.stacktrace"]);

/** `userEmail` → `user`, `email`; `db.name` → `db`, `name`. */
function segments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._\-/]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

/**
 * Does any segment of this key match one of `words`? Plurals count: a field
 * called `urls` holds URLs and `notes` holds notes, and a rule that only knew
 * the singular would be a rule anyone could step around by accident.
 */
function hasSegment(key: string, words: Set<string>): boolean {
  return segments(key).some(
    (segment) =>
      words.has(segment) || (segment.endsWith("s") && words.has(segment.slice(0, -1)))
  );
}

/** Does this key name content rather than identity? */
export function isPayloadKey(key: string): boolean {
  return !TECHNICAL_KEYS.has(key) && hasSegment(key, PAYLOAD_SEGMENTS);
}

/**
 * Keys holding a URL, which are scrubbed rather than dropped: the path is where
 * the IDs are, and a trace without it is not worth exporting. Recognised by the
 * `url` segment, which catches both the semantic conventions' `url.full` and a
 * hand-written `signedUrl`.
 */
const URL_SEGMENTS = new Set(["url"]);

function isUrlKey(key: string): boolean {
  return hasSegment(key, URL_SEGMENTS);
}

/**
 * A URL with everything but scheme, host, and path removed — the query string
 * (search terms, signed-URL credentials), the fragment, and any userinfo.
 *
 * Values that are not URLs come back unchanged: `url.path` and `url.scheme` are
 * keyed as URLs by the rule above and are already exactly what should ship.
 */
export function redactUrl(value: string): string {
  // Bare paths and schemes fail `new URL`, which is the signal that there is
  // nothing to cut. A path carrying a query is still handled, below.
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    const queryStart = value.indexOf("?");
    return queryStart === -1 ? value : value.slice(0, queryStart);
  }

  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function redactValue(key: string, value: TelemetryValue): TelemetryValue {
  if (typeof value === "string") {
    const scrubbed = isUrlKey(key) ? redactUrl(value) : value;
    return scrubbed.length > MAX_ATTRIBUTE_LENGTH && !UNCAPPED_KEYS.has(key)
      ? `${scrubbed.slice(0, MAX_ATTRIBUTE_LENGTH)}…`
      : scrubbed;
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string" ? (redactValue(key, entry) as string) : entry
    );
  }

  return value;
}

/**
 * The rule, applied to one set of attributes: drop what is named as content,
 * cut URLs back to their path, and cap what is left. Returns a new object; the
 * input is never modified.
 */
export function redactAttributes(attributes: TelemetryAttributes): TelemetryAttributes {
  const redacted: TelemetryAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || isPayloadKey(key)) continue;
    redacted[key] = redactValue(key, value);
  }

  return redacted;
}

/**
 * The same rule applied where the attributes cannot be replaced wholesale: a
 * finished span's attribute bag, which the exporter reads by reference.
 */
export function redactAttributesInPlace(attributes: TelemetryAttributes): void {
  const redacted = redactAttributes(attributes);

  for (const key of Object.keys(attributes)) {
    if (!(key in redacted)) delete attributes[key];
  }
  for (const [key, value] of Object.entries(redacted)) {
    attributes[key] = value;
  }
}
