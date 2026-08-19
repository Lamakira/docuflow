/**
 * Document embeddings and transcripts as Jobs (#85). Enqueueing commits in the
 * same transaction as the Document write. HTTP returns without awaiting either
 * provider. The Worker claims and runs them.
 */

import type { Document, InsertDocument } from "@shared/schema";
import { db } from "./db";
import { createJobsPort, workspaceOfCause, type Job, type JobTypeDeclaration, type JobsPort, type JobsWriter } from "./jobs";
import { storage, type DocumentWriter } from "./storage";
import { updateDocumentEmbeddings } from "./embeddings";
import { extractVideosFromContent, syncDocumentVideoTranscripts } from "./transcripts";

export const DOCUMENT_EMBED_JOB = "document.embed";
export const DOCUMENT_TRANSCRIPT_JOB = "document.sync-transcripts";

export const DOCUMENT_EMBED_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 60_000,
  concurrencyClass: "derived-processing",
};

export const DOCUMENT_TRANSCRIPT_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 120_000,
  concurrencyClass: "derived-processing",
};

export function createDocumentJobsPort(): JobsPort {
  return createJobsPort({
    db,
    types: {
      [DOCUMENT_EMBED_JOB]: DOCUMENT_EMBED_JOB_TYPE,
      [DOCUMENT_TRANSCRIPT_JOB]: DOCUMENT_TRANSCRIPT_JOB_TYPE,
    },
  });
}

export interface CreateDocumentWithDerivedJobsInput extends InsertDocument {
  jobs: JobsPort;
  tx?: DocumentWriter & JobsWriter;
}

export async function createDocumentWithDerivedJobs(
  input: CreateDocumentWithDerivedJobsInput
): Promise<Document> {
  const { jobs, tx, ...values } = input;
  const persist = async (writer: DocumentWriter & JobsWriter) => {
    const document = await storage.createDocument(values, writer);
    const target = {
      id: document.id,
      ownerId: document.createdById,
      workspaceId: document.workspaceId,
    };
    await enqueueDocumentEmbedJob(jobs, target, writer);
    if (extractVideosFromContent(document.content).length > 0) {
      await enqueueDocumentTranscriptJob(jobs, target, writer);
    }
    return document;
  };
  if (tx) return persist(tx);
  return db.transaction(persist);
}

export interface UpdateDocumentWithDerivedJobsInput {
  jobs: JobsPort;
  id: string;
  ownerId: string;
  data: Partial<InsertDocument>;
  tx?: DocumentWriter & JobsWriter;
}

export async function updateDocumentWithDerivedJobs(
  input: UpdateDocumentWithDerivedJobsInput
): Promise<Document | undefined> {
  const { jobs, id, ownerId, data, tx } = input;
  const persist = async (writer: DocumentWriter & JobsWriter) => {
    const updated = await storage.updateDocument(id, data, writer);
    if (!updated) return undefined;
    const target = { id: updated.id, ownerId, workspaceId: updated.workspaceId };
    if (data.title !== undefined || data.content !== undefined) {
      await enqueueDocumentEmbedJob(jobs, target, writer);
    }
    if (data.content !== undefined) {
      await enqueueDocumentTranscriptJob(jobs, target, writer);
    }
    return updated;
  };
  if (tx) return persist(tx);
  return db.transaction(persist);
}

export async function enqueueDocumentEmbedJob(
  jobs: JobsPort,
  document: { id: string; ownerId: string | null; workspaceId?: string | null },
  tx?: JobsWriter
): Promise<void> {
  await jobs.enqueue(
    {
      type: DOCUMENT_EMBED_JOB,
      payload: { documentId: document.id, ownerId: document.ownerId },
      workspaceId: workspaceOfCause(document.workspaceId),
    },
    tx
  );
}

export async function enqueueDocumentTranscriptJob(
  jobs: JobsPort,
  document: { id: string; ownerId: string | null; workspaceId?: string | null },
  tx?: JobsWriter
): Promise<void> {
  await jobs.enqueue(
    {
      type: DOCUMENT_TRANSCRIPT_JOB,
      payload: { documentId: document.id, ownerId: document.ownerId },
      workspaceId: workspaceOfCause(document.workspaceId),
    },
    tx
  );
}

export async function handleDocumentEmbedJob(job: Job): Promise<void> {
  const payload = job.payload as { documentId?: unknown; ownerId?: unknown };
  const documentId = payload.documentId;
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new Error(`Job "${job.id}" is missing a documentId.`);
  }
  const document = await storage.getDocument(documentId);
  if (!document) return;
  const project = await storage.getProject(document.projectId);
  if (!project) return;
  const ownerId =
    typeof payload.ownerId === "string" && payload.ownerId.length > 0
      ? payload.ownerId
      : document.createdById;
  if (!ownerId) {
    throw new Error(`Job "${job.id}" is missing an ownerId.`);
  }
  const ancestors = await storage.getDocumentAncestors(document.id);
  await updateDocumentEmbeddings(
    document.id,
    document.projectId,
    ownerId,
    document.title,
    document.content,
    project.name,
    ancestors.map((ancestor) => ancestor.title)
  );
}

export async function handleDocumentTranscriptJob(job: Job): Promise<void> {
  const payload = job.payload as { documentId?: unknown; ownerId?: unknown };
  const documentId = payload.documentId;
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new Error(`Job "${job.id}" is missing a documentId.`);
  }
  const document = await storage.getDocument(documentId);
  if (!document || !document.content) return;
  const project = await storage.getProject(document.projectId);
  if (!project) return;
  const ownerId =
    typeof payload.ownerId === "string" && payload.ownerId.length > 0
      ? payload.ownerId
      : document.createdById;
  if (!ownerId) {
    throw new Error(`Job "${job.id}" is missing an ownerId.`);
  }
  const ancestors = await storage.getDocumentAncestors(document.id);
  await syncDocumentVideoTranscripts(
    document.id,
    document.projectId,
    ownerId,
    document.content,
    project.name,
    document.title,
    ancestors.map((ancestor) => ancestor.title),
    { awaitProcessing: true }
  );
}
