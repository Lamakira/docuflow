import { describe, expect, it } from "vitest";

/**
 * Phase 6 ticket #113: ADR-0008 module layout. Each named module owns a
 * persistence interface. `routes.ts` / `storage.ts` are thin adapters.
 * HTTP characterization is not this suite — this file is the layout seam.
 *
 * Catalog import is dynamic: `tests/README.md` keeps server modules off the
 * test file's top-level graph so `server/config.ts` cannot resolve too early.
 */

const MODULE_IDS = [
  "identity",
  "workspace",
  "clients-sales",
  "projects",
  "time",
  "activity",
  "knowledge",
  "billing",
  "notifications",
  "intelligence",
] as const;

const SHELLS = [
  "identity",
  "workspace",
  "billing",
  "notifications",
  "intelligence",
] as const;

/** Tables later tickets carve into Clients & Sales, Projects, Time, Activity, Knowledge. */
const OPERATIONAL_TABLES = [
  "crm_clients",
  "crm_contacts",
  "opportunities",
  "crm_projects",
  "projects",
  "tasks",
  "project_members",
  "time_entries",
  "timer_commands",
  "time_entry_screenshots",
  "documents",
  "company_documents",
  "files",
] as const;

async function loadCatalog() {
  return import("../../server/modules");
}

describe("domain module layout", () => {
  it("names every ADR-0008 module including Intelligence", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    expect(DOMAIN_MODULES.map((mod) => mod.id)).toEqual([...MODULE_IDS]);
  });

  it("gives each module a persistence interface, not a string label", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    for (const mod of DOMAIN_MODULES) {
      expect(mod.persistence, `${mod.id} must export a persistence interface`).toBeDefined();
      expect(
        typeof mod.persistence,
        `${mod.id} persistence must be the interface, not a string label`
      ).toBe("object");
    }
  });

  it("assigns each table to at most one module", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    const owner = new Map<string, string>();
    for (const mod of DOMAIN_MODULES) {
      for (const table of mod.tables) {
        const previous = owner.get(table);
        expect(previous, `${table} owned by both ${previous} and ${mod.id}`).toBeUndefined();
        owner.set(table, mod.id);
      }
    }
  });

  it("does not let Identity, Workspace, Billing, Notifications, or Intelligence own another module's operational tables", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    const byId = new Map(DOMAIN_MODULES.map((mod) => [mod.id, mod.tables]));
    expect(byId.get("billing")).toEqual([]);

    for (const id of SHELLS) {
      const tables = byId.get(id) ?? [];
      for (const table of OPERATIONAL_TABLES) {
        expect(tables, `${id} must not own ${table}`).not.toContain(table);
      }
    }
  });

  it("leaves jobs infrastructure outside domain modules", async () => {
    const { DOMAIN_MODULES, INFRASTRUCTURE_TABLES } = await loadCatalog();
    const owned = new Set(DOMAIN_MODULES.flatMap((mod) => [...mod.tables]));
    for (const table of INFRASTRUCTURE_TABLES) {
      expect(owned, `${table} is the jobs/runtime port, not a domain module`).not.toContain(table);
    }
  });

  it("puts sales, delivery, time, evidence, and knowledge tables on their modules", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    const byId = new Map(DOMAIN_MODULES.map((mod) => [mod.id, mod.tables]));
    expect(byId.get("clients-sales")).toEqual(
      expect.arrayContaining(["crm_clients", "crm_contacts", "opportunities"])
    );
    expect(byId.get("clients-sales")).not.toContain("crm_projects");
    expect(byId.get("projects")).toEqual(
      expect.arrayContaining(["projects", "crm_projects", "tasks", "project_members"])
    );
    expect(byId.get("time")).toEqual(expect.arrayContaining(["time_entries", "timer_commands"]));
    expect(byId.get("activity")).toEqual(
      expect.arrayContaining(["time_entry_screenshots", "agent_activity_events"])
    );
    expect(byId.get("knowledge")).toEqual(
      expect.arrayContaining(["documents", "company_documents", "files", "audio_recordings"])
    );
    expect(byId.get("notifications")).toEqual(["notifications"]);
    expect(byId.get("intelligence")).toEqual(
      expect.arrayContaining(["document_embeddings", "company_document_embeddings"])
    );
  });

  it("leaves Billing persistence empty until Phase 8", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    const billing = DOMAIN_MODULES.find((mod) => mod.id === "billing");
    const persistence = billing?.persistence;
    expect(typeof persistence, "billing is a shell, not a string label").toBe("object");
    expect(Object.keys(persistence as object), "billing must not own another module's APIs").toEqual(
      []
    );
  });

  it("gives Intelligence the Index Artifact APIs", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    const intelligence = DOMAIN_MODULES.find((mod) => mod.id === "intelligence");
    expect(Object.keys(intelligence?.persistence as object).sort()).toEqual([
      "deleteIndexArtifacts",
      "listIndexArtifacts",
      "rebuildIndexArtifacts",
    ]);
  });

  it("gives Activity Tracking Policy and Activity Evidence APIs, not Time", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    const activity = DOMAIN_MODULES.find((mod) => mod.id === "activity");
    const time = DOMAIN_MODULES.find((mod) => mod.id === "time");
    const activityKeys = Object.keys(activity?.persistence as object);
    expect(activityKeys).toEqual(
      expect.arrayContaining([
        "getScreenshotPolicy",
        "upsertScreenshotPolicy",
        "createTimeEntryScreenshot",
        "getTimeEntryScreenshotById",
        "getTimeEntryScreenshots",
        "createAgentActivityEvents",
      ])
    );
    const timeKeys = Object.keys(time?.persistence as object);
    expect(timeKeys).not.toContain("getScreenshotPolicy");
    expect(timeKeys).not.toContain("upsertScreenshotPolicy");
    expect(timeKeys).not.toContain("createTimeEntryScreenshot");
    expect(timeKeys).toEqual(
      expect.arrayContaining([
        "getAllowedTimezones",
        "upsertAllowedTimezones",
        "applyTimerCommand",
        "listTimerCommands",
      ])
    );
  });

  it("leaves org_settings unowned because Activity and Time both persist policy there", async () => {
    const { DOMAIN_MODULES } = await loadCatalog();
    const owned = new Set(DOMAIN_MODULES.flatMap((mod) => [...mod.tables]));
    expect(owned.has("org_settings")).toBe(false);
  });
});
