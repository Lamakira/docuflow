import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CLIENTS_READ_CAPABILITY_ID } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";

/**
 * Phase 9 ticket #163: the MCP companion authenticates as a Service Account
 * against `/api/v1` (ADR-0011, ADR-0017, ADR-0018). Owner impersonation via
 * `X-API-Key` / `MCP_API_KEY` stays gone (#111).
 *
 * Seams: HTTP `/api/v1` plus guarded `/api/*` for the Service Account path;
 * `mcp-server/index.ts` as a separate STDIO process the harness does not boot
 * (same class of check as `desktop-release-workflow`: a credential boundary
 * that is not an Express route). Config already refuses `MCP_API_KEY`
 * impersonation in `tests/smoke/config.test.ts`.
 */

const COMPANION = join(__dirname, "../../mcp-server/index.ts");
const companionSource = readFileSync(COMPANION, "utf8");

function companionApiPaths(source: string): string[] {
  return [...source.matchAll(/["'`](\/api\/[^"'`?]+)/g)].map((match) => match[1]);
}

describe("MCP companion source is the Service Account path (#163)", () => {
  it("does not set X-API-Key", () => {
    expect(companionSource).not.toMatch(/X-API-Key/i);
  });

  it("sends Authorization Bearer from DOCUFLOW_API_KEY and only calls /api/v1", () => {
    expect(companionSource).toMatch(/DOCUFLOW_API_KEY/);
    expect(companionSource).toMatch(/Authorization["'`\s:,]+Bearer/);

    const paths = companionApiPaths(companionSource);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith("/api/v1"), path).toBe(true);
    }
  });
});

describe("MCP companion HTTP path (#163)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets a Service Account key call an allowlisted /api/v1 read; the same key as X-API-Key on guarded /api/* is 401", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({
      name: "MCP companion",
      capabilityIds: [CLIENTS_READ_CAPABILITY_ID],
    });
    expect(created.status).toBe(201);
    const key = created.body.plaintextKey as string;

    const asCompanion = await newAgent(app)
      .get("/api/v1/clients")
      .set("Authorization", `Bearer ${key}`);
    expect(asCompanion.status).toBe(200);
    expect(asCompanion.body).toEqual({ data: [], nextCursor: null });

    const asLegacyHeader = await newAgent(app)
      .get("/api/admin/users")
      .set("x-api-key", key);
    expect(asLegacyHeader.status).toBe(401);
    expect(asLegacyHeader.body).toEqual({ message: "Unauthorized" });
  });
});
