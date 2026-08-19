import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";
import { embeddingCalls } from "../fakes/openai";

/**
 * Document embeddings and transcripts as Jobs (#85, spec #81).
 *
 * The seam is the jobs port — enqueue in the same transaction as the Document
 * write, then the Job handler. HTTP is not this suite. OpenAI and Playwright
 * are the existing fakes; nothing here reaches a provider.
 */

async function seedProject() {
  const { storage } = await import("../../server/storage");
  const { inSeededWorkspace } = await import("../helpers/workspace");
  const user = await storage.createUser({
    email: "ada@test.invalid",
    password: "not-a-real-hash",
    firstName: "Ada",
  });
  const { project } = await inSeededWorkspace(() =>
    storage.createCrmProjectWithBase({
      name: "Atlas",
      ownerId: user.id,
    })
  );
  return { storage, user, project };
}

const LOOM_VIDEO_ID = "sanitized-recording-id";
const LOOM_TRANSCRIPTION_URL =
  `https://cdn.loom.com/mediametadata/transcription/${LOOM_VIDEO_ID}-1.json`;
const LOOM_CONTENT = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "See the recording" }] },
    { type: "videoEmbed", attrs: { src: `https://www.loom.com/share/${LOOM_VIDEO_ID}` } },
  ],
};

describe("document derived Jobs", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    const { resetFakeBrowser } = await import("../fakes/playwright");
    resetFakeBrowser();
  });

  it("enqueues an embed Job in the same transaction as the Document write", async () => {
    const { user, project } = await seedProject();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      DOCUMENT_EMBED_JOB,
      DOCUMENT_EMBED_JOB_TYPE,
      createDocumentWithDerivedJobs,
    } = await import("../../server/documentJobs");

    const jobs = createJobsPort({
      db,
      types: { [DOCUMENT_EMBED_JOB]: DOCUMENT_EMBED_JOB_TYPE },
    });
    const document = await inSeededWorkspace(() =>
      createDocumentWithDerivedJobs({
        jobs,
        title: "Deployment",
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ship on Friday" }] }] },
        projectId: project.id,
        createdById: user.id,
      })
    );

    expect(embeddingCalls()).toEqual([]);
    expect(await jobs.claim("worker-1")).toMatchObject({
      type: DOCUMENT_EMBED_JOB,
      payload: { documentId: document.id, ownerId: user.id },
      workspaceId: SEEDED_WORKSPACE_ID,
      claimedBy: "worker-1",
    });
  });

  it("rolls back the Job when the Document write rolls back", async () => {
    const { storage, user, project } = await seedProject();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      DOCUMENT_EMBED_JOB,
      DOCUMENT_EMBED_JOB_TYPE,
      createDocumentWithDerivedJobs,
    } = await import("../../server/documentJobs");

    const jobs = createJobsPort({
      db,
      types: { [DOCUMENT_EMBED_JOB]: DOCUMENT_EMBED_JOB_TYPE },
    });

    await expect(
      db.transaction(async (tx) => {
        await inSeededWorkspace(() =>
          createDocumentWithDerivedJobs({
            jobs,
            title: "Never committed",
            content: { type: "doc", content: [] },
            projectId: project.id,
            createdById: user.id,
            tx,
          })
        );
        tx.rollback();
      })
    ).rejects.toThrow();

    expect(await jobs.claim("worker-1")).toBeNull();
    expect(await inSeededWorkspace(() => storage.getDocuments(project.id))).toEqual([]);
  });

  it("runs the embed Job through the OpenAI fake and does not call it at save", async () => {
    const { user, project } = await seedProject();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      DOCUMENT_EMBED_JOB,
      DOCUMENT_EMBED_JOB_TYPE,
      createDocumentWithDerivedJobs,
      handleDocumentEmbedJob,
    } = await import("../../server/documentJobs");

    const jobs = createJobsPort({
      db,
      types: { [DOCUMENT_EMBED_JOB]: DOCUMENT_EMBED_JOB_TYPE },
    });
    const document = await inSeededWorkspace(() =>
      createDocumentWithDerivedJobs({
        jobs,
        title: "Deployment",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Ship on Friday" }] }],
        },
        projectId: project.id,
        createdById: user.id,
      })
    );
    expect(embeddingCalls()).toEqual([]);

    const claimed = await jobs.claim("worker-1");
    await inSeededWorkspace(() => handleDocumentEmbedJob(claimed!));
    await jobs.complete(claimed!.id, "worker-1");

    expect(embeddingCalls()).toEqual([[expect.stringContaining("Ship on Friday")]]);
    expect(await jobs.claim("worker-2")).toBeNull();
    expect(document.id).toBeTruthy();
  });

  it("enqueues a transcript Job for video content and the Worker runs it through the Playwright fake", async () => {
    const { user, project } = await seedProject();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      DOCUMENT_EMBED_JOB,
      DOCUMENT_EMBED_JOB_TYPE,
      DOCUMENT_TRANSCRIPT_JOB,
      DOCUMENT_TRANSCRIPT_JOB_TYPE,
      createDocumentWithDerivedJobs,
      handleDocumentTranscriptJob,
    } = await import("../../server/documentJobs");
    const { getTranscriptStatus } = await import("../../server/transcripts");
    const fake = await import("../fakes/playwright");
    fake.useFakeBrowser({
      responses: [
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body: readFileSync(
            join(import.meta.dirname, "..", "fixtures", "loom-transcription-1.1.3.json"),
            "utf8"
          ),
        },
      ],
    });

    const jobs = createJobsPort({
      db,
      types: {
        [DOCUMENT_EMBED_JOB]: DOCUMENT_EMBED_JOB_TYPE,
        [DOCUMENT_TRANSCRIPT_JOB]: DOCUMENT_TRANSCRIPT_JOB_TYPE,
      },
    });
    const document = await inSeededWorkspace(() =>
      createDocumentWithDerivedJobs({
        jobs,
        title: "Kickoff",
        content: LOOM_CONTENT,
        projectId: project.id,
        createdById: user.id,
      })
    );

    const claimed = [];
    for (let i = 0; i < 2; i++) claimed.push(await jobs.claim("worker-1"));
    const transcriptJob = claimed.find((job) => job?.type === DOCUMENT_TRANSCRIPT_JOB);
    expect(transcriptJob).toMatchObject({
      type: DOCUMENT_TRANSCRIPT_JOB,
      payload: { documentId: document.id, ownerId: user.id },
    });

    await inSeededWorkspace(() => handleDocumentTranscriptJob(transcriptJob!));
    await jobs.complete(transcriptJob!.id, "worker-1");

    const status = await inSeededWorkspace(() => getTranscriptStatus(document.id));
    expect(status).toMatchObject({
      total: 1,
      completed: 1,
      pending: 0,
      error: 0,
    });
    expect(status.transcripts[0]).toMatchObject({
      videoId: LOOM_VIDEO_ID,
      provider: "loom",
      status: "completed",
    });
  });

  it("enqueues an embed Job when a Document update changes title or content", async () => {
    const { storage, user, project } = await seedProject();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      DOCUMENT_EMBED_JOB,
      DOCUMENT_EMBED_JOB_TYPE,
      DOCUMENT_TRANSCRIPT_JOB,
      DOCUMENT_TRANSCRIPT_JOB_TYPE,
      updateDocumentWithDerivedJobs,
    } = await import("../../server/documentJobs");

    const existing = await inSeededWorkspace(() =>
      storage.createDocument({
        title: "Draft",
        content: { type: "doc", content: [] },
        projectId: project.id,
        createdById: user.id,
      })
    );
    const jobs = createJobsPort({
      db,
      types: {
        [DOCUMENT_EMBED_JOB]: DOCUMENT_EMBED_JOB_TYPE,
        [DOCUMENT_TRANSCRIPT_JOB]: DOCUMENT_TRANSCRIPT_JOB_TYPE,
      },
    });

    const updated = await inSeededWorkspace(() =>
      updateDocumentWithDerivedJobs({
        jobs,
        id: existing.id,
        ownerId: user.id,
        data: {
          title: "Shipped",
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }],
          },
        },
      })
    );

    expect(updated?.title).toBe("Shipped");
    expect(embeddingCalls()).toEqual([]);
    expect(await jobs.claim("worker-1")).toMatchObject({
      type: DOCUMENT_EMBED_JOB,
      payload: { documentId: existing.id, ownerId: user.id },
    });
  });
});
