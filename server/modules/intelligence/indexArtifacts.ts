/**
 * Index Artifacts — derived retrieval rows owned by Intelligence (#116).
 * Rebuilt from Document and File rows. Never a source of truth, and never
 * granted access wider than the source Document Access.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  DOCUMENT_ACCESS_WORKSPACE,
  companyDocuments,
  documents,
  files,
  indexArtifacts,
  type IndexArtifactSourceKind,
  type KnowledgeFile,
} from "@shared/schema";
import { db } from "../../db";
import { extractTextFromContent, chunkText } from "../../embeddings";
import { companyDocumentEmbeddingContent } from "../../companyDocumentContent";
import { inWorkspace, stampWorkspace } from "../../workspaceContext";
import { isUploadedFile } from "@shared/documentFile";

export interface IndexArtifact {
  id: string;
  sourceKind: IndexArtifactSourceKind;
  sourceId: string;
  sourceRevision: string;
  chunkIndex: number;
  chunkText: string;
  access: string;
  provenance: { generator: string; rebuiltAt: string };
}

export async function rebuildIndexArtifacts(): Promise<{ documents: number; files: number }> {
  const rebuiltAt = new Date().toISOString();
  let documentCount = 0;
  let fileCount = 0;

  await db.delete(indexArtifacts).where(inWorkspace(indexArtifacts));

  const pages = await db.select().from(documents).where(inWorkspace(documents));
  for (const page of pages) {
    const text = extractTextFromContent(page.content);
    await writeArtifacts({
      kind: "document",
      id: page.id,
      title: page.title,
      text,
      access: DOCUMENT_ACCESS_WORKSPACE,
      rebuiltAt,
    });
    documentCount += 1;
  }

  const nativePages = await db
    .select()
    .from(companyDocuments)
    .where(inWorkspace(companyDocuments));
  for (const page of nativePages) {
    if (isUploadedFile(page)) continue;
    const text = extractTextFromContent(page.content);
    await writeArtifacts({
      kind: "document",
      id: page.id,
      title: page.name,
      text,
      access: accessFromSource(page.access),
      rebuiltAt,
    });
    documentCount += 1;
  }

  const stored = await db.select().from(files).where(inWorkspace(files));
  for (const file of stored) {
    if (file.scanStatus !== "available") continue;
    const text = await fileText(file);
    if (text === null) continue;
    await writeArtifacts({
      kind: "file",
      id: file.id,
      title: file.name,
      text,
      access: accessFromSource(file.access),
      rebuiltAt,
    });
    fileCount += 1;
  }

  return { documents: documentCount, files: fileCount };
}

export async function listIndexArtifacts(source: {
  kind: IndexArtifactSourceKind;
  id: string;
}): Promise<IndexArtifact[]> {
  const rows = await db
    .select()
    .from(indexArtifacts)
    .where(
      and(
        eq(indexArtifacts.sourceKind, source.kind),
        eq(indexArtifacts.sourceId, source.id),
        inWorkspace(indexArtifacts)
      )
    );
  return rows.map(toArtifact);
}

export async function deleteIndexArtifacts(source: {
  kind: IndexArtifactSourceKind;
  id: string;
}): Promise<void> {
  await db
    .delete(indexArtifacts)
    .where(
      and(
        eq(indexArtifacts.sourceKind, source.kind),
        eq(indexArtifacts.sourceId, source.id),
        inWorkspace(indexArtifacts)
      )
    );
}

/**
 * Copy source Document Access onto the artifact. Never widen: a Workspace
 * grant cannot become public, and a tighter grant stays as tight as the source.
 */
function accessFromSource(sourceAccess: string | null | undefined): string {
  return sourceAccess && sourceAccess.length > 0
    ? sourceAccess
    : DOCUMENT_ACCESS_WORKSPACE;
}

async function fileText(file: KnowledgeFile): Promise<string | null> {
  const content = await companyDocumentEmbeddingContent({
    name: file.name,
    storagePath: file.storagePath,
    mimeType: file.mimeType,
    fileName: file.fileName,
  });
  if (!content) return null;
  return extractTextFromContent(content);
}

async function writeArtifacts(input: {
  kind: IndexArtifactSourceKind;
  id: string;
  title: string;
  text: string;
  access: string;
  rebuiltAt: string;
}): Promise<void> {
  await deleteIndexArtifacts({ kind: input.kind, id: input.id });
  const chunks = chunkText(input.text, input.title);
  const sourceRevision = createHash("sha256").update(input.text).digest("hex").slice(0, 64);
  const access = accessFromSource(input.access);
  if (access === "public") {
    throw new Error("Index Artifacts must not widen Document Access");
  }
  const provenance = { generator: "rebuild" as const, rebuiltAt: input.rebuiltAt };

  for (let i = 0; i < chunks.length; i++) {
    await db.insert(indexArtifacts).values(
      stampWorkspace({
        sourceKind: input.kind,
        sourceId: input.id,
        sourceRevision,
        chunkIndex: i,
        chunkText: chunks[i],
        access,
        provenance,
      })
    );
  }
}

function toArtifact(row: typeof indexArtifacts.$inferSelect): IndexArtifact {
  return {
    id: row.id,
    sourceKind: row.sourceKind as IndexArtifactSourceKind,
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision,
    chunkIndex: row.chunkIndex,
    chunkText: row.chunkText,
    access: row.access,
    provenance: row.provenance,
  };
}
