import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { getOwnerPool, resetDb } from "../helpers/db";
import { newAgent, registerAdmin, registerUser, setWorkspaceRole, type TestUser } from "../helpers/auth";
import { createCrmProject, createDocument, createFolder, tiptap } from "../helpers/fixtures";
import { completeUpload, objectPathFor } from "../helpers/objects";
import { addWorkspaceMembership, plantParallelWorkspace, removeAllMemberships } from "../helpers/workspace";
import { objectMetadata } from "../fakes/gcs";
import { waitFor } from "../helpers/wait";

/**
 * Workspace Documents review, server half (F52-F57, F59): save conflicts,
 * validation, who may delete and move, the register route, what a person
 * carries, and who reads an object placed in a Document.
 */

const UNKNOWN = "00000000-0000-0000-0000-000000000000";
const PERSON_KEYS = ["email", "firstName", "id", "lastName", "profileImageUrl"];

async function write(user: TestUser, name: string, folderId?: string, text = `${name} body text`) {
  const res = await user.agent
    .post("/api/company-documents")
    .send({ name, content: tiptap(text), ...(folderId ? { folderId } : {}) });
  expect(res.status).toBe(201);
  return res.body as { id: string; updatedAt: string };
}

async function rows(text: string, values: unknown[] = []) {
  return (await getOwnerPool().query(text, values)).rows;
}

async function indexed(documentId: string, atLeast = 1) {
  return waitFor(
    async () => {
      const found = await rows(
        "SELECT folder_id, metadata FROM company_document_embeddings WHERE company_document_id = $1",
        [documentId],
      );
      return found.length >= atLeast ? found : null;
    },
    { label: "the Document to be indexed" },
  );
}

describe("save conflicts (F52)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses a stale save of a Workspace Document and leaves it untouched", async () => {
    const app = await makeApp();
    const author = await registerUser(app);
    const other = await registerUser(app);
    const { id } = await write(author, "Handbook");
    await indexed(id);
    const opened = (await author.agent.get(`/api/company-documents/${id}`)).body;

    // A fresh row holds microseconds; the value its GET returned must still match.
    const first = await other.agent
      .patch(`/api/company-documents/${id}`)
      .send({ content: tiptap("theirs"), expectedUpdatedAt: opened.updatedAt });
    expect(first.status).toBe(200);
    expect(first.body.updatedAt > opened.updatedAt).toBe(true);
    const before = await rows("SELECT * FROM company_documents WHERE id = $1", [id]);
    const indexBefore = await rows("SELECT id FROM company_document_embeddings WHERE company_document_id = $1", [id]);

    const stale = await author.agent
      .patch(`/api/company-documents/${id}`)
      .send({ name: "Mine", content: tiptap("mine"), expectedUpdatedAt: opened.updatedAt });
    expect(stale.status).toBe(409);
    const current = (await author.agent.get(`/api/company-documents/${id}`)).body;
    expect(stale.body).toEqual({
      message: "This Document changed since you opened it",
      code: "document_changed",
      current,
    });
    expect(current).toMatchObject({ name: "Handbook", content: tiptap("theirs"), updatedAt: first.body.updatedAt });
    expect(await rows("SELECT * FROM company_documents WHERE id = $1", [id])).toEqual(before);
    expect(await rows("SELECT id FROM company_document_embeddings WHERE company_document_id = $1", [id])).toEqual(
      indexBefore,
    );

    // Without the field the last save wins, as before.
    const unchecked = await author.agent.patch(`/api/company-documents/${id}`).send({ content: tiptap("forced") });
    expect(unchecked.status).toBe(200);
    expect(unchecked.body.content).toEqual(tiptap("forced"));

    const missing = await author.agent
      .patch(`/api/company-documents/${UNKNOWN}`)
      .send({ name: "x", expectedUpdatedAt: opened.updatedAt });
    expect(missing.status).toBe(404);
    for (const invalid of ["yesterday", "2026-11-24", 12]) {
      const res = await author.agent
        .patch(`/api/company-documents/${id}`)
        .send({ name: "x", expectedUpdatedAt: invalid });
      expect(res.status).toBe(400);
    }
  });

  it("refuses a stale save of a Project Document and enqueues nothing", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const { project } = await createCrmProject(admin.agent, { documentationEnabled: true });
    const { id } = await createDocument(admin.agent, project.id, { title: "Spec", content: tiptap("one") });
    const opened = (await admin.agent.get(`/api/documents/${id}`)).body;

    const first = await admin.agent
      .patch(`/api/documents/${id}`)
      .send({ content: tiptap("two"), expectedUpdatedAt: opened.updatedAt });
    expect(first.status).toBe(200);
    expect(first.body.updatedAt > opened.updatedAt).toBe(true);
    const jobs = async () => (await rows("SELECT id FROM jobs ORDER BY id")).length;
    const jobsBefore = await jobs();
    const projectBefore = await rows("SELECT updated_at FROM projects WHERE id = $1", [project.id]);

    const stale = await admin.agent
      .patch(`/api/documents/${id}`)
      .send({ title: "Mine", content: tiptap("three"), expectedUpdatedAt: opened.updatedAt });
    expect(stale.status).toBe(409);
    const current = (await admin.agent.get(`/api/documents/${id}`)).body;
    expect(stale.body).toEqual({
      message: "This Document changed since you opened it",
      code: "document_changed",
      current,
    });
    expect(current).toMatchObject({ title: "Spec", content: tiptap("two"), updatedAt: first.body.updatedAt });
    expect(await jobs()).toBe(jobsBefore);
    expect(await rows("SELECT updated_at FROM projects WHERE id = $1", [project.id])).toEqual(projectBefore);

    const unchecked = await admin.agent.patch(`/api/documents/${id}`).send({ content: tiptap("forced") });
    expect(unchecked.status).toBe(200);
    const invalid = await admin.agent.patch(`/api/documents/${id}`).send({ expectedUpdatedAt: "nope" });
    expect(invalid.status).toBe(400);
    const missing = await admin.agent
      .patch(`/api/documents/${UNKNOWN}`)
      .send({ expectedUpdatedAt: opened.updatedAt });
    expect(missing.status).toBe(404);
  });

  it("gives each checked save a later time, even when the stored one is ahead of the clock", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { id } = await write(user, "Minutes");
    await rows("UPDATE company_documents SET updated_at = '2099-01-01 00:00:00.123456' WHERE id = $1", [id]);
    let baseline = (await user.agent.get(`/api/company-documents/${id}`)).body.updatedAt as string;
    expect(baseline).toBe("2099-01-01T00:00:00.123Z");
    for (const expected of ["2099-01-01T00:00:00.124Z", "2099-01-01T00:00:00.125Z"]) {
      const saved = await user.agent
        .patch(`/api/company-documents/${id}`)
        .send({ description: expected, expectedUpdatedAt: baseline });
      expect(saved.status).toBe(200);
      expect(saved.body.updatedAt).toBe(expected);
      baseline = saved.body.updatedAt;
    }
  });

  it("lets only one of two concurrent saves through", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { id, updatedAt } = await write(user, "Race");
    const saves = await Promise.all(
      ["a", "b", "c"].map((description) =>
        user.agent.patch(`/api/company-documents/${id}`).send({ description, expectedUpdatedAt: updatedAt }),
      ),
    );
    expect(saves.map((res) => res.status).sort()).toEqual([200, 409, 409]);
  });
});

describe("validation (F59)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("trims names and says what is wrong with one it refuses", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const folder = await user.agent.post("/api/company-document-folders").send({ name: "  Policies  " });
    expect(folder.body.name).toBe("Policies");
    const document = await user.agent.post("/api/company-documents").send({ name: "  Leave  " });
    expect(document.body.name).toBe("Leave");
    const longest = await user.agent.post("/api/company-documents").send({ name: "x".repeat(500) });
    expect(longest.status).toBe(201);

    for (const name of ["", "   ", "x".repeat(256)]) {
      for (const res of [
        await user.agent.post("/api/company-document-folders").send({ name }),
        await user.agent.patch(`/api/company-document-folders/${folder.body.id}`).send({ name }),
      ]) {
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("Folder name must be 1 to 255 characters");
        expect(res.body.errors).toBeInstanceOf(Array);
      }
    }
    for (const name of ["", "   ", "x".repeat(501)]) {
      for (const res of [
        await user.agent.post("/api/company-documents").send({ name }),
        await user.agent.patch(`/api/company-documents/${document.body.id}`).send({ name }),
      ]) {
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("Document name must be 1 to 500 characters");
        expect(res.body.errors).toBeInstanceOf(Array);
      }
    }
  });
});

describe("who may delete (F54)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("follows the Workspace Role, not the platform column", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const platformAdmin = await registerUser(app);
    await rows("UPDATE users SET role = 'admin' WHERE id = $1", [platformAdmin.id]);
    await setWorkspaceRole(platformAdmin.id, "member");

    const folder = await createFolder(platformAdmin.agent, { name: "Handbook" });
    const document = await write(platformAdmin, "Leave");

    const folderRefused = await platformAdmin.agent.delete(`/api/company-document-folders/${folder.id}`);
    expect(folderRefused.status).toBe(403);
    expect(folderRefused.body).toEqual({ message: "Only an Owner or an Administrator can delete folders" });
    const documentRefused = await platformAdmin.agent.delete(`/api/company-documents/${document.id}`);
    expect(documentRefused.status).toBe(403);
    expect(documentRefused.body).toEqual({ message: "Only an Owner or an Administrator can delete documents" });

    for (const [user, canDelete] of [[owner, true], [platformAdmin, false]] as const) {
      const list = await user.agent.get("/api/company-document-folders");
      expect(list.body[0].canDelete).toBe(canDelete);
      const one = await user.agent.get(`/api/company-document-folders/${folder.id}`);
      expect(one.body.canDelete).toBe(canDelete);
      const search = await user.agent.get("/api/company-documents/search").query({ q: "Handbook" });
      expect(search.body.folders[0].canDelete).toBe(canDelete);
    }

    expect((await owner.agent.delete(`/api/company-document-folders/${folder.id}`)).status).toBe(204);
    expect((await owner.agent.delete(`/api/company-documents/${document.id}`)).status).toBe(204);
  });

  it("answers an unseen Folder or Document as absent", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const folder = await createFolder(admin.agent, { name: "Payroll" });
    const document = await write(admin, "Ledger", folder.id);
    await admin.agent.put(`/api/company-document-folders/${folder.id}/access`).send({ level: "administrators" });

    for (const id of [folder.id, UNKNOWN]) {
      const res = await member.agent.delete(`/api/company-document-folders/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: "Folder not found" });
    }
    for (const id of [document.id, UNKNOWN]) {
      const res = await member.agent.delete(`/api/company-documents/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: "Document not found" });
    }
    expect((await admin.agent.get(`/api/company-documents/${document.id}`)).status).toBe(200);
  });
});

describe("move and rename (F54)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("moves a Document for its owner or an Administrator, and refuses anyone else", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const author = await registerUser(app);
    const colleague = await registerUser(app);
    const from = await createFolder(author.agent, { name: "From" });
    const to = await createFolder(author.agent, { name: "To" });
    const hidden = await createFolder(admin.agent, { name: "Hidden" });
    await admin.agent.put(`/api/company-document-folders/${hidden.id}/access`).send({ level: "administrators" });
    const { id } = await write(author, "Plan", from.id);
    const path = `/api/company-documents/${id}`;

    const refused = await colleague.agent.patch(path).send({ folderId: to.id });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ message: "Only the owner of this item or an Administrator can move it" });
    const same = await colleague.agent.patch(path).send({ name: "Plan B", folderId: from.id });
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({ name: "Plan B", folderId: from.id, effectiveAccess: "workspace", canManageAccess: false });

    for (const folderId of [hidden.id, UNKNOWN]) {
      const res = await author.agent.patch(path).send({ folderId });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: "The Folder does not exist in this Workspace" });
    }
    expect(await rows("SELECT id FROM audit_events WHERE action = 'document.moved'")).toEqual([]);

    const moved = await author.agent.patch(path).send({ folderId: to.id });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ id, folderId: to.id, uploadedById: author.id, canManageAccess: true });
    const events = await rows(
      "SELECT actor_kind, actor_id, resource_type, resource_id, payload, workspace_id FROM audit_events WHERE action = 'document.moved'",
    );
    expect(events).toEqual([
      {
        actor_kind: "user",
        actor_id: author.id,
        resource_type: "company_documents",
        resource_id: id,
        payload: { from: from.id, to: to.id },
        workspace_id: "seeded",
      },
    ]);

    // Into a closed Folder: the answer carries the level that now applies.
    const closed = await admin.agent.patch(path).send({ folderId: hidden.id });
    expect(closed.body).toMatchObject({ folderId: hidden.id, effectiveAccess: "administrators" });
    expect((await colleague.agent.get(path)).status).toBe(404);
    const root = await admin.agent.patch(path).send({ folderId: null });
    expect(root.body.folderId).toBeNull();
    expect((await colleague.agent.get(path)).status).toBe(200);
  });

  it("lets only an Administrator take an item out of a Folder that limits access", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const author = await registerUser(app);
    const named = await registerUser(app);
    const outsider = await registerUser(app);
    const closed = await createFolder(admin.agent, { name: "Closed" });
    const open = await createFolder(admin.agent, { name: "Open" });
    const inside = (await admin.agent.post("/api/company-document-folders").send({ name: "Inside", parentId: closed.id })).body;
    const elsewhere = await createFolder(admin.agent, { name: "Elsewhere" });
    for (const [folder, memberIds] of [[closed, [author.id, named.id]], [elsewhere, [author.id, outsider.id]]] as const) {
      await admin.agent.put(`/api/company-document-folders/${folder.id}/access`).send({ level: "restricted", memberIds });
    }
    const { id } = await write(author, "Payroll", closed.id);
    const path = `/api/company-documents/${id}`;

    for (const folderId of [null, open.id, elsewhere.id]) {
      const res = await author.agent.patch(path).send({ folderId });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Only an Administrator can move this item out of a Folder with limited access" });
    }
    expect((await outsider.agent.get(path)).status).toBe(404);

    // Deeper inside the same Folder opens nothing, and neither does coming back to it.
    expect((await author.agent.patch(path).send({ folderId: inside.id })).status).toBe(200);
    expect((await author.agent.patch(path).send({ folderId: closed.id })).status).toBe(200);
    expect((await outsider.agent.get(path)).status).toBe(404);

    expect((await admin.agent.patch(path).send({ folderId: open.id })).status).toBe(200);
    expect((await outsider.agent.get(path)).status).toBe(200);
  });

  it("keeps the index when the Folder a Document left is deleted", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const from = await createFolder(admin.agent, { name: "From" });
    const to = await createFolder(admin.agent, { name: "To" });
    const { id } = await write(admin, "Plan", from.id);
    expect((await indexed(id))[0]).toMatchObject({ folder_id: from.id, metadata: { folderName: "From", title: "Plan" } });

    expect((await admin.agent.patch(`/api/company-documents/${id}`).send({ folderId: to.id })).status).toBe(200);
    expect((await indexed(id))[0]).toMatchObject({ folder_id: to.id, metadata: { folderName: "To", title: "Plan" } });
    expect((await admin.agent.delete(`/api/company-document-folders/${from.id}`)).status).toBe(204);
    expect(await indexed(id)).toHaveLength(1);

    expect((await admin.agent.patch(`/api/company-documents/${id}`).send({ folderId: null })).status).toBe(200);
    expect((await indexed(id))[0]).toMatchObject({ folder_id: null, metadata: { folderName: "Root" } });
  });

  it("re-reads the Folder when an index write that started before a move lands after it", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const from = await createFolder(admin.agent, { name: "From" });
    const to = await createFolder(admin.agent, { name: "To" });
    const { id } = await write(admin, "Plan", from.id);
    await indexed(id);
    expect((await admin.agent.patch(`/api/company-documents/${id}`).send({ folderId: to.id })).status).toBe(200);
    const { updateCompanyDocumentEmbeddings } = await import("../../server/embeddings");
    const { inSeededWorkspace } = await import("../helpers/workspace");
    await inSeededWorkspace(() =>
      updateCompanyDocumentEmbeddings(id, from.id, "Plan", tiptap("a late edit"), "From"),
    );
    expect((await indexed(id))[0]).toMatchObject({ folder_id: to.id, metadata: { folderName: "To" } });
  });

  it("moves and renames an uploaded File, and its files row follows", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const from = await createFolder(user.agent, { name: "From" });
    const to = await createFolder(user.agent, { name: "To" });
    const issued = await user.agent.post("/api/company-documents/upload-url");
    const storagePath = completeUpload(issued.body.uploadURL, "bytes", "application/pdf");
    const file = await user.agent.post("/api/company-documents").send({
      name: "Contract",
      fileName: "contract.pdf",
      mimeType: "application/pdf",
      storagePath,
      folderId: from.id,
    });
    expect(file.status).toBe(201);
    const saved = await user.agent
      .patch(`/api/company-documents/${file.body.id}`)
      .send({ name: " Contract 2026 ", folderId: to.id, expectedUpdatedAt: file.body.updatedAt });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ name: "Contract 2026", folderId: to.id, fileName: "contract.pdf" });
    expect(await rows("SELECT name, folder_id, file_name, scan_status FROM files WHERE id = $1", [file.body.id])).toEqual([
      { name: "Contract 2026", folder_id: to.id, file_name: "contract.pdf", scan_status: "available" },
    ]);
    expect((await user.agent.get(`/api/company-documents/${file.body.id}/stream`)).status).toBe(200);

    // A stale move is refused whole: no row, no audit.
    const stale = await user.agent
      .patch(`/api/company-documents/${file.body.id}`)
      .send({ folderId: null, expectedUpdatedAt: file.body.updatedAt });
    expect(stale.status).toBe(409);
    expect(await rows("SELECT folder_id FROM files WHERE id = $1", [file.body.id])).toEqual([{ folder_id: to.id }]);
    expect(await rows("SELECT id FROM audit_events WHERE action = 'document.moved'")).toHaveLength(1);
  });
});

describe("the register and the people it names (F57, F59)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("answers every visible Folder and Document at once, without text", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app, { firstName: "Ada", lastName: "Mensah" });
    const beta = await createFolder(member.agent, { name: "Beta" });
    const alpha = await createFolder(member.agent, { name: "Alpha" });
    const vault = await createFolder(admin.agent, { name: "Vault" });
    const loose = await write(member, "Loose");
    const filed = await write(member, "Filed", beta.id);
    const secret = await write(admin, "Secret", vault.id);
    await admin.agent.put(`/api/company-document-folders/${vault.id}/access`).send({ level: "administrators" });

    const res = await member.agent.get("/api/company-documents/register");
    expect(res.status).toBe(200);
    expect(res.body.folders.map((row: { id: string }) => row.id)).toEqual([alpha.id, beta.id]);
    expect(res.body.documents.map((row: { id: string }) => row.id)).toEqual([filed.id, loose.id]);
    for (const row of res.body.documents) expect(row).not.toHaveProperty("content");
    expect(res.body.folders[0]).toMatchObject({ effectiveAccess: "workspace", canManageAccess: true, canDelete: false });
    expect(res.body.documents[0]).toMatchObject({
      folderId: beta.id,
      effectiveAccess: "workspace",
      canManageAccess: true,
      uploadedBy: { id: member.id, firstName: "Ada", lastName: "Mensah" },
    });

    const all = await admin.agent.get("/api/company-documents/register");
    expect(all.body.folders).toHaveLength(3);
    expect(all.body.documents.map((row: { id: string }) => row.id)).toContain(secret.id);
    expect((await newAgent(app).get("/api/company-documents/register")).status).toBe(401);
  });

  it("sends each person as a name, an email, and a picture", async () => {
    const app = await makeApp();
    const user = await registerAdmin(app);
    const folder = await createFolder(user.agent, { name: "People" });
    const document = await write(user, "People guide", folder.id);

    const read = async (path: string) => (await user.agent.get(path)).body;
    const search = await read("/api/company-documents/search?q=People");
    const register = await read("/api/company-documents/register");
    const stale = await user.agent
      .patch(`/api/company-documents/${document.id}`)
      .send({ name: "x", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" });
    const people = [
      (await read("/api/company-document-folders"))[0].createdBy,
      (await read(`/api/company-document-folders/${folder.id}`)).createdBy,
      (await read(`/api/company-documents?folderId=${folder.id}`))[0].uploadedBy,
      (await read(`/api/company-documents/${document.id}`)).uploadedBy,
      search.documents[0].uploadedBy,
      search.folders[0].createdBy,
      register.documents[0].uploadedBy,
      register.folders[0].createdBy,
      stale.body.current.uploadedBy,
    ];
    const { project } = await createCrmProject(user.agent, { documentationEnabled: true });
    const page = await createDocument(user.agent, project.id);
    people.push((await read(`/api/documents/${page.id}`)).createdBy);
    for (const person of people) {
      expect(Object.keys(person).sort()).toEqual(PERSON_KEYS);
      expect(person.id).toBe(user.id);
    }
  });
});

describe("objects in a Workspace Document (F56)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function upload(user: TestUser, body = "IMAGE") {
    const issued = await user.agent.post("/api/objects/upload");
    const url = completeUpload(issued.body.uploadURL, body, "image/png");
    return { url, path: objectPathFor(url), key: new URL(url).pathname.slice(1) };
  }

  it("are read by whoever reads the Document, and by nobody else", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const author = await registerUser(app);
    const member = await registerUser(app);
    const foreigner = await registerUser(app);
    const parallel = await plantParallelWorkspace();
    await removeAllMemberships(foreigner.id);
    await addWorkspaceMembership(foreigner.id, parallel, "owner");

    const { id } = await write(admin, "Guide");
    const image = await upload(author);
    const tied = await author.agent.put(`/api/company-documents/${id}/objects`).send({ objectPath: image.path });
    expect(tied.status).toBe(200);
    expect(tied.body).toEqual({ objectPath: image.path });
    expect(JSON.parse(objectMetadata(image.key)!["custom:aclPolicy"])).toEqual({
      owner: author.id,
      visibility: "private",
      aclRules: [{ group: { type: "workspace_document", id }, permission: "read" }],
    });

    for (const reader of [admin, author, member]) {
      const res = await reader.agent.get(image.path);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(Buffer.from(res.body).toString()).toBe("IMAGE");
    }
    expect((await newAgent(app).get(image.path)).status).toBe(401);
    expect((await foreigner.agent.get(image.path)).status).toBe(404);

    // The uploader is a reader like any other: losing the Document loses the object.
    const restricted = await admin.agent
      .put(`/api/company-documents/${id}/access`)
      .send({ level: "restricted", memberIds: [member.id] });
    expect(restricted.status).toBe(200);
    expect((await author.agent.get(image.path)).status).toBe(401);
    expect((await member.agent.get(image.path)).status).toBe(200);
    expect((await admin.agent.get(image.path)).status).toBe(200);

    await removeAllMemberships(member.id);
    expect((await member.agent.get(image.path)).status).toBe(404);

    expect((await admin.agent.delete(`/api/company-documents/${id}`)).status).toBe(204);
    expect((await admin.agent.get(image.path)).status).toBe(401);
  });

  it("are tied only to a Document the caller sees", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const { id } = await write(admin, "Board");
    await admin.agent.put(`/api/company-documents/${id}/access`).send({ level: "administrators" });
    const image = await upload(member);
    for (const target of [id, UNKNOWN]) {
      const res = await member.agent.put(`/api/company-documents/${target}/objects`).send({ objectPath: image.path });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: "Document not found" });
    }
    expect(objectMetadata(image.key)?.["custom:aclPolicy"]).toBeUndefined();
    expect((await newAgent(app).put(`/api/company-documents/${id}/objects`).send({ objectPath: image.path })).status).toBe(401);
  });

  it("cannot be taken over, from this route or another", async () => {
    const app = await makeApp();
    const author = await registerUser(app);
    const other = await registerUser(app);
    const mine = await write(author, "Mine");
    const theirs = await write(other, "Theirs");
    const image = await upload(author);
    const tie = (user: TestUser, document: string, objectPath: unknown) =>
      user.agent.put(`/api/company-documents/${document}/objects`).send({ objectPath });

    // The upload URL is accepted as the path is, and asking twice changes nothing.
    expect((await tie(author, mine.id, image.url)).body).toEqual({ objectPath: image.path });
    expect((await tie(author, mine.id, image.path)).status).toBe(200);
    expect((await tie(other, mine.id, image.path)).status).toBe(409);
    expect((await tie(other, theirs.id, image.path)).status).toBe(409);
    expect((await tie(author, theirs.id, image.path)).status).toBe(409);

    const before = objectMetadata(image.key)!["custom:aclPolicy"];
    for (const res of [
      await other.agent.put("/api/document-images").send({ imageURL: image.path }),
      await author.agent.put("/api/document-attachments").send({ fileURL: image.path }),
      await other.agent.post("/api/audio/upload").send({ audioUrl: image.path }),
      await other.agent.post("/api/company-documents").send({ name: "Steal", fileName: "a.png", mimeType: "image/png", storagePath: image.path }),
    ]) {
      expect(res.status).toBe(500);
    }
    expect(objectMetadata(image.key)!["custom:aclPolicy"]).toBe(before);

    // A public attachment and an uploaded File keep the policy they have.
    const shared = await upload(author);
    await author.agent.put("/api/document-attachments").send({ fileURL: shared.url });
    expect((await tie(author, mine.id, shared.path)).status).toBe(409);
    expect((await newAgent(app).get(shared.path)).status).toBe(200);
    const slot = await author.agent.post("/api/company-documents/upload-url");
    const storagePath = completeUpload(slot.body.uploadURL, "bytes", "application/pdf");
    await author.agent.post("/api/company-documents").send({ name: "F", fileName: "f.pdf", mimeType: "application/pdf", storagePath });
    expect((await tie(author, mine.id, objectPathFor(storagePath))).status).toBe(409);
  });

  it("must be files of the Active Workspace", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { id } = await write(user, "Guide");
    const { putObject } = await import("../fakes/gcs");
    const uuid = "11111111-2222-3333-4444-555555555555";
    for (const key of [
      "uploads/legacy",
      `ws/parallel/files/${uuid}/${uuid}`,
      `ws/seeded/agent-screenshots/${uuid}.png`,
    ]) {
      putObject(`test-bucket/.private/${key}`, "X", { contentType: "image/png" });
      const res = await user.agent.put(`/api/company-documents/${id}/objects`).send({ objectPath: `/objects/${key}` });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: "Object not found" });
      expect(objectMetadata(`test-bucket/.private/${key}`)?.["custom:aclPolicy"]).toBeUndefined();
    }
    const absent = await user.agent
      .put(`/api/company-documents/${id}/objects`)
      .send({ objectPath: `/objects/ws/seeded/files/${uuid}/${uuid}` });
    expect(absent.status).toBe(404);
    for (const objectPath of [undefined, "", 3]) {
      expect((await user.agent.put(`/api/company-documents/${id}/objects`).send({ objectPath })).status).toBe(400);
    }
  });
});
