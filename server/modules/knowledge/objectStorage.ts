/**
 * ADR-0012 Knowledge object-storage port (#116).
 *
 * Two-phase signed-PUT slots, fail-closed scan, purge cascade, hold flag.
 * Talks to the infrastructure `StoragePort` — HTTP must not import a vendor SDK.
 * Existing object keys stay the File's storage path; this port does not re-key.
 */

import { and, eq } from "drizzle-orm";
import {
  DOCUMENT_ACCESS_WORKSPACE,
  files,
  objectUploadSlots,
  type KnowledgeFile,
} from "@shared/schema";
import { db } from "../../db";
import {
  ObjectNotFoundError,
  ObjectStorageService,
  objectRefFromEntityPath,
  storagePort,
} from "../../objectStorage";
import { inWorkspace, stampWorkspace } from "../../workspaceContext";
import { storage } from "../../storage";
import { deleteIndexArtifacts } from "../intelligence/indexArtifacts";
import { deleteCompanyDocumentEmbeddings } from "../../embeddings";

const SLOT_TTL_MS = 900_000;

export type ScanOutcome = "available" | "quarantined" | "rejected";

export class ObjectNotUploadedError extends Error {
  constructor() {
    super("Object not uploaded");
    this.name = "ObjectNotUploadedError";
  }
}

export interface UploadSlot {
  slotId: string;
  uploadURL: string;
  objectPath: string;
}

export interface FinalizeUploadInput {
  objectPath: string;
  name: string;
  fileName: string;
  mimeType: string;
  fileSize?: number | null;
  uploadedById: string;
  folderId?: string | null;
  description?: string | null;
}

export interface PurgeResult {
  status: "purged" | "held";
}

export interface KnowledgeObjectStoragePort {
  createUploadSlot(createdById: string): Promise<UploadSlot>;
  finalizeUpload(input: FinalizeUploadInput): Promise<KnowledgeFile>;
  scan(fileId: string, outcome?: ScanOutcome): Promise<KnowledgeFile>;
  setHold(fileId: string, hold: boolean): Promise<KnowledgeFile>;
  purge(fileId: string): Promise<PurgeResult>;
  isReadable(fileId: string): Promise<boolean>;
}

export function createKnowledgeObjectStorage(): KnowledgeObjectStoragePort {
  return new KnowledgeObjectStorage();
}

class KnowledgeObjectStorage implements KnowledgeObjectStoragePort {
  async createUploadSlot(createdById: string): Promise<UploadSlot> {
    const objects = new ObjectStorageService();
    const { uploadURL, objectPath } = await objects.getObjectEntityUpload();
    const [slot] = await db
      .insert(objectUploadSlots)
      .values(
        stampWorkspace({
          objectPath,
          createdById,
          expiresAt: new Date(Date.now() + SLOT_TTL_MS),
        })
      )
      .returning();
    return { slotId: slot.id, uploadURL, objectPath };
  }

  async finalizeUpload(input: FinalizeUploadInput): Promise<KnowledgeFile> {
    const objects = new ObjectStorageService();
    const objectPath = objects.normalizeObjectEntityPath(input.objectPath);
    await this.assertSlotAllowsFinalize(objectPath);
    try {
      await objects.getObjectEntityFile(objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new ObjectNotUploadedError();
      }
      throw error;
    }

    const existing = await db
      .select()
      .from(files)
      .where(and(eq(files.storagePath, objectPath), inWorkspace(files)));
    if (existing[0]) {
      await this.markSlotFinalized(objectPath, existing[0].id);
      return existing[0];
    }

    const file = await storage.createFile({
      name: input.name,
      description: input.description ?? null,
      fileName: input.fileName,
      fileSize: input.fileSize ?? null,
      mimeType: input.mimeType,
      storagePath: objectPath,
      folderId: input.folderId ?? null,
      uploadedById: input.uploadedById,
      scanStatus: "uploaded",
    });
    await this.markSlotFinalized(objectPath, file.id);
    return file;
  }

  async scan(fileId: string, outcome: ScanOutcome = "available"): Promise<KnowledgeFile> {
    const current = await this.requireFile(fileId);
    if (current.scanStatus !== "uploaded" && current.scanStatus !== "scanning") {
      throw new Error(`File ${fileId} cannot be scanned from ${current.scanStatus}`);
    }
    await db
      .update(files)
      .set({ scanStatus: "scanning", updatedAt: new Date() })
      .where(and(eq(files.id, fileId), inWorkspace(files)));
    const [scanned] = await db
      .update(files)
      .set({ scanStatus: outcome, updatedAt: new Date() })
      .where(and(eq(files.id, fileId), inWorkspace(files)))
      .returning();
    return scanned ?? current;
  }

  async setHold(fileId: string, hold: boolean): Promise<KnowledgeFile> {
    await this.requireFile(fileId);
    const [updated] = await db
      .update(files)
      .set({ hold, updatedAt: new Date() })
      .where(and(eq(files.id, fileId), inWorkspace(files)))
      .returning();
    return updated;
  }

  async purge(fileId: string): Promise<PurgeResult> {
    const file = await storage.getFile(fileId);
    if (!file) return { status: "purged" };
    if (file.hold) return { status: "held" };

    await deleteIndexArtifacts({ kind: "file", id: fileId });
    await deleteIndexArtifacts({ kind: "document", id: fileId });
    await deleteCompanyDocumentEmbeddings(fileId);
    try {
      await storagePort.delete(objectRefFromEntityPath(file.storagePath));
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
    await storage.deleteFile(fileId);
    return { status: "purged" };
  }

  async isReadable(fileId: string): Promise<boolean> {
    const file = await storage.getFile(fileId);
    return file?.scanStatus === "available";
  }

  private async requireFile(fileId: string): Promise<KnowledgeFile> {
    const file = await storage.getFile(fileId);
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }
    return file;
  }

  private async assertSlotAllowsFinalize(objectPath: string): Promise<void> {
    const [slot] = await db
      .select()
      .from(objectUploadSlots)
      .where(and(eq(objectUploadSlots.objectPath, objectPath), inWorkspace(objectUploadSlots)));
    if (!slot) return;
    if (slot.finalizedAt) return;
    if (slot.expiresAt.getTime() < Date.now()) {
      throw new Error("Upload slot expired");
    }
  }

  private async markSlotFinalized(objectPath: string, fileId: string): Promise<void> {
    await db
      .update(objectUploadSlots)
      .set({ finalizedAt: new Date(), fileId })
      .where(and(eq(objectUploadSlots.objectPath, objectPath), inWorkspace(objectUploadSlots)));
  }
}

export type { FileScanStatus } from "@shared/schema";
