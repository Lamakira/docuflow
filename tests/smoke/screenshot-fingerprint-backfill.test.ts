import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { putObject } from "../fakes/gcs";
import { makeApp } from "../helpers/app";
import { ownerDb, resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { screenPng } from "../helpers/screens";

/** #341. The backfill fingerprints existing captures from storage, resumably and idempotently. */
describe("screenshot fingerprint backfill (#341)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function setup() {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    const { timeEntryScreenshots } = await import("../../shared/schema");

    async function capture(name: string, opts: { object?: Buffer; key?: string; deletedAt?: Date } = {}) {
      const storageKey = opts.key ?? `/objects/ws/${SEEDED_WORKSPACE_ID}/agent-screenshots/${name}.webp`;
      if (opts.object) putObject(`${process.env.PRIVATE_OBJECT_DIR!.slice(1)}${storageKey.slice("/objects".length)}`, opts.object);
      const [row] = await ownerDb
        .insert(timeEntryScreenshots)
        .values({
          workspaceId: SEEDED_WORKSPACE_ID,
          timeEntryId: entry.id,
          userId: user.id,
          crmProjectId: crmProject.id,
          storageKey,
          deletedAt: opts.deletedAt ?? null,
        })
        .returning();
      return row;
    }

    async function hashes() {
      const rows = await ownerDb.select().from(timeEntryScreenshots);
      return Object.fromEntries(rows.map((r) => [r.id, r.perceptualHash]));
    }
    return { capture, hashes };
  }

  it("fills what it can, leaves a missing object null without stopping, and a rerun writes nothing", async () => {
    const { capture, hashes } = await setup();
    const editor = await screenPng("editor");
    const a = await capture("a", { object: editor });
    const gone = await capture("b"); // no object in the bucket
    const garbled = await capture("c", { object: Buffer.from("not an image") });
    const c = await capture("d", { object: await screenPng("browser") });
    const deleted = await capture("e", { object: editor, deletedAt: new Date() });
    const pending = await capture("f", { key: "pending-123" });

    const { backfillAllWorkspaces } = await import("../../scripts/backfill-screenshot-fingerprints");
    const first = await backfillAllWorkspaces({ batchSize: 2 });
    expect(first).toMatchObject({ scanned: 4, written: 2, missing: 2 });

    const after = await hashes();
    expect(after[a.id]).toMatch(/^[0-9a-f]{16}$/);
    expect(after[c.id]).toMatch(/^[0-9a-f]{16}$/);
    expect(after[a.id]).not.toBe(after[c.id]);
    expect(after[gone.id]).toBeNull();
    expect(after[garbled.id]).toBeNull();
    expect(after[deleted.id]).toBeNull();
    expect(after[pending.id]).toBeNull();

    const rerun = await backfillAllWorkspaces({ batchSize: 2 });
    expect(rerun).toMatchObject({ scanned: 2, written: 0, missing: 2 });
    expect(await hashes()).toEqual(after);
  });

  it("picks up a capture whose object appears later", async () => {
    const { capture, hashes } = await setup();
    const late = await capture("late");
    const { backfillAllWorkspaces } = await import("../../scripts/backfill-screenshot-fingerprints");
    expect(await backfillAllWorkspaces()).toMatchObject({ written: 0, missing: 1 });

    putObject(`${process.env.PRIVATE_OBJECT_DIR!.slice(1)}/ws/${SEEDED_WORKSPACE_ID}/agent-screenshots/late.webp`, await screenPng("editor"));
    expect(await backfillAllWorkspaces()).toMatchObject({ written: 1, missing: 0 });
    expect((await hashes())[late.id]).toMatch(/^[0-9a-f]{16}$/);
  });
});
