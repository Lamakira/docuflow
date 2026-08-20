import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_ACCESS_WORKSPACE } from "../../shared/schema";
import { migrate } from "../../scripts/migrate";
import { resetDb, urlForDatabase, withClient } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";
import { completeUpload } from "../helpers/objects";
import { objectExists, putObject } from "../fakes/gcs";

/**
 * Phase 6 ticket #116: ADR-0012 Knowledge object-storage port and Index
 * Artifact rebuild (Spec #112). HTTP is not this suite — the port plus the
 * journal are the seam. Characterization stays green unless an HTTP contract
 * actually changes. The GCS fake is the existing storage fake; #59 is not
 * required.
 */

const SCRATCH_DB = "docuflow_knowledge_object_storage";
const BEFORE_PORT = "0013_old_butterfly";
const LEGACY_KEY = "/objects/uploads/invoice-keep";
const LEGACY_OBJECT = "test-bucket/.private/uploads/invoice-keep";

async function publicColumns(url: string, table: string): Promise<string[]> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY column_name`,
      [table]
    );
    return rows.map((row) => row.column_name);
  });
}

async function seedUser() {
  const { storage } = await import("../../server/storage");
  return storage.createUser({
    email: "ada@test.invalid",
    password: "not-a-real-hash",
    firstName: "Ada",
  });
}

describe("knowledge object-storage port (journal)", () => {
  let scratch: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    scratch = urlForDatabase(SCRATCH_DB);

    await migrate(scratch, { applyThrough: BEFORE_PORT });
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-keep', 'keep@example.test', 'x', 'user', 0, '2020-01-01')`
      );
      await client.query(
        `INSERT INTO files (id, name, file_name, file_size, mime_type, storage_path, uploaded_by_id, access, workspace_id)
         VALUES ('file-keep', 'Invoice', 'invoice.pdf', 2048, 'application/pdf', $1, 'u-keep', 'workspace', 'seeded')`,
        [LEGACY_KEY]
      );
    });
    await migrate(scratch);
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("keeps the existing object key and does not re-key", async () => {
    const file = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string; storage_path: string }>(
        `SELECT id, storage_path FROM files WHERE id = 'file-keep'`
      );
      return rows[0];
    });
    expect(file).toEqual({ id: "file-keep", storage_path: LEGACY_KEY });
  });

  it("treats already-stored Files as available and not held", async () => {
    const columns = await publicColumns(scratch, "files");
    expect(columns).toEqual(expect.arrayContaining(["scan_status", "hold"]));

    const file = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ scan_status: string; hold: boolean }>(
        `SELECT scan_status, hold FROM files WHERE id = 'file-keep'`
      );
      return rows[0];
    });
    expect(file).toEqual({ scan_status: "available", hold: false });
  });

  it("adds upload slots and Index Artifacts without a provider swap", async () => {
    const tables = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename IN ('object_upload_slots', 'index_artifacts')
          ORDER BY tablename`
      );
      return rows.map((row) => row.tablename);
    });
    expect(tables).toEqual(["index_artifacts", "object_upload_slots"]);
  });
});

describe("knowledge object-storage port", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("does not let HTTP import a vendor storage SDK", () => {
    const routes = readFileSync(join(process.cwd(), "server/routes.ts"), "utf8");
    expect(routes).not.toMatch(/@google-cloud\/storage/);
    expect(routes).not.toMatch(/@replit\/object-storage/);
  });

  it("issues a two-phase slot, verifies the PUT, and scans the File to available", async () => {
    const user = await seedUser();
    const { createKnowledgeObjectStorage } = await import(
      "../../server/modules/knowledge/objectStorage"
    );
    const port = createKnowledgeObjectStorage();

    const file = await inSeededWorkspace(async () => {
      const slot = await port.createUploadSlot(user.id);
      expect(slot.objectPath).toMatch(/^\/objects\/uploads\//);
      completeUpload(slot.uploadURL, "invoice-bytes", "application/pdf");
      const uploaded = await port.finalizeUpload({
        objectPath: slot.objectPath,
        name: "Invoice",
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        fileSize: 13,
        uploadedById: user.id,
      });
      expect(uploaded.scanStatus).toBe("uploaded");
      expect(uploaded.storagePath).toBe(slot.objectPath);
      return port.scan(uploaded.id);
    });

    expect(file.scanStatus).toBe("available");
    expect(await inSeededWorkspace(() => port.isReadable(file.id))).toBe(true);
  });

  it("refuses to finalize when the object was never uploaded", async () => {
    const user = await seedUser();
    const { createKnowledgeObjectStorage } = await import(
      "../../server/modules/knowledge/objectStorage"
    );
    const port = createKnowledgeObjectStorage();

    await inSeededWorkspace(async () => {
      const slot = await port.createUploadSlot(user.id);
      await expect(
        port.finalizeUpload({
          objectPath: slot.objectPath,
          name: "Missing",
          fileName: "missing.pdf",
          mimeType: "application/pdf",
          uploadedById: user.id,
        })
      ).rejects.toThrow(/not uploaded|not found/i);
    });
  });

  it("finalizes an existing object key without rewriting it", async () => {
    const user = await seedUser();
    putObject(LEGACY_OBJECT, "legacy-bytes");
    const { createKnowledgeObjectStorage } = await import(
      "../../server/modules/knowledge/objectStorage"
    );
    const port = createKnowledgeObjectStorage();

    const file = await inSeededWorkspace(() =>
      port.finalizeUpload({
        objectPath: LEGACY_KEY,
        name: "Invoice",
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        uploadedById: user.id,
      })
    );

    expect(file.storagePath).toBe(LEGACY_KEY);
    expect(objectExists(LEGACY_OBJECT)).toBe(true);
  });

  it("fails closed on a quarantined File", async () => {
    const user = await seedUser();
    const { createKnowledgeObjectStorage } = await import(
      "../../server/modules/knowledge/objectStorage"
    );
    const port = createKnowledgeObjectStorage();

    const file = await inSeededWorkspace(async () => {
      const slot = await port.createUploadSlot(user.id);
      completeUpload(slot.uploadURL, "bad", "text/plain");
      const uploaded = await port.finalizeUpload({
        objectPath: slot.objectPath,
        name: "Suspect",
        fileName: "suspect.txt",
        mimeType: "text/plain",
        uploadedById: user.id,
      });
      return port.scan(uploaded.id, "quarantined");
    });

    expect(file.scanStatus).toBe("quarantined");
    expect(await inSeededWorkspace(() => port.isReadable(file.id))).toBe(false);
  });

  it("purges the File row, object, and Index Artifacts unless a hold is set", async () => {
    const user = await seedUser();
    const { createKnowledgeObjectStorage } = await import(
      "../../server/modules/knowledge/objectStorage"
    );
    const { rebuildIndexArtifacts, listIndexArtifacts } = await import(
      "../../server/modules/intelligence/indexArtifacts"
    );
    const port = createKnowledgeObjectStorage();

    const { file, objectPath } = await inSeededWorkspace(async () => {
      const slot = await port.createUploadSlot(user.id);
      completeUpload(slot.uploadURL, "handbook text for the index", "text/plain");
      const uploaded = await port.finalizeUpload({
        objectPath: slot.objectPath,
        name: "Handbook",
        fileName: "handbook.txt",
        mimeType: "text/plain",
        uploadedById: user.id,
      });
      await port.scan(uploaded.id);
      await rebuildIndexArtifacts();
      return { file: uploaded, objectPath: slot.objectPath };
    });

    const objectKey = `test-bucket/.private/${objectPath.slice("/objects/".length)}`;
    expect(objectExists(objectKey)).toBe(true);
    expect(
      await inSeededWorkspace(() => listIndexArtifacts({ kind: "file", id: file.id }))
    ).not.toEqual([]);

    const held = await inSeededWorkspace(async () => {
      await port.setHold(file.id, true);
      return port.purge(file.id);
    });
    expect(held).toEqual({ status: "held" });
    expect(objectExists(objectKey)).toBe(true);

    const purged = await inSeededWorkspace(async () => {
      await port.setHold(file.id, false);
      return port.purge(file.id);
    });
    expect(purged).toEqual({ status: "purged" });
    expect(objectExists(objectKey)).toBe(false);
    expect(
      await inSeededWorkspace(() => listIndexArtifacts({ kind: "file", id: file.id }))
    ).toEqual([]);

    const { storage } = await import("../../server/storage");
    expect(await inSeededWorkspace(() => storage.getFile(file.id))).toBeUndefined();
  });

  it("rebuilds Index Artifacts from Document and File rows without widening access", async () => {
    const user = await seedUser();
    const { storage } = await import("../../server/storage");
    const { createKnowledgeObjectStorage } = await import(
      "../../server/modules/knowledge/objectStorage"
    );
    const { rebuildIndexArtifacts, listIndexArtifacts } = await import(
      "../../server/modules/intelligence/indexArtifacts"
    );
    const port = createKnowledgeObjectStorage();

    const { documentId, fileId } = await inSeededWorkspace(async () => {
      const { project } = await storage.createCrmProjectWithBase({
        name: "Handbook project",
        ownerId: user.id,
      });
      const page = await storage.createDocument({
        title: "Onboarding",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "New joiners get a laptop on day one" }],
            },
          ],
        },
        projectId: project.id,
        createdById: user.id,
      });

      const slot = await port.createUploadSlot(user.id);
      completeUpload(slot.uploadURL, "expense receipts within 30 days", "text/plain");
      const uploaded = await port.finalizeUpload({
        objectPath: slot.objectPath,
        name: "Expense policy",
        fileName: "policy.txt",
        mimeType: "text/plain",
        uploadedById: user.id,
      });
      await port.scan(uploaded.id);

      const rebuilt = await rebuildIndexArtifacts();
      expect(rebuilt).toEqual({ documents: 1, files: 1 });
      return { documentId: page.id, fileId: uploaded.id };
    });

    const documentArtifacts = await inSeededWorkspace(() =>
      listIndexArtifacts({ kind: "document", id: documentId })
    );
    const fileArtifacts = await inSeededWorkspace(() =>
      listIndexArtifacts({ kind: "file", id: fileId })
    );

    expect(documentArtifacts.length).toBeGreaterThan(0);
    expect(fileArtifacts.length).toBeGreaterThan(0);
    expect(documentArtifacts.map((row) => row.chunkText).join(" ")).toContain(
      "New joiners get a laptop on day one"
    );
    expect(fileArtifacts.map((row) => row.chunkText).join(" ")).toContain(
      "expense receipts within 30 days"
    );

    for (const artifact of [...documentArtifacts, ...fileArtifacts]) {
      expect(artifact.access).toBe(DOCUMENT_ACCESS_WORKSPACE);
      expect(artifact.provenance.generator).toBe("rebuild");
      expect(artifact.sourceRevision).toMatch(/^[a-f0-9]+$/);
    }

    const { storage: store } = await import("../../server/storage");
    const file = await inSeededWorkspace(() => store.getFile(fileId));
    expect(file?.access).toBe(DOCUMENT_ACCESS_WORKSPACE);
    expect(fileArtifacts.every((row) => row.access === file?.access)).toBe(true);
  });
});
