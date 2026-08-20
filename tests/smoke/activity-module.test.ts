import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 6 ticket #118: Tracking Policy and Activity Evidence live in the
 * Activity module (ADR-0008, Spec #112). HTTP is not this suite — the module
 * persistence interface and the Phase 3 jobs port are the seams.
 * Characterization stays green unless an HTTP contract actually changes.
 */

async function seedTrackedWork() {
  const { storage } = await import("../../server/storage");
  const user = await storage.createUser({
    email: "ada@test.invalid",
    password: "not-a-real-hash",
    firstName: "Ada",
  });
  return inSeededWorkspace(async () => {
    const { crmProject } = await storage.createCrmProjectWithBase({
      name: "Atlas",
      ownerId: user.id,
    });
    const task = await storage.createTask({
      crmProjectId: crmProject.id,
      name: "Ledger rebuild",
    });
    const entry = await storage.createTimeEntry({
      userId: user.id,
      crmProjectId: crmProject.id,
      taskId: task.id,
      description: "Evidence provenance",
      startTime: new Date("2026-08-18T10:00:00.000Z"),
      status: "running",
      lastActivityAt: new Date("2026-08-18T10:00:00.000Z"),
    });
    const device = await storage.createDevice({
      userId: user.id,
      name: "Ada laptop",
      deviceTokenHash: "token-hash-ada",
    });
    return { storage, user, crmProject, task, entry, device };
  });
}

describe("Activity module (Tracking Policy and Activity Evidence)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reads and writes Tracking Policy through Activity, and fails closed without WorkspaceContext", async () => {
    const { getScreenshotPolicy, upsertScreenshotPolicy } = await import(
      "../../server/modules/activity/policy"
    );
    const { MissingWorkspaceContextError } = await import("../../server/workspaceContext");

    await expect(getScreenshotPolicy()).rejects.toThrow(MissingWorkspaceContextError);
    await expect(
      upsertScreenshotPolicy({ screenshotsEnabled: false, idleTimeoutMinutes: 15 })
    ).rejects.toThrow(MissingWorkspaceContextError);

    await inSeededWorkspace(() =>
      upsertScreenshotPolicy({
        screenshotsEnabled: false,
        captureIntervalMinMin: 4,
        captureIntervalMaxMin: 8,
        idlePromptEnabled: false,
        idleTimeoutMinutes: 15,
      })
    );

    const read = await inSeededWorkspace(() => getScreenshotPolicy());
    expect(read).toMatchObject({
      screenshotsEnabled: false,
      captureIntervalMinMin: 4,
      captureIntervalMaxMin: 8,
      idlePromptEnabled: false,
      idleTimeoutMinutes: 15,
    });
  });

  it("stores and queries Activity Evidence with Project and task provenance", async () => {
    const { user, crmProject, task, entry } = await seedTrackedWork();
    const {
      createTimeEntryScreenshot,
      getActivityEvidence,
    } = await import("../../server/modules/activity/evidence");

    const screenshot = await inSeededWorkspace(() =>
      createTimeEntryScreenshot({
        timeEntryId: entry.id,
        userId: user.id,
        crmProjectId: crmProject.id,
        storageKey: "/objects/agent-screenshots/shot.webp",
        capturedAt: new Date("2026-08-18T10:05:00.000Z"),
      })
    );

    const evidence = await inSeededWorkspace(() => getActivityEvidence(screenshot.id));
    expect(evidence).toMatchObject({
      id: screenshot.id,
      crmProjectId: crmProject.id,
      timeEntryId: entry.id,
      taskId: task.id,
      storageKey: "/objects/agent-screenshots/shot.webp",
    });
    expect(evidence).not.toHaveProperty("totalScore");
    expect(evidence).not.toHaveProperty("rank");
    expect(evidence).not.toHaveProperty("productivity");
  });

  it("enqueues evidence ingest through the jobs port and does not convert it into scores", async () => {
    const { user, crmProject, task, entry } = await seedTrackedWork();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      ACTIVITY_ATTRIBUTE_JOB,
      ACTIVITY_ATTRIBUTE_JOB_TYPE,
      ingestActivityScreenshot,
      handleAttributeEvidenceJob,
    } = await import("../../server/modules/activity/evidenceJobs");
    const { getActivityEvidence } = await import("../../server/modules/activity/evidence");
    const { storage } = await import("../../server/storage");
    const { MissingWorkspaceContextError, runWithWorkspaceContext } = await import(
      "../../server/workspaceContext"
    );

    const jobs = createJobsPort({
      db,
      types: { [ACTIVITY_ATTRIBUTE_JOB]: ACTIVITY_ATTRIBUTE_JOB_TYPE },
    });

    const screenshot = await inSeededWorkspace(() =>
      ingestActivityScreenshot({
        jobs,
        screenshot: {
          timeEntryId: entry.id,
          userId: user.id,
          crmProjectId: crmProject.id,
          storageKey: "/objects/agent-screenshots/shot.webp",
          capturedAt: new Date("2026-08-18T10:05:00.000Z"),
        },
      })
    );

    const claimed = await jobs.claim("worker-1");
    expect(claimed).toMatchObject({
      type: ACTIVITY_ATTRIBUTE_JOB,
      workspaceId: SEEDED_WORKSPACE_ID,
      payload: { kind: "screenshot", screenshotId: screenshot.id },
    });

    await runWithWorkspaceContext({ workspaceId: claimed!.workspaceId }, () =>
      handleAttributeEvidenceJob(claimed!)
    );

    const evidence = await inSeededWorkspace(() => getActivityEvidence(screenshot.id));
    expect(evidence).toMatchObject({
      crmProjectId: crmProject.id,
      taskId: task.id,
    });
    expect(evidence).not.toHaveProperty("totalScore");
    expect(evidence).not.toHaveProperty("rank");
    expect(JSON.stringify(evidence)).not.toMatch(/ranking|productivityTotal/i);

    const still = await inSeededWorkspace(() => storage.getTimeEntry(entry.id));
    expect(still?.duration).toBe(0);

    await expect(handleAttributeEvidenceJob(claimed!)).rejects.toThrow(
      MissingWorkspaceContextError
    );
  });
});
