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

  it("does not enqueue attribution for a pending screenshot key", async () => {
    const { user, crmProject, entry } = await seedTrackedWork();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      ACTIVITY_ATTRIBUTE_JOB,
      ACTIVITY_ATTRIBUTE_JOB_TYPE,
      ingestActivityScreenshot,
    } = await import("../../server/modules/activity/evidenceJobs");
    const { getActivityEvidence } = await import("../../server/modules/activity/evidence");

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
          storageKey: "pending-1771620000000",
          capturedAt: new Date("2026-08-18T10:05:00.000Z"),
        },
      })
    );

    expect(await jobs.claim("worker-1")).toBeNull();
    const evidence = await inSeededWorkspace(() => getActivityEvidence(screenshot.id));
    expect(evidence?.storageKey).toBe("pending-1771620000000");
  });

  it("enqueues attribution in the same transaction as the write that replaces pending-*", async () => {
    const { user, crmProject, entry } = await seedTrackedWork();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      ACTIVITY_ATTRIBUTE_JOB,
      ACTIVITY_ATTRIBUTE_JOB_TYPE,
      commitActivityScreenshot,
      ingestActivityScreenshot,
    } = await import("../../server/modules/activity/evidenceJobs");
    const { getActivityEvidence } = await import("../../server/modules/activity/evidence");
    const { storage } = await import("../../server/storage");

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
          storageKey: "pending-1771620000000",
          capturedAt: new Date("2026-08-18T10:05:00.000Z"),
        },
      })
    );

    await expect(
      db.transaction(async (tx) => {
        await inSeededWorkspace(() =>
          commitActivityScreenshot({
            jobs,
            id: screenshot.id,
            storageKey: "/objects/agent-screenshots/shot.webp",
            contentHash: "a".repeat(64),
            tx,
          })
        );
        tx.rollback();
      })
    ).rejects.toThrow();

    expect(await jobs.claim("worker-1")).toBeNull();
    expect(
      (await inSeededWorkspace(() => getActivityEvidence(screenshot.id)))?.storageKey
    ).toBe("pending-1771620000000");

    const committed = await inSeededWorkspace(() =>
      commitActivityScreenshot({
        jobs,
        id: screenshot.id,
        storageKey: "/objects/agent-screenshots/shot.webp",
        contentHash: "a".repeat(64),
      })
    );
    expect(committed?.storageKey).toBe("/objects/agent-screenshots/shot.webp");

    expect(await jobs.claim("worker-1")).toMatchObject({
      type: ACTIVITY_ATTRIBUTE_JOB,
      workspaceId: SEEDED_WORKSPACE_ID,
      payload: { kind: "screenshot", screenshotId: screenshot.id },
    });
    expect(await inSeededWorkspace(() => storage.getTimeEntry(entry.id))).toBeDefined();
  });

  it("throws when screenshot evidence is missing or still pending", async () => {
    const { user, crmProject, entry } = await seedTrackedWork();
    const {
      handleAttributeEvidenceJob,
      ingestActivityScreenshot,
    } = await import("../../server/modules/activity/evidenceJobs");
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const { ACTIVITY_ATTRIBUTE_JOB, ACTIVITY_ATTRIBUTE_JOB_TYPE } = await import(
      "../../server/modules/activity/evidenceJobs"
    );
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");

    const jobs = createJobsPort({
      db,
      types: { [ACTIVITY_ATTRIBUTE_JOB]: ACTIVITY_ATTRIBUTE_JOB_TYPE },
    });
    const pending = await inSeededWorkspace(() =>
      ingestActivityScreenshot({
        jobs,
        screenshot: {
          timeEntryId: entry.id,
          userId: user.id,
          crmProjectId: crmProject.id,
          storageKey: "pending-1771620000000",
          capturedAt: new Date("2026-08-18T10:05:00.000Z"),
        },
      })
    );

    const missingJob = {
      id: "job-missing",
      type: ACTIVITY_ATTRIBUTE_JOB,
      payload: { kind: "screenshot", screenshotId: "00000000-0000-4000-8000-000000000001" },
      workspaceId: SEEDED_WORKSPACE_ID,
      occurrenceKey: "activity.attribute-evidence:screenshot:missing",
      concurrencyClass: "derived-processing" as const,
      attempt: 1,
      maxAttempts: 5,
      claimedBy: "worker-1",
    };
    await expect(
      runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, () =>
        handleAttributeEvidenceJob(missingJob)
      )
    ).rejects.toThrow(/no Activity Evidence/);

    const pendingJob = {
      ...missingJob,
      id: "job-pending",
      payload: { kind: "screenshot", screenshotId: pending.id },
    };
    await expect(
      runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, () =>
        handleAttributeEvidenceJob(pendingJob)
      )
    ).rejects.toThrow(/pending screenshot/);
  });

  it("commits event batches without enqueueing a no-op attribution Job", async () => {
    const { user, entry, device } = await seedTrackedWork();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      ACTIVITY_ATTRIBUTE_JOB,
      ACTIVITY_ATTRIBUTE_JOB_TYPE,
      handleAttributeEvidenceJob,
      ingestActivityEvents,
    } = await import("../../server/modules/activity/evidenceJobs");
    const { isAgentBatchProcessed } = await import("../../server/modules/activity/evidence");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");

    const jobs = createJobsPort({
      db,
      types: { [ACTIVITY_ATTRIBUTE_JOB]: ACTIVITY_ATTRIBUTE_JOB_TYPE },
    });
    const batchId = "11111111-1111-4111-8111-111111111111";

    await inSeededWorkspace(() =>
      ingestActivityEvents({
        jobs,
        batchId,
        deviceId: device.id,
        events: [
          {
            deviceId: device.id,
            userId: user.id,
            timeEntryId: entry.id,
            batchId,
            eventType: "input_activity",
            timestamp: new Date("2026-08-18T10:06:00.000Z"),
            data: { keyCount: 3 },
          },
        ],
      })
    );

    expect(await inSeededWorkspace(() => isAgentBatchProcessed(batchId))).toBe(true);
    expect(await jobs.claim("worker-1")).toBeNull();

    await expect(
      runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, () =>
        handleAttributeEvidenceJob({
          id: "job-events",
          type: ACTIVITY_ATTRIBUTE_JOB,
          payload: { kind: "events", batchId, timeEntryId: entry.id },
          workspaceId: SEEDED_WORKSPACE_ID,
          occurrenceKey: `activity.attribute-evidence:events:${batchId}`,
          concurrencyClass: "derived-processing",
          attempt: 1,
          maxAttempts: 5,
          claimedBy: "worker-1",
        })
      )
    ).rejects.toThrow(/events attribution/);
  });
});
