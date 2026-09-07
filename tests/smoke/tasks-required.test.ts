import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { registerUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCrmProject } from "../helpers/fixtures";

/**
 * Phase 9 ticket #163: `detectMigrationFlags` / `isTasksEnabled` were a boot
 * probe for a `tasks` table the journal has required for a long time. They are
 * removed, not replaced. Task routes must not 503 on a migrated database.
 *
 * Seam is HTTP `/api/tasks` and `/api/time-tracking/capabilities`, plus the
 * absence of `server/migrationFlags.ts`.
 */

const FLAGS = join(__dirname, "../../server/migrationFlags.ts");

describe("task routes on a migrated database (#163)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("does not ship detectMigrationFlags or isTasksEnabled", () => {
    expect(existsSync(FLAGS)).toBe(false);
  });

  it("creates a Task instead of answering 503", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);

    const created = await user.agent
      .post("/api/tasks")
      .send({ crmProjectId: crmProject.id, name: "Draft the brief" });

    expect(created.status).not.toBe(503);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      crmProjectId: crmProject.id,
      name: "Draft the brief",
      status: "open",
    });

    const capabilities = await user.agent.get("/api/time-tracking/capabilities");
    expect(capabilities.status).toBe(200);
    expect(capabilities.body).toEqual({ requiresTask: true });
  });
});
