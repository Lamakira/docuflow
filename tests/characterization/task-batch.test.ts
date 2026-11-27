import { beforeEach, describe, expect, it } from "vitest";
import {
  TASK_BATCH_MAX,
  TASK_NAME_MAX,
  planTaskBatch,
  taskBatchNotice,
  taskLines,
} from "../../shared/taskBatch";
import { eq } from "drizzle-orm";
import { SEEDED_WORKSPACE_ID, workspaceBilling } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { registerUser, setWorkspaceRole } from "../helpers/auth";
import { ownerDb, resetDb } from "../helpers/db";
import { createCrmProject, createTask } from "../helpers/fixtures";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * #399: several Tasks at once, one per line. The rules live in
 * `shared/taskBatch.ts` so the web screens and `POST /api/tasks/batch` apply
 * the same ones.
 */
describe("the batch rules (#399)", () => {
  it("splits on every newline kind and keeps blank lines, so line numbers match the textarea", () => {
    expect(taskLines("a\nb\r\nc\rd")).toEqual(["a", "b", "c", "d"]);
    expect(taskLines("a\n\n b ")).toEqual(["a", "", " b "]);
  });

  it("makes one Task per non-empty line, trimmed, blank lines ignored", () => {
    expect(planTaskBatch(["  Survey the site ", "", "   ", "Write the runbook"])).toEqual({
      ok: true,
      names: ["Survey the site", "Write the runbook"],
      skipped: 0,
    });
  });

  it("skips a line repeated in the paste, compared trimmed and case-insensitive, keeping the first", () => {
    expect(planTaskBatch(["Survey", " survey ", "SURVEY", "Runbook"])).toEqual({
      ok: true,
      names: ["Survey", "Runbook"],
      skipped: 2,
    });
  });

  it("skips a line matching an existing Task of the Project, open or archived", () => {
    expect(planTaskBatch(["survey", "Runbook", "Train"], ["  Survey ", "TRAIN"])).toEqual({
      ok: true,
      names: ["Runbook"],
      skipped: 2,
    });
  });

  it("answers with nothing to create when every line is already on the Project", () => {
    expect(planTaskBatch(["Survey"], ["survey"])).toEqual({ ok: true, names: [], skipped: 1 });
  });

  it("refuses no name at all", () => {
    const plan = planTaskBatch(["", "  "]);
    expect(plan.ok).toBe(false);
  });

  it(`allows ${TASK_BATCH_MAX} lines and refuses one more, saying the limit`, () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `Task ${index + 1}`);
    expect(planTaskBatch(lines(TASK_BATCH_MAX)).ok).toBe(true);
    // Blank lines do not count against the limit.
    expect(planTaskBatch([...lines(TASK_BATCH_MAX), "", " "]).ok).toBe(true);

    const refused = planTaskBatch(lines(TASK_BATCH_MAX + 1));
    expect(refused).toEqual({
      ok: false,
      message: `Create at most ${TASK_BATCH_MAX} Tasks at a time. This list has ${TASK_BATCH_MAX + 1}.`,
    });
  });

  it("refuses the whole batch when one line is too long, naming that line as the textarea counts it", () => {
    const long = "x".repeat(TASK_NAME_MAX + 1);
    expect(planTaskBatch(["x".repeat(TASK_NAME_MAX)]).ok).toBe(true);
    // Surrounding spaces are trimmed before measuring.
    expect(planTaskBatch([` ${"x".repeat(TASK_NAME_MAX)} `]).ok).toBe(true);

    expect(planTaskBatch(["Survey", "", long, "Runbook"])).toEqual({
      ok: false,
      message: `Line 3 is longer than ${TASK_NAME_MAX} characters. Shorten it, then create the Tasks again.`,
    });
  });

  it("gives the count, and keeps today's words for one Task", () => {
    expect(taskBatchNotice(1, 0)).toBe("Task created");
    expect(taskBatchNotice(1, 1)).toBe("1 Task created, 1 duplicate skipped");
    expect(taskBatchNotice(5, 0)).toBe("5 Tasks created");
    expect(taskBatchNotice(5, 1)).toBe("5 Tasks created, 1 duplicate skipped");
    expect(taskBatchNotice(3, 2)).toBe("3 Tasks created, 2 duplicates skipped");
  });
});

describe("POST /api/tasks/batch (#399)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  type Row = { name: string; status: string };
  const listAll = async (agent: any, crmProjectId: string): Promise<Row[]> =>
    (await agent.get("/api/tasks").query({ crmProjectId, includeArchived: "true" })).body.data;
  const namesOf = (rows: Row[]) => rows.map((t) => t.name);

  async function setup() {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    return { app, user, crmProjectId: crmProject.id as string };
  }

  it("creates the new lines in paste order and skips what the Project already has, archived included", async () => {
    const { user, crmProjectId } = await setup();
    const existing = await createTask(user.agent, crmProjectId, "Survey the site");
    await user.agent.patch(`/api/tasks/${existing.id}`).send({ status: "archived" });

    const res = await user.agent
      .post("/api/tasks/batch")
      .send({
        crmProjectId,
        names: ["Draft the brief", "", "  survey the SITE ", "Write the runbook", "Train the supervisors"],
      });

    expect(res.status).toBe(201);
    expect(res.body.skipped).toBe(1);
    expect(namesOf(res.body.data)).toEqual(["Draft the brief", "Write the runbook", "Train the supervisors"]);
    expect(res.body.data.every((t: Row) => t.status === "open")).toBe(true);
    expect(namesOf(await listAll(user.agent, crmProjectId))).toEqual([
      "Survey the site",
      "Draft the brief",
      "Write the runbook",
      "Train the supervisors",
    ]);
  });

  it("skips a line repeated within the paste", async () => {
    const { user, crmProjectId } = await setup();
    const res = await user.agent.post("/api/tasks/batch").send({ crmProjectId, names: ["Alpha", "alpha "] });
    expect(res.status).toBe(201);
    expect(namesOf(res.body.data)).toEqual(["Alpha"]);
    expect(res.body.skipped).toBe(1);
  });

  it("writes nothing when every line is already on the Project", async () => {
    const { user, crmProjectId } = await setup();
    await createTask(user.agent, crmProjectId, "One");
    await createTask(user.agent, crmProjectId, "Two");
    const res = await user.agent.post("/api/tasks/batch").send({ crmProjectId, names: ["one", "TWO"] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: [], skipped: 2 });
    expect(await listAll(user.agent, crmProjectId)).toHaveLength(2);
  });

  it("refuses more than the limit, and writes nothing", async () => {
    const { user, crmProjectId } = await setup();
    const names = Array.from({ length: TASK_BATCH_MAX + 1 }, (_, i) => `Task ${i}`);
    const res = await user.agent.post("/api/tasks/batch").send({ crmProjectId, names });
    const expected = planTaskBatch(names);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: expected.ok ? "" : expected.message });
    expect(await listAll(user.agent, crmProjectId)).toHaveLength(0);
  });

  it("refuses a too-long line naming its line number, and writes nothing", async () => {
    const { user, crmProjectId } = await setup();
    const res = await user.agent
      .post("/api/tasks/batch")
      .send({ crmProjectId, names: ["Fine", "", "x".repeat(TASK_NAME_MAX + 1), "Also fine"] });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Line 3");
    expect(await listAll(user.agent, crmProjectId)).toHaveLength(0);
  });

  it("refuses a list with no name", async () => {
    const { user, crmProjectId } = await setup();
    const res = await user.agent.post("/api/tasks/batch").send({ crmProjectId, names: ["", "  "] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Name at least one Task." });
  });

  it("refuses a malformed body", async () => {
    const { user, crmProjectId } = await setup();
    for (const body of [
      { crmProjectId },
      { crmProjectId, names: "Alpha\nBeta" },
      { crmProjectId, names: ["Alpha", 7] },
      { names: ["Alpha"] },
    ]) {
      const res = await user.agent.post("/api/tasks/batch").send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: "crmProjectId and names are required" });
    }
    expect(await listAll(user.agent, crmProjectId)).toHaveLength(0);
  });

  it("answers a Member who is not on the Project as if it were not there", async () => {
    const { app, user, crmProjectId } = await setup();
    const outsider = await registerUser(app);
    const res = await outsider.agent.post("/api/tasks/batch").send({ crmProjectId, names: ["Sneaky"] });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Project not found" });
    expect(await listAll(user.agent, crmProjectId)).toHaveLength(0);
  });

  it("rolls the whole batch back when one row fails to insert", async () => {
    const { user, crmProjectId } = await setup();
    const { storage } = await import("../../server/storage");
    await expect(
      inSeededWorkspace(() =>
        storage.createTaskBatch(crmProjectId, () => ({ ok: true, names: ["Valid", "x".repeat(300)], skipped: 0 })),
      ),
    ).rejects.toThrow();
    expect(await listAll(user.agent, crmProjectId)).toHaveLength(0);
  });

  it("is refused for a Read-only Workspace, and writes nothing", async () => {
    const { user, crmProjectId } = await setup();
    await setWorkspaceRole(user.id, "owner");
    await ownerDb
      .update(workspaceBilling)
      .set({ billingState: "ReadOnly" })
      .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
    const res = await user.agent.post("/api/tasks/batch").send({ crmProjectId, names: ["Late"] });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "Workspace is read-only" });
    await ownerDb
      .update(workspaceBilling)
      .set({ billingState: "Active" })
      .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
    expect(await listAll(user.agent, crmProjectId)).toHaveLength(0);
  });
});
