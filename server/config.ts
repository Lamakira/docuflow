/**
 * config.ts — the one place the server reads `process.env`.
 *
 * Everything the process needs is resolved here, once, at module load. The
 * variables the app cannot serve without are validated together: a missing one
 * aborts boot naming every var that is absent, instead of surfacing hours later
 * as a 500 on the first request that happens to need it. Variables that gate a
 * feature stay optional — the feature keeps deciding what "not configured"
 * means, so an unset `OPENAI_API_KEY` or `RESEND_API_KEY` behaves exactly as it
 * did before this module existed.
 *
 * `.env.example` documents every variable and `docs/CONFIGURATION.md` explains
 * how they reach the process, including the ADR-0018 rule this repository runs
 * under: no production credential, URL, or dataset ever lands here.
 */

export type DatabaseSource = "DATABASE_URL" | "PG_VARS";
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
  /** Inline service-account key; absent means Application Default Credentials. */
  serviceAccount?: ServiceAccountKey;
  projectId?: string;
}

export interface EmailConfig {
  /** Absent means email is unconfigured: sends fail and report the reason. */
  apiKey?: string;
  fromAddress: string;
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
  /** Absent means the desktop agent mints an ephemeral signing key per boot. */
  jwtSecret?: string;
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

function resolveDatabase(missing: string[]): DatabaseConfig {
  // DB_DRIVER=pg selects node-postgres for local and CI Postgres; production
  // stays on the Neon serverless driver.
  const driver: DatabaseDriver = read("DB_DRIVER") === "pg" ? "pg" : "neon";

  const url = read("DATABASE_URL");
  if (url) {
    return { connectionString: url, source: "DATABASE_URL", driver };
  }

  const absent = (["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const).filter(
    (name) => !read(name)
  );
  if (absent.length > 0) {
    missing.push(
      `DATABASE_URL — or every PG* variable instead (PGHOST, PGPORT, PGUSER, ` +
        `PGPASSWORD, PGDATABASE); currently missing: ${absent.join(", ")}`
    );
    return { connectionString: "", source: "PG_VARS", driver };
  }

  const password = encodeURIComponent(read("PGPASSWORD")!);
  const port = read("PGPORT") ?? "5432";
  const connectionString =
    `postgresql://${read("PGUSER")}:${password}@${read("PGHOST")}:${port}/${read("PGDATABASE")}`;
  return { connectionString, source: "PG_VARS", driver };
}

/**
 * `GCS_SERVICE_ACCOUNT_KEY` holds the key file's JSON, either verbatim or
 * base64-encoded — the encoded form is what survives secret managers and CI
 * variables that mangle newlines in `private_key`.
 */
function resolveServiceAccount(): ServiceAccountKey | undefined {
  const raw = read("GCS_SERVICE_ACCOUNT_KEY");
  if (!raw) return undefined;

  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  let parsed: { client_email?: string; private_key?: string; project_id?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(
      "GCS_SERVICE_ACCOUNT_KEY is not valid JSON. Supply the service-account key " +
        "file's contents, either verbatim or base64-encoded."
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "GCS_SERVICE_ACCOUNT_KEY is missing client_email or private_key — it does " +
        "not look like a service-account key file."
    );
  }

  return {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
    projectId: parsed.project_id,
  };
}

function resolveObjectStorage(missing: string[]): ObjectStorageConfig {
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

  const serviceAccount = resolveServiceAccount();
  return {
    privateDir: privateDir ?? "",
    publicSearchPaths,
    serviceAccount,
    projectId: read("GCS_PROJECT_ID") ?? serviceAccount?.projectId,
  };
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

  const missing: string[] = [];
  const database = resolveDatabase(missing);
  const objectStorage = resolveObjectStorage(missing);

  const sessionSecret = read("SESSION_SECRET");
  if (!sessionSecret) {
    missing.push("SESSION_SECRET — signs session cookies; any long random string");
  }

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
    database,
    sessionSecret: sessionSecret!,
    jwtSecret: read("JWT_SECRET"),
    objectStorage,
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

function storageCredentialMode(): string {
  if (config.objectStorage.serviceAccount) return "service-account key";
  if (read("GOOGLE_APPLICATION_CREDENTIALS")) return "GOOGLE_APPLICATION_CREDENTIALS";
  return "application default credentials";
}

// One boot line describing what this process is configured with. The connection
// string is masked: the password never reaches the log.
console.log(
  `[config] ${config.nodeEnv} — database ${config.database.source} over ${config.database.driver} ` +
    `(${config.database.connectionString.replace(/:([^@/]+)@/, ":<hidden>@")}), ` +
    `object storage via ${storageCredentialMode()}, ` +
    `email ${config.email.apiKey ? "enabled" : "unconfigured"}, ` +
    `OpenAI ${config.openaiApiKey ? "enabled" : "unconfigured"}`
);
