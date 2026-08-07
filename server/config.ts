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

export interface ObjectStorageConfig {
  /** `/bucket/prefix` root under which private objects live. */
  privateDir: string;
  /** `/bucket/prefix` roots searched for public objects; the first receives uploads. */
  publicSearchPaths: string[];
  /** Inline service-account key; absent means `GOOGLE_APPLICATION_CREDENTIALS` names one. */
  serviceAccount?: ServiceAccountKey;
  projectId?: string;
}

export interface EmailConfig {
  /** Absent means email is unconfigured: sends fail and report the reason. */
  apiKey?: string;
  fromAddress: string;
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

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  database: DatabaseConfig;
  sessionSecret: string;
  /** The keys desktop-agent access tokens are issued and verified with. */
  desktopTokens: DesktopTokenConfig;
  objectStorage: ObjectStorageConfig;
  email: EmailConfig;
  /** Absolute base URL this deployment is reached at, used in outbound email links. */
  appUrl: string;
  openaiApiKey?: string;
  fathomApiKey?: string;
  replitAuth: ReplitAuthConfig;
}

const DEFAULT_FROM_ADDRESS = "DocuFlow <noreply@resend.dev>";
const DEFAULT_PORT = 5000;

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
  const serviceAccountKey = read("GCS_SERVICE_ACCOUNT_KEY");
  const serviceAccount = serviceAccountKey
    ? readServiceAccount(serviceAccountKey, missing)
    : undefined;
  if (!serviceAccountKey && !read("GOOGLE_APPLICATION_CREDENTIALS")) {
    missing.push(
      "GCS_SERVICE_ACCOUNT_KEY — the service-account key file's JSON, verbatim or " +
        "base64-encoded; or GOOGLE_APPLICATION_CREDENTIALS naming a key file on disk"
    );
  }

  return {
    value: {
      privateDir: privateDir ?? "",
      publicSearchPaths,
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

function resolveConfig(): AppConfig {
  // Read as a static member expression: the production bundle replaces exactly
  // this text with a literal (see script/build.ts), which a dynamic lookup misses.
  const nodeEnv = process.env.NODE_ENV ?? "development";

  const database = resolveDatabase();
  const objectStorage = resolveObjectStorage();
  const sessionSecret = read("SESSION_SECRET");
  const desktopTokens = resolveDesktopTokens();

  const missing = [
    ...database.missing,
    ...objectStorage.missing,
    ...(sessionSecret
      ? []
      : ["SESSION_SECRET — signs session cookies; any long random string"]),
    ...desktopTokens.missing,
  ];

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
    database: database.value,
    sessionSecret: sessionSecret!,
    desktopTokens: desktopTokens.value,
    objectStorage: objectStorage.value,
    email: {
      apiKey: read("RESEND_API_KEY"),
      fromAddress: read("RESEND_FROM_EMAIL") ?? DEFAULT_FROM_ADDRESS,
    },
    appUrl: resolveAppUrl(),
    openaiApiKey: read("OPENAI_API_KEY"),
    fathomApiKey: read("FATHOM_API_KEY"),
    replitAuth: {
      clientId: read("REPL_ID"),
      issuerUrl: read("ISSUER_URL") ?? "https://replit.com/oidc",
    },
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
 * One boot line describing what this process is configured with. The connection
 * string is masked: the password never reaches the log.
 *
 * Called by the process entry point rather than run at import, so that importing
 * config — which the test harness and any script does — stays silent.
 */
export function logConfigSummary(): void {
  console.log(
    `[config] ${config.nodeEnv} — database ${config.database.source} over ${config.database.driver} ` +
      `(${config.database.connectionString.replace(/:([^@/]+)@/, ":<hidden>@")}), ` +
      `object storage via ${storageCredentialMode()}, ` +
      `desktop tokens on key ${desktopTokenKeys()}, ` +
      `email ${config.email.apiKey ? "enabled" : "unconfigured"}, ` +
      `OpenAI ${config.openaiApiKey ? "enabled" : "unconfigured"}`
  );
}
