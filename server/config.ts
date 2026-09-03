/**
 * config.ts — the one place the server reads `process.env`.
 *
 * Everything the process needs is resolved here, once, at module load. The
 * variables the app cannot serve without are validated together: one that is
 * absent, or set to something unusable, aborts boot naming every var that needs
 * attention, instead of surfacing hours later as a 500 on the first request that
 * happens to need it. Variables that gate a feature stay optional — the feature
 * keeps deciding what "not configured" means, so an unset `OPENAI_API_KEY` or
 * `RESEND_API_KEY` behaves exactly as it did before this module existed.
 *
 * `.env.example` documents every variable and `docs/CONFIGURATION.md` explains
 * how they reach the process, including the ADR-0018 rule this repository runs
 * under: no production credential, URL, or dataset ever lands here.
 */

import { PG_VARS, resolveDatabaseUrl, type DatabaseUrlSource } from "../shared/databaseUrl";
import { parseSigningKey, type SigningKey } from "./signingKeys";

export type { SigningKey };

export type DatabaseSource = DatabaseUrlSource;
export type DatabaseDriver = "neon" | "pg";

export interface DatabaseConfig {
  connectionString: string;
  /** Which set of variables the connection string came from. */
  source: DatabaseSource;
  /** `pg` is node-postgres, for databases Neon's WebSocket driver cannot reach. */
  driver: DatabaseDriver;
}

/** The two fields of a Google service-account key the storage client signs with. */
export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  projectId?: string;
}

/**
 * Which storage the objects live in. `replit` is App Storage, which supplies its
 * own identity and cannot mint signed URLs; `gcs` is a Google bucket reached
 * with a service-account key that can sign. Selected by whether a key is named,
 * never by a switch — an environment that supplies one means it.
 */
export type ObjectStorageProvider = "replit" | "gcs";

export interface ObjectStorageConfig {
  /** `/bucket/prefix` root under which private objects live. */
  privateDir: string;
  /** `/bucket/prefix` roots searched for public objects; the first receives uploads. */
  publicSearchPaths: string[];
  /** Which provider the roots above are held in. */
  provider: ObjectStorageProvider;
  /** Inline service-account key; absent means `GOOGLE_APPLICATION_CREDENTIALS` names one. */
  serviceAccount?: ServiceAccountKey;
  projectId?: string;
}

export interface EmailConfig {
  /** Absent means email is unconfigured: sends fail and report the reason. */
  apiKey?: string;
  fromAddress: string;
}

export interface BillingConfig {
  /** Absent means Checkout and other money movement fail closed. */
  secretKey?: string;
  webhookSecret?: string;
  /** Stripe Price id for Plan `pro`. Other Plans have no Stripe objects. */
  pricePro?: string;
}

export interface IdentityConfig {
  /** Absent means IdentityProvider operations fail closed. Login is still email/password and OIDC. */
  secretKey?: string;
  publishableKey?: string;
}

export interface DesktopTokenConfig {
  /** Signs every access token this process issues. */
  current: SigningKey;
  /** Still accepted, for the rotation window in which its tokens expire. */
  previous?: SigningKey;
}

/** Replit OIDC login. Phase 5 replaces it with Clerk and deletes this section. */
export interface ReplitAuthConfig {
  clientId?: string;
  issuerUrl: string;
}

/**
 * Where the OpenTelemetry SDK sends what it collects. `none` still instruments
 * the process — spans exist, and logs carry their trace id — it just exports
 * nothing. Only `NODE_ENV=test` leaves the process unpatched entirely.
 */
export type TelemetryExporterKind = "none" | "console" | "otlp";

export interface TelemetryConfig {
  exporter: TelemetryExporterKind;
  /** `service.name` on every span, metric, and log record this process emits. */
  serviceName: string;
  /** OTLP/HTTP collector root, without the `/v1/traces` a signal appends. */
  otlpEndpoint?: string;
  /** Sent with every OTLP request; how a hosted collector authenticates us. */
  otlpHeaders?: Record<string, string>;
  metricExportIntervalMs: number;
}

export type ProcessRole = "http" | "worker";

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  /** `worker` claims Jobs. `http` is the Autoscale app and never claims. */
  role: ProcessRole;
  /**
   * HTTP `setInterval` dispatchers. Default on until the Worker is proven
   * (#87 turns this off). The Worker process does not read this — it never
   * starts those intervals.
   */
  httpBackgroundIntervals: boolean;
  database: DatabaseConfig;
  sessionSecret: string;
  /** The keys desktop-agent access tokens are issued and verified with. */
  desktopTokens: DesktopTokenConfig;
  objectStorage: ObjectStorageConfig;
  email: EmailConfig;
  billing: BillingConfig;
  identity: IdentityConfig;
  /** Absolute base URL this deployment is reached at, used in outbound email links. */
  appUrl: string;
  openaiApiKey?: string;
  fathomApiKey?: string;
  /**
   * The browser the transcript scraper launches. Absent is the normal state,
   * and the one both the image and a developer machine run in: Playwright then
   * finds the build its own installer put in place. Name one only on a host
   * carrying a browser of its own — a distribution's `/usr/bin/chromium`, or
   * the Nix store path the Replit machine has, which is what used to stand as a
   * constant in `server/browser-transcript.ts` (#37).
   *
   * Read as written and never opened. Whether the path names something runnable
   * is the launch's question, and `server/browser-transcript.ts` asks it there,
   * where the answer costs one scrape instead of the whole server's boot.
   */
  chromiumPath?: string;
  replitAuth: ReplitAuthConfig;
  telemetry: TelemetryConfig;
}

const DEFAULT_FROM_ADDRESS = "DocuFlow <noreply@resend.dev>";
const DEFAULT_PORT = 5000;
/** ADR-0016 names the HTTP runtime and the Phase 3 worker as separate services. */
const DEFAULT_SERVICE_NAME = "docuflow-server";
const DEFAULT_METRIC_INTERVAL_MS = 60_000;

/** A set variable that holds only whitespace is treated as unset. */
function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

/** Comma-separated variable → trimmed, de-duplicated entries. */
function readList(name: string): string[] {
  const raw = read(name);
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );
}

/**
 * One section of the configuration, alongside the required variables it found
 * absent or unusable. Sections report what is wrong rather than aborting on the
 * first gap, so a single boot failure can name every one of them.
 */
interface Resolved<T> {
  value: T;
  missing: string[];
}

function resolveDatabase(): Resolved<DatabaseConfig> {
  // DB_DRIVER=pg selects node-postgres for local and CI Postgres; production
  // stays on the Neon serverless driver.
  const driver: DatabaseDriver = read("DB_DRIVER") === "pg" ? "pg" : "neon";

  // `read` rather than `process.env`: a whitespace-only variable is unset here.
  const { url, source, missing } = resolveDatabaseUrl(read);
  if (url) {
    return { value: { connectionString: url, source, driver }, missing: [] };
  }

  return {
    value: { connectionString: "", source, driver },
    missing: [
      `DATABASE_URL — or every PG* variable instead (${PG_VARS.join(", ")}); ` +
        `currently missing: ${missing.join(", ")}`,
    ],
  };
}

/**
 * `GCS_SERVICE_ACCOUNT_KEY` holds the key file's JSON, either verbatim or
 * base64-encoded — the encoded form is what survives secret managers and CI
 * variables that mangle newlines in `private_key`.
 *
 * A value that cannot be read goes on the caller's pile rather than aborting
 * here, so a mangled key does not hide every other variable the environment is
 * also short of.
 */
function readServiceAccount(raw: string, missing: string[]): ServiceAccountKey | undefined {
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  let parsed: { client_email?: string; private_key?: string; project_id?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    missing.push(
      "GCS_SERVICE_ACCOUNT_KEY is not valid JSON. Supply the service-account key " +
        "file's contents, either verbatim or base64-encoded."
    );
    return undefined;
  }

  if (!parsed.client_email || !parsed.private_key) {
    missing.push(
      "GCS_SERVICE_ACCOUNT_KEY is missing client_email or private_key — it does " +
        "not look like a service-account key file."
    );
    return undefined;
  }

  return {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
    projectId: parsed.project_id,
  };
}

function resolveObjectStorage(): Resolved<ObjectStorageConfig> {
  const missing: string[] = [];

  const privateDir = read("PRIVATE_OBJECT_DIR");
  if (!privateDir) {
    missing.push("PRIVATE_OBJECT_DIR — bucket root for private objects, e.g. /my-bucket/.private");
  }

  const publicSearchPaths = readList("PUBLIC_OBJECT_SEARCH_PATHS");
  if (publicSearchPaths.length === 0) {
    missing.push(
      "PUBLIC_OBJECT_SEARCH_PATHS — comma-separated bucket roots for public objects, " +
        "e.g. /my-bucket/public"
    );
  }

  // Signing a V4 URL needs a key that can sign, so a credential is as required as
  // the bucket roots are. Both ways of supplying one are an environment variable,
  // which makes the absence of either checkable here rather than at the first
  // upload. Bare workload identity — a Google host inferring an identity from no
  // variable at all — is not among them: nothing this app runs on is a Google
  // host, so it would be a mode no deployment has ever exercised.
  //
  // Naming neither is the complaint below; naming one that cannot be read is a
  // different complaint, which `readServiceAccount` files itself.
  // ADR-0023 puts this environment's objects in Replit App Storage, which
  // authenticates itself from `REPL_IDENTITY` against the connectors host and
  // exposes no credential to name. Probed 2026-08-13: the Google client cannot
  // reach an App Storage bucket at all, so a GCS key is not an alternative here
  // and demanding one would refuse a correctly-configured environment.
  //
  // A key is still accepted, because the release scripts publish installers to a
  // real GCS bucket and a deployment may point at one. Supplying it selects the
  // Google provider; supplying nothing selects App Storage, whose bucket arrives
  // inside PRIVATE_OBJECT_DIR rather than as a credential.
  const serviceAccountKey = read("GCS_SERVICE_ACCOUNT_KEY");
  const serviceAccount = serviceAccountKey
    ? readServiceAccount(serviceAccountKey, missing)
    : undefined;
  const provider: ObjectStorageProvider =
    serviceAccount || read("GOOGLE_APPLICATION_CREDENTIALS") ? "gcs" : "replit";

  return {
    value: {
      privateDir: privateDir ?? "",
      publicSearchPaths,
      provider,
      serviceAccount,
      projectId: read("GCS_PROJECT_ID") ?? serviceAccount?.projectId,
    },
    missing,
  };
}

/** Stands in until boot aborts: nothing reads it while `missing` is non-empty. */
const UNRESOLVED_KEY: SigningKey = { id: "", secret: "" };

/**
 * A written key, or nothing and the reason on the pile. A value that cannot be
 * read is reported the way an absent one is, so a malformed key does not hide
 * every other variable the environment is also short of.
 */
function readSigningKey(name: string, raw: string, missing: string[]): SigningKey | undefined {
  try {
    return parseSigningKey(name, raw);
  } catch (error) {
    missing.push((error as Error).message);
    return undefined;
  }
}

/**
 * The keys behind the desktop agent's access tokens. Both the signing and the
 * verifying side read them from here, so the tokens a process issued outlive it:
 * a restart, a deploy, or a second replica goes on accepting them. There is no
 * generated fallback — a key this process invented would be gone at the next
 * boot, and every signed-in agent with it — so an absent key stops boot rather
 * than quietly signing the fleet out an hour later.
 *
 * `JWT_PREVIOUS_SECRET` is the rotation window: while it is set, tokens signed
 * with either key verify, and every newly issued one names the current key.
 * docs/CONFIGURATION.md has the procedure.
 */
function resolveDesktopTokens(): Resolved<DesktopTokenConfig> {
  const missing: string[] = [];

  const currentRaw = read("JWT_SECRET");
  if (!currentRaw) {
    missing.push(
      "JWT_SECRET — signs desktop-agent access tokens, written as <key-id>:<secret>, " +
        "e.g. 2026-08:$(openssl rand -hex 32)"
    );
  }
  const current = currentRaw ? readSigningKey("JWT_SECRET", currentRaw, missing) : undefined;

  const previousRaw = read("JWT_PREVIOUS_SECRET");
  const previous = previousRaw
    ? readSigningKey("JWT_PREVIOUS_SECRET", previousRaw, missing)
    : undefined;

  // One id answering to two secrets would make the id in a token's header
  // ambiguous, which is the single thing it is there to settle.
  if (current && previous && previous.id === current.id) {
    missing.push(
      `JWT_PREVIOUS_SECRET and JWT_SECRET both name the key "${current.id}". A rotation ` +
        `puts a new id alongside the old one; give the incoming key a different id.`
    );
  }

  return { value: { current: current ?? UNRESOLVED_KEY, previous }, missing };
}

/**
 * Where this deployment is reachable, for links in outbound email. `APP_URL` is
 * the standard setting; the Replit variables remain as a fallback so the Replit
 * deployment keeps producing the URLs it always did, and go with the OIDC login
 * in Phase 5.
 */
function resolveAppUrl(): string {
  const explicit = read("APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const replitDomain = readList("REPLIT_DOMAINS")[0] ?? read("REPLIT_DEV_DOMAIN");
  if (replitDomain) return `https://${replitDomain}`;

  return `http://localhost:${DEFAULT_PORT}`;
}

/** A number inside its range, or the reason it is unusable on the pile. */
function readNumber(
  name: string,
  fallback: number,
  range: { min: number; max: number; integer?: boolean },
  missing: string[]
): number {
  const raw = read(name);
  if (!raw) return fallback;

  const value = Number(raw);
  const usable =
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max &&
    (!range.integer || Number.isInteger(value));
  if (!usable) {
    missing.push(
      `${name} is "${raw}" — expected a${range.integer ? "n integer" : " number"} between ` +
        `${range.min} and ${range.max}.`
    );
    return fallback;
  }
  return value;
}

/**
 * `key=value,key2=value2` — the format the OpenTelemetry specification gives
 * `OTEL_EXPORTER_OTLP_HEADERS`, so a collector's own documentation can be pasted
 * in unchanged. Values are credentials: they are parsed here and never printed.
 */
function readOtlpHeaders(missing: string[]): Record<string, string> | undefined {
  const raw = read("OTEL_EXPORTER_OTLP_HEADERS");
  if (!raw) return undefined;

  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    const key = separator === -1 ? "" : pair.slice(0, separator).trim();
    const value = separator === -1 ? "" : pair.slice(separator + 1).trim();
    if (!key || !value) {
      missing.push(
        "OTEL_EXPORTER_OTLP_HEADERS is malformed. Write it as comma-separated " +
          "key=value pairs, e.g. authorization=Bearer abc123."
      );
      return undefined;
    }
    headers[key] = value;
  }
  return headers;
}

/**
 * The OTLP collector this process ships to, checked against ADR-0018 before it
 * is accepted: while this repository is the parallel environment, telemetry may
 * only reach a collector on this machine. `ALLOW_REMOTE_OTLP=1` is the same
 * deliberate opt-out `ALLOW_REMOTE_TEST_DB` is for the harness — for a
 * collector that is known to be a scratch one, never for a production sink.
 */
function readOtlpEndpoint(missing: string[]): string | undefined {
  const raw = read("OTEL_EXPORTER_OTLP_ENDPOINT");
  if (!raw) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    missing.push(
      `OTEL_EXPORTER_OTLP_ENDPOINT is "${raw}" — expected the collector's root URL, ` +
        `e.g. http://localhost:4318 (the /v1/traces suffix is added per signal).`
    );
    return undefined;
  }

  const host = parsed.hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!isLocal && read("ALLOW_REMOTE_OTLP") !== "1") {
    missing.push(
      `OTEL_EXPORTER_OTLP_ENDPOINT points at "${host}", which is not this machine. ` +
        `ADR-0018 keeps this environment's telemetry on local collectors until Phase 2 ` +
        `provisions its own sinks; set ALLOW_REMOTE_OTLP=1 only for a collector you know ` +
        `is not a production one.`
    );
    return undefined;
  }

  return raw.replace(/\/+$/, "");
}

/**
 * What the OpenTelemetry SDK does in this process (#26, ADR-0016).
 *
 * Instrumentation is on in every process but a test run; only the exporter
 * follows the environment, so that turning telemetry into something a sink can
 * see is a variable and never a code change (which is the whole point of
 * instrumenting once, in Phase 1, for Phase 2 to point somewhere). Unset, the
 * exporter is chosen the way each environment wants it:
 *
 *   test         nothing. A suite must not print spans or hold a batch open —
 *                and `NODE_ENV=test` also stops the SDK from starting at all,
 *                in server/telemetry.ts, so nothing is patched under it either.
 *   an endpoint  OTLP. Naming a collector is how you ask for one.
 *   development  the console, so `npm run dev` shows a trace without a collector.
 *   production   nothing, until Phase 2 sets an endpoint. A production process
 *                printing every span would fill its log drain with them. It is
 *                still instrumented: its log lines carry the trace id of the
 *                request they came from, and Phase 2 changes a variable.
 *
 * `OTEL_EXPORTER` overrides all four.
 */
function resolveTelemetry(nodeEnv: string): Resolved<TelemetryConfig> {
  const missing: string[] = [];

  const otlpEndpoint = readOtlpEndpoint(missing);
  const otlpHeaders = readOtlpHeaders(missing);

  const requested = read("OTEL_EXPORTER");
  let exporter: TelemetryExporterKind;
  if (requested === undefined) {
    exporter =
      nodeEnv === "test"
        ? "none"
        : otlpEndpoint
          ? "otlp"
          : nodeEnv === "production"
            ? "none"
            : "console";
  } else if (requested === "none" || requested === "console" || requested === "otlp") {
    exporter = requested;
  } else {
    missing.push(`OTEL_EXPORTER is "${requested}" — expected none, console, or otlp.`);
    exporter = "none";
  }

  // Asked for OTLP with nowhere to send it: the exporter would retry against
  // localhost:4318 forever, which looks like telemetry working right up until
  // someone goes looking for it.
  if (exporter === "otlp" && !otlpEndpoint && missing.length === 0) {
    missing.push(
      "OTEL_EXPORTER=otlp needs OTEL_EXPORTER_OTLP_ENDPOINT — the collector's root URL, " +
        "e.g. http://localhost:4318."
    );
  }

  return {
    value: {
      exporter,
      serviceName: read("OTEL_SERVICE_NAME") ?? DEFAULT_SERVICE_NAME,
      otlpEndpoint,
      otlpHeaders,
      metricExportIntervalMs: readNumber(
        "OTEL_METRIC_EXPORT_INTERVAL_MS",
        DEFAULT_METRIC_INTERVAL_MS,
        { min: 1000, max: 3_600_000, integer: true },
        missing
      ),
    },
    missing,
  };
}

function resolveRole(missing: string[]): ProcessRole {
  const raw = read("DOCUFLOW_ROLE");
  if (!raw || raw === "http") return "http";
  if (raw === "worker") return "worker";
  missing.push(`DOCUFLOW_ROLE is "${raw}" — expected http or worker.`);
  return "http";
}

/**
 * Expand/contract flag (#83, #87): HTTP intervals stay on until the Worker is
 * proven. Only an explicit off turns them off — unset, empty, and any other
 * value keep today's behaviour.
 */
function resolveHttpBackgroundIntervals(): boolean {
  const raw = read("DOCUFLOW_HTTP_BACKGROUND_INTERVALS");
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function resolveBilling(missing: string[]): BillingConfig {
  const secretKey = read("STRIPE_SECRET_KEY");
  if (secretKey && !secretKey.startsWith("sk_test_")) {
    missing.push(
      "STRIPE_SECRET_KEY must be a test-mode key (sk_test_…) — this environment never holds a live Stripe account (ADR-0018)"
    );
  }
  return {
    secretKey,
    webhookSecret: read("STRIPE_WEBHOOK_SECRET"),
    pricePro: read("STRIPE_PRICE_PRO"),
  };
}

function resolveIdentity(missing: string[]): IdentityConfig {
  const secretKey = read("CLERK_SECRET_KEY");
  if (secretKey && !secretKey.startsWith("sk_test_")) {
    missing.push(
      "CLERK_SECRET_KEY must be a test-mode key (sk_test_…) — this environment never holds a live Clerk instance (ADR-0018)"
    );
  }
  const publishableKey = read("CLERK_PUBLISHABLE_KEY");
  if (publishableKey && !publishableKey.startsWith("pk_test_")) {
    missing.push(
      "CLERK_PUBLISHABLE_KEY must be a test-mode key (pk_test_…) — this environment never holds a live Clerk instance (ADR-0018)"
    );
  }
  return { secretKey, publishableKey };
}

function resolveConfig(): AppConfig {
  // Read as a static member expression: the production bundle replaces exactly
  // this text with a literal (see script/bundles.ts), which a dynamic lookup misses.
  const nodeEnv = process.env.NODE_ENV ?? "development";

  const database = resolveDatabase();
  const objectStorage = resolveObjectStorage();
  const sessionSecret = read("SESSION_SECRET");
  const desktopTokens = resolveDesktopTokens();
  const telemetry = resolveTelemetry(nodeEnv);
  const missing: string[] = [];
  const role = resolveRole(missing);
  const billing = resolveBilling(missing);
  const identity = resolveIdentity(missing);

  missing.push(
    ...database.missing,
    ...objectStorage.missing,
    ...(sessionSecret
      ? []
      : ["SESSION_SECRET — signs session cookies; any long random string"]),
    ...desktopTokens.missing,
    ...telemetry.missing,
  );

  if (missing.length > 0) {
    throw new Error(
      `Configuration incomplete. Set the following, then start again:\n` +
        missing.map((line) => `  - ${line}`).join("\n") +
        `\n.env.example lists every variable; docs/CONFIGURATION.md explains them.`
    );
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: Number.parseInt(read("PORT") ?? String(DEFAULT_PORT), 10),
    role,
    httpBackgroundIntervals: resolveHttpBackgroundIntervals(),
    database: database.value,
    sessionSecret: sessionSecret!,
    desktopTokens: desktopTokens.value,
    objectStorage: objectStorage.value,
    email: {
      apiKey: read("RESEND_API_KEY"),
      fromAddress: read("RESEND_FROM_EMAIL") ?? DEFAULT_FROM_ADDRESS,
    },
    billing,
    identity,
    appUrl: resolveAppUrl(),
    openaiApiKey: read("OPENAI_API_KEY"),
    fathomApiKey: read("FATHOM_API_KEY"),
    chromiumPath: read("PLAYWRIGHT_CHROMIUM_PATH"),
    replitAuth: {
      clientId: read("REPL_ID"),
      issuerUrl: read("ISSUER_URL") ?? "https://replit.com/oidc",
    },
    telemetry: telemetry.value,
  };
}

export const config: AppConfig = Object.freeze(resolveConfig());

/**
 * Read per call rather than resolved at boot: both are compared against a
 * request header, the current code has always read them per request, and the
 * characterization suites switch them on and off between tests.
 */
export function mcpApiKey(): string | undefined {
  return read("MCP_API_KEY");
}

export function desktopReleaseCiToken(): string | undefined {
  return read("DESKTOP_RELEASE_CI_TOKEN");
}

/**
 * The Phase 5 dual-auth drain (#109, ADR-0007, ADR-0017): while this is on, a
 * Clerk-mapped session enters the Workspace alongside the legacy session for the
 * same User. Off — the default — is today's behaviour, email/password and OIDC
 * only, which is what makes rollback a flag flip rather than a down migration.
 *
 * Temporary, DocuFlow-owned, and read per call rather than resolved at boot for
 * the same reason `mcpApiKey()` is: an operator turns the drain on and back off
 * against a running process, and the suites flip it between cases.
 * Owner: @Lamakira. Removal gate: #111, which takes Replit OIDC and
 * `MCP_API_KEY` out and leaves Clerk as the only web session.
 */
export function identityDualAuthEnabled(): boolean {
  const raw = read("DOCUFLOW_IDENTITY_DUAL_AUTH")?.toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** One of the two, always: boot refuses an environment that supplies neither. */
function storageCredentialMode(): string {
  return config.objectStorage.serviceAccount
    ? "service-account key"
    : "GOOGLE_APPLICATION_CREDENTIALS";
}

/**
 * Which signing keys this process will accept, by id — never by secret. Printing
 * it is how an operator confirms mid-rotation that the replica in front of them
 * picked up the new key and still honours the old one.
 */
function desktopTokenKeys(): string {
  const { current, previous } = config.desktopTokens;
  return previous ? `${current.id}, retiring ${previous.id}` : current.id;
}

/**
 * Where telemetry goes, by name and destination — never by header, which is the
 * collector's credential.
 */
function telemetryDestination(): string {
  const { exporter, otlpEndpoint, serviceName } = config.telemetry;
  const destination = exporter === "otlp" ? `${exporter} → ${otlpEndpoint}` : exporter;
  return `${destination} as ${serviceName}`;
}

/**
 * One boot line describing what this process is configured with. The connection
 * string is masked: the password never reaches the log.
 *
 * Called by the process entry point rather than run at import, so that importing
 * config — which the test harness and any script does — stays silent.
 */
export function logConfigSummary(): void {
  console.log(
    `[config] ${config.nodeEnv} — role ${config.role}, ` +
      `database ${config.database.source} over ${config.database.driver} ` +
      `(${config.database.connectionString.replace(/:([^@/]+)@/, ":<hidden>@")}), ` +
      `object storage via ${storageCredentialMode()}, ` +
      `desktop tokens on key ${desktopTokenKeys()}, ` +
      `email ${config.email.apiKey ? "enabled" : "unconfigured"}, ` +
      `Stripe ${config.billing.secretKey ? "enabled" : "unconfigured"}, ` +
      `Clerk ${config.identity.secretKey ? "enabled" : "unconfigured"}, ` +
      `dual-auth ${identityDualAuthEnabled() ? "on" : "off"}, ` +
      `OpenAI ${config.openaiApiKey ? "enabled" : "unconfigured"}, ` +
      `transcript browser ${config.chromiumPath ?? "as Playwright resolves it"}, ` +
      `telemetry ${telemetryDestination()}, ` +
      `HTTP intervals ${config.httpBackgroundIntervals ? "on" : "off"}`
  );
}
