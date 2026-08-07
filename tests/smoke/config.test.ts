import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `server/config.ts` resolves the whole environment once, at import — so every
 * case here builds an environment, drops the module registry, and imports the
 * module again, which is exactly the sequence a boot performs.
 *
 * The rest of the harness cannot reach these paths: `tests/setup.ts` fixes a
 * complete, valid environment before any server module loads, which is what
 * every other suite needs and what leaves the failure branches unexercised.
 */

/** Every variable `server/config.ts` reads. Cleared before each case. */
const CONFIG_VARS = [
  "NODE_ENV",
  "PORT",
  "DB_DRIVER",
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "SESSION_SECRET",
  "JWT_SECRET",
  "JWT_PREVIOUS_SECRET",
  "PRIVATE_OBJECT_DIR",
  "PUBLIC_OBJECT_SEARCH_PATHS",
  "GCS_SERVICE_ACCOUNT_KEY",
  "GCS_PROJECT_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "APP_URL",
  "REPLIT_DOMAINS",
  "REPLIT_DEV_DOMAIN",
  "OPENAI_API_KEY",
  "FATHOM_API_KEY",
  "REPL_ID",
  "ISSUER_URL",
] as const;

/** The smallest environment that boots: one of each required variable. */
const BOOTABLE = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://docuflow:pa55w0rd@localhost:5432/docuflow",
  SESSION_SECRET: "test-session-secret",
  JWT_SECRET: "2026-08:current-signing-secret",
  PRIVATE_OBJECT_DIR: "/test-bucket/.private",
  PUBLIC_OBJECT_SEARCH_PATHS: "/test-bucket/public",
  // The cheaper of the two storage credentials to name: a path, never opened here.
  GOOGLE_APPLICATION_CREDENTIALS: "/etc/docuflow/key.json",
};

/** A structurally valid service-account key with no real credential in it (ADR-0018). */
const SERVICE_ACCOUNT_KEY = {
  client_email: "installer@example-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
  project_id: "example-project",
};

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(CONFIG_VARS.map((name) => [name, process.env[name]]));
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  // Leave the registry holding the harness's own configuration, not a case's.
  vi.resetModules();
});

async function load(env: Record<string, string | undefined>) {
  for (const name of CONFIG_VARS) delete process.env[name];
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) process.env[name] = value;
  }
  vi.resetModules();
  return import("../../server/config");
}

describe("config — required variables", () => {
  it("boots on the smallest valid environment", async () => {
    const { config } = await load(BOOTABLE);

    expect(config.database.connectionString).toBe(BOOTABLE.DATABASE_URL);
    expect(config.database.source).toBe("DATABASE_URL");
    expect(config.sessionSecret).toBe("test-session-secret");
    expect(config.desktopTokens.current).toEqual({
      id: "2026-08",
      secret: "current-signing-secret",
    });
    expect(config.desktopTokens.previous).toBeUndefined();
    expect(config.objectStorage.privateDir).toBe("/test-bucket/.private");
    expect(config.objectStorage.publicSearchPaths).toEqual(["/test-bucket/public"]);
  });

  it("names every missing variable in one failure, not just the first", async () => {
    const error = await load({ NODE_ENV: "test" }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("Configuration incomplete");
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("SESSION_SECRET");
    expect(message).toContain("PRIVATE_OBJECT_DIR");
    expect(message).toContain("PUBLIC_OBJECT_SEARCH_PATHS");
    expect(message).toContain("GCS_SERVICE_ACCOUNT_KEY");
    expect(message).toContain("JWT_SECRET");
    expect(message).toContain(".env.example");
  });

  it("refuses to boot when neither storage credential is supplied", async () => {
    const error = await load({
      ...BOOTABLE,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
    }).catch((e: Error) => e);

    // The mode the app cannot detect is the one it must not start in: without a
    // credential the first signed URL fails inside the SDK, hours after boot.
    const message = (error as Error).message;
    expect(message).toContain("GCS_SERVICE_ACCOUNT_KEY");
    expect(message).toContain("GOOGLE_APPLICATION_CREDENTIALS");
  });

  // BOOTABLE covers the other credential: it names a key file and nothing else.
  it("boots on the inline service-account key alone", async () => {
    const { config } = await load({
      ...BOOTABLE,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      GCS_SERVICE_ACCOUNT_KEY: JSON.stringify(SERVICE_ACCOUNT_KEY),
    });

    expect(config.objectStorage.serviceAccount?.clientEmail).toBe(
      SERVICE_ACCOUNT_KEY.client_email
    );
  });

  it("reports which PG* variables are absent when DATABASE_URL is not the source", async () => {
    const error = await load({
      ...BOOTABLE,
      DATABASE_URL: undefined,
      PGHOST: "localhost",
      PGUSER: "docuflow",
    }).catch((e: Error) => e);

    expect((error as Error).message).toContain("currently missing: PGPASSWORD, PGDATABASE");
  });

  it("treats a whitespace-only value as unset", async () => {
    const error = await load({ ...BOOTABLE, SESSION_SECRET: "   " }).catch((e: Error) => e);

    expect((error as Error).message).toContain("SESSION_SECRET");
  });
});

describe("config — database", () => {
  it("assembles the PG* variables, encoding the password and defaulting the port", async () => {
    const { config } = await load({
      ...BOOTABLE,
      DATABASE_URL: undefined,
      PGHOST: "db.internal",
      PGUSER: "docuflow",
      PGPASSWORD: "p@ss/word",
      PGDATABASE: "docuflow_dev",
    });

    expect(config.database.source).toBe("PG_VARS");
    expect(config.database.connectionString).toBe(
      "postgresql://docuflow:p%40ss%2Fword@db.internal:5432/docuflow_dev"
    );
  });

  it("prefers DATABASE_URL over a complete set of PG* variables", async () => {
    const { config } = await load({
      ...BOOTABLE,
      PGHOST: "db.internal",
      PGUSER: "docuflow",
      PGPASSWORD: "ignored",
      PGDATABASE: "ignored",
      PGPORT: "6543",
    });

    expect(config.database.source).toBe("DATABASE_URL");
    expect(config.database.connectionString).toBe(BOOTABLE.DATABASE_URL);
  });

  it("selects node-postgres only when DB_DRIVER says so", async () => {
    expect((await load(BOOTABLE)).config.database.driver).toBe("neon");
    expect((await load({ ...BOOTABLE, DB_DRIVER: "pg" })).config.database.driver).toBe("pg");
    expect((await load({ ...BOOTABLE, DB_DRIVER: "postgres" })).config.database.driver).toBe("neon");
  });
});

describe("config — service-account key", () => {
  it("accepts the key file's JSON verbatim", async () => {
    const { config } = await load({
      ...BOOTABLE,
      GCS_SERVICE_ACCOUNT_KEY: JSON.stringify(SERVICE_ACCOUNT_KEY),
    });

    expect(config.objectStorage.serviceAccount).toEqual({
      clientEmail: SERVICE_ACCOUNT_KEY.client_email,
      privateKey: SERVICE_ACCOUNT_KEY.private_key,
      projectId: SERVICE_ACCOUNT_KEY.project_id,
    });
  });

  it("accepts the same key base64-encoded, newlines in private_key intact", async () => {
    const { config } = await load({
      ...BOOTABLE,
      GCS_SERVICE_ACCOUNT_KEY: Buffer.from(JSON.stringify(SERVICE_ACCOUNT_KEY)).toString("base64"),
    });

    expect(config.objectStorage.serviceAccount?.privateKey).toBe(SERVICE_ACCOUNT_KEY.private_key);
  });

  it("leaves the service account absent when the variable is unset", async () => {
    const { config } = await load(BOOTABLE);

    expect(config.objectStorage.serviceAccount).toBeUndefined();
  });

  it("rejects a value that is not JSON, naming the variable", async () => {
    const error = await load({
      ...BOOTABLE,
      GCS_SERVICE_ACCOUNT_KEY: "{not json at all",
    }).catch((e: Error) => e);

    expect((error as Error).message).toContain("GCS_SERVICE_ACCOUNT_KEY is not valid JSON");
  });

  it("rejects JSON that is not a service-account key", async () => {
    const error = await load({
      ...BOOTABLE,
      GCS_SERVICE_ACCOUNT_KEY: JSON.stringify({ client_email: "a@b.example" }),
    }).catch((e: Error) => e);

    expect((error as Error).message).toContain("missing client_email or private_key");
  });

  it("takes the project from GCS_PROJECT_ID, falling back to the key's", async () => {
    const fromKey = await load({
      ...BOOTABLE,
      GCS_SERVICE_ACCOUNT_KEY: JSON.stringify(SERVICE_ACCOUNT_KEY),
    });
    expect(fromKey.config.objectStorage.projectId).toBe("example-project");

    const overridden = await load({
      ...BOOTABLE,
      GCS_SERVICE_ACCOUNT_KEY: JSON.stringify(SERVICE_ACCOUNT_KEY),
      GCS_PROJECT_ID: "other-project",
    });
    expect(overridden.config.objectStorage.projectId).toBe("other-project");
  });
});

describe("config — desktop token signing keys", () => {
  it("refuses to boot without a signing key, and says what one looks like", async () => {
    const error = await load({ ...BOOTABLE, JWT_SECRET: undefined }).catch((e: Error) => e);

    // The point of the whole variable: a key this process invented would not
    // survive the process, and neither would any token signed with it.
    const message = (error as Error).message;
    expect(message).toContain("JWT_SECRET");
    expect(message).toContain("<key-id>:<secret>");
  });

  it("splits on the first colon, so a secret may contain one", async () => {
    const { config } = await load({ ...BOOTABLE, JWT_SECRET: "2026-08:head:tail" });

    expect(config.desktopTokens.current).toEqual({ id: "2026-08", secret: "head:tail" });
  });

  it("accepts a previous key alongside the current one", async () => {
    const { config } = await load({
      ...BOOTABLE,
      JWT_PREVIOUS_SECRET: "2026-05:retiring-signing-secret",
    });

    expect(config.desktopTokens.current.id).toBe("2026-08");
    expect(config.desktopTokens.previous).toEqual({
      id: "2026-05",
      secret: "retiring-signing-secret",
    });
  });

  it("rejects a key that is not id-and-secret, naming the variable", async () => {
    for (const [variable, value] of [
      ["JWT_SECRET", "just-a-bare-secret"], // the pre-versioning form
      ["JWT_SECRET", ":secret-with-no-id"],
      ["JWT_SECRET", "2026-08:"], // an id and nothing to sign with
      ["JWT_SECRET", "an id with spaces:secret"], // would not survive a token header
    ] as const) {
      const error = await load({ ...BOOTABLE, [variable]: value }).catch((e: Error) => e);
      expect((error as Error).message, value).toContain(`${variable} must be written as`);
    }

    const previous = await load({
      ...BOOTABLE,
      JWT_PREVIOUS_SECRET: "no-id-here",
    }).catch((e: Error) => e);
    expect((previous as Error).message).toContain("JWT_PREVIOUS_SECRET must be written as");
  });

  it("refuses two keys answering to the same id", async () => {
    const error = await load({
      ...BOOTABLE,
      JWT_PREVIOUS_SECRET: "2026-08:the-secret-being-retired",
    }).catch((e: Error) => e);

    // A token's `kid` would then name both, which is the one question it exists
    // to answer.
    expect((error as Error).message).toContain('both name the key "2026-08"');
  });

  it("names the keys, and never the secrets, on the boot line", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const rotating = await load({
        ...BOOTABLE,
        JWT_PREVIOUS_SECRET: "2026-05:retiring-signing-secret",
      });
      rotating.logConfigSummary();

      const line = spy.mock.calls.flat().join("\n");
      expect(line).toContain("desktop tokens on key 2026-08, retiring 2026-05");
      expect(line).not.toContain("current-signing-secret");
      expect(line).not.toContain("retiring-signing-secret");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("config — app URL", () => {
  it("uses APP_URL, without its trailing slashes", async () => {
    const { config } = await load({ ...BOOTABLE, APP_URL: "https://docuflow.example.com//" });

    expect(config.appUrl).toBe("https://docuflow.example.com");
  });

  it("falls back to the first Replit domain, then the dev domain, then localhost", async () => {
    const domains = await load({
      ...BOOTABLE,
      REPLIT_DOMAINS: "first.replit.app,second.replit.app",
      REPLIT_DEV_DOMAIN: "dev.replit.dev",
    });
    expect(domains.config.appUrl).toBe("https://first.replit.app");

    const devOnly = await load({ ...BOOTABLE, REPLIT_DEV_DOMAIN: "dev.replit.dev" });
    expect(devOnly.config.appUrl).toBe("https://dev.replit.dev");

    const neither = await load(BOOTABLE);
    expect(neither.config.appUrl).toBe("http://localhost:5000");
  });

  it("lets APP_URL win over the Replit domains", async () => {
    const { config } = await load({
      ...BOOTABLE,
      APP_URL: "https://docuflow.example.com",
      REPLIT_DOMAINS: "first.replit.app",
    });

    expect(config.appUrl).toBe("https://docuflow.example.com");
  });
});

describe("config — boot summary", () => {
  it("stays silent on import, so loading config never writes to a log", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await load(BOOTABLE);
      expect(spy.mock.calls.flat().join("\n")).not.toContain("[config]");
    } finally {
      spy.mockRestore();
    }
  });

  it("masks the database password when the entry point asks for the summary", async () => {
    const { logConfigSummary } = await load(BOOTABLE);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logConfigSummary();
      const line = spy.mock.calls.flat().join("\n");
      expect(line).toContain("[config]");
      expect(line).toContain("postgresql://docuflow:<hidden>@localhost:5432/docuflow");
      expect(line).not.toContain("pa55w0rd");
    } finally {
      spy.mockRestore();
    }
  });

  it("reports which of the two storage credential modes is in use", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const keyFile = await load(BOOTABLE);
      keyFile.logConfigSummary();
      expect(spy.mock.calls.flat().join("\n")).toContain("GOOGLE_APPLICATION_CREDENTIALS");

      spy.mockClear();
      const inline = await load({
        ...BOOTABLE,
        GOOGLE_APPLICATION_CREDENTIALS: undefined,
        GCS_SERVICE_ACCOUNT_KEY: JSON.stringify(SERVICE_ACCOUNT_KEY),
      });
      inline.logConfigSummary();
      expect(spy.mock.calls.flat().join("\n")).toContain("service-account key");
    } finally {
      spy.mockRestore();
    }
  });
});
