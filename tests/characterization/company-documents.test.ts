import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createFolder, tiptap } from "../helpers/fixtures";
import { completeUpload } from "../helpers/objects";
import { fakeSignedUrl, objectMetadata, signedUrlCalls, signedUrlPattern } from "../fakes/gcs";

/**
 * Characterization: company document folders and the two kinds of document that
 * live in them — native TipTap pages and uploaded files.
 *
 * Quirks frozen here:
 *  - Anyone authenticated can create or rename a folder or document; only
 *    admins can delete either.
 *  - The upload flow is two-legged: the server issues a signed PUT URL and only
 *    hears about the file when the client posts the URL back as `storagePath`.
 *  - A `storagePath` pointing at nothing fails ACL tagging and surfaces as 500.
 *  - Streaming and downloading set a `Content-Type` from the database row, then
 *    the storage layer overwrites it with the stored object's own content type.
 *  - Deleting a document leaves the file in object storage; only the row goes.
 *  - Search returns `{ documents, folders }`, and an empty query returns both
 *    lists empty rather than everything.
 */
describe("company documents and folders (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets any user create and rename folders, but only admins delete them", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const created = await member.agent
      .post("/api/company-document-folders")
      .send({ name: "Policies", description: "HR policies" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Policies",
      description: "HR policies",
      createdById: member.id,
    });

    const list = await member.agent.get("/api/company-document-folders");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    // The creator is inlined as a raw user row.
    expect(list.body[0].createdBy).toMatchObject({ id: member.id });

    const single = await member.agent.get(`/api/company-document-folders/${created.body.id}`);
    expect(single.status).toBe(200);
    expect(single.body.id).toBe(created.body.id);

    const renamed = await member.agent
      .patch(`/api/company-document-folders/${created.body.id}`)
      .send({ name: "Handbook" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Handbook");

    const refusedDelete = await member.agent.delete(
      `/api/company-document-folders/${created.body.id}`
    );
    expect(refusedDelete.status).toBe(403);
    expect(refusedDelete.body).toEqual({ message: "Only admins can delete folders" });

    const deleted = await admin.agent.delete(`/api/company-document-folders/${created.body.id}`);
    expect(deleted.status).toBe(204);

    const missing = await admin.agent.get(
      "/api/company-document-folders/00000000-0000-0000-0000-000000000000"
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Folder not found" });
  });

  it("creates a native TipTap document and lists it by folder", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const folder = await createFolder(user.agent, { name: "Guides" });

    const created = await user.agent.post("/api/company-documents").send({
      name: "Onboarding",
      description: "How we onboard",
      content: tiptap("Welcome aboard"),
      folderId: folder.id,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Onboarding",
      description: "How we onboard",
      folderId: folder.id,
      uploadedById: user.id,
      // Native documents carry no file metadata at all.
      fileName: null,
      fileSize: null,
      mimeType: null,
      storagePath: null,
    });

    const rootDoc = await user.agent.post("/api/company-documents").send({ name: "Loose page" });
    expect(rootDoc.body.folderId).toBeNull();

    // Quirk: with no `folderId` the route does not list everything — it lists
    // documents whose folder is null, so anything filed away is invisible until
    // its folder is named explicitly.
    const all = await user.agent.get("/api/company-documents");
    expect(all.body.map((d: { id: string }) => d.id)).toEqual([rootDoc.body.id]);

    const inFolder = await user.agent.get("/api/company-documents").query({ folderId: folder.id });
    expect(inFolder.body.map((d: { id: string }) => d.id)).toEqual([created.body.id]);

    const invalid = await user.agent.post("/api/company-documents").send({ description: "no name" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");
  });

  it("issues an upload URL and registers the uploaded file against it", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const issued = await user.agent.post("/api/company-documents/upload-url");
    expect(issued.status).toBe(200);
    expect(issued.body.uploadURL).toMatch(
      signedUrlPattern("test-bucket/\\.private/uploads/[0-9a-f-]+")
    );
    expect(signedUrlCalls()).toHaveLength(1);
    expect(signedUrlCalls()[0]).toMatchObject({ bucket: "test-bucket", action: "write" });

    const storagePath = completeUpload(issued.body.uploadURL, "report bytes", "application/pdf");

    const created = await user.agent.post("/api/company-documents").send({
      name: "Q1 report",
      fileName: "q1.pdf",
      fileSize: 11,
      mimeType: "application/pdf",
      storagePath,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Q1 report",
      fileName: "q1.pdf",
      fileSize: 11,
      mimeType: "application/pdf",
    });
    // The signed URL is normalized to an internal object path before storage.
    expect(created.body.storagePath).toBe(storagePath);

    // The file is tagged private and owned by the uploader in object storage.
    const { pathname } = new URL(storagePath);
    const acl = objectMetadata(pathname.slice(1))?.["custom:aclPolicy"];
    expect(JSON.parse(acl!)).toEqual({ owner: user.id, visibility: "private" });
  });

  it("fails with 500 when the storage path points at nothing", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const res = await user.agent.post("/api/company-documents").send({
      name: "Ghost file",
      fileName: "ghost.pdf",
      mimeType: "application/pdf",
      storagePath: fakeSignedUrl("test-bucket/.private/uploads/never-uploaded"),
    });
    // Quirk: the missing object is only discovered while tagging the ACL, and
    // the generic catch reports it as a server error rather than a bad request.
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Failed to create company document" });
  });

  it("streams and downloads an uploaded file, and refuses to for a native page", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const issued = await user.agent.post("/api/company-documents/upload-url");
    const storagePath = completeUpload(issued.body.uploadURL, "PDF-BYTES", "application/pdf");
    const file = await user.agent.post("/api/company-documents").send({
      name: "Contract",
      fileName: "contract signed.pdf",
      mimeType: "application/pdf",
      storagePath,
    });

    const streamed = await user.agent
      .get(`/api/company-documents/${file.body.id}/stream`)
      .buffer(true);
    expect(streamed.status).toBe(200);
    expect(streamed.headers["content-disposition"]).toBe(
      'inline; filename="contract%20signed.pdf"'
    );
    // Quirk: the route sets Content-Type from the row, then `downloadObject`
    // overwrites it with the stored object's own content type.
    expect(streamed.headers["content-type"]).toBe("application/pdf");
    expect(streamed.headers["cache-control"]).toBe("private, max-age=3600");
    expect(Buffer.from(streamed.body).toString()).toBe("PDF-BYTES");

    const downloaded = await user.agent.get(`/api/company-documents/${file.body.id}/download`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-disposition"]).toBe(
      'attachment; filename="contract%20signed.pdf"'
    );

    const page = await user.agent
      .post("/api/company-documents")
      .send({ name: "Native page", content: tiptap("text") });

    const notStreamable = await user.agent.get(`/api/company-documents/${page.body.id}/stream`);
    expect(notStreamable.status).toBe(400);
    expect(notStreamable.body).toEqual({ message: "This document is not a streamable file" });

    const notDownloadable = await user.agent.get(`/api/company-documents/${page.body.id}/download`);
    expect(notDownloadable.status).toBe(400);
    expect(notDownloadable.body).toEqual({ message: "This document is not a downloadable file" });

    const notWord = await user.agent.get(`/api/company-documents/${file.body.id}/word-html`);
    expect(notWord.status).toBe(400);
    expect(notWord.body).toEqual({ message: "Not a Word document" });

    const notAFile = await user.agent.get(`/api/company-documents/${page.body.id}/word-html`);
    expect(notAFile.status).toBe(400);
    expect(notAFile.body).toEqual({ message: "This document is not a file" });
  });

  it("reports a registered file whose object has vanished as a 404", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const issued = await user.agent.post("/api/company-documents/upload-url");
    const storagePath = completeUpload(issued.body.uploadURL);
    const file = await user.agent.post("/api/company-documents").send({
      name: "Vanishing",
      fileName: "gone.pdf",
      mimeType: "application/pdf",
      storagePath,
    });

    // The bucket is cleared between tests; emptying it mid-test simulates a file
    // removed from storage while the row survives.
    const { resetGcs } = await import("../fakes/gcs");
    resetGcs();

    const streamed = await user.agent.get(`/api/company-documents/${file.body.id}/stream`);
    expect(streamed.status).toBe(404);
    expect(streamed.body).toEqual({ message: "File not found in storage" });

    const downloaded = await user.agent.get(`/api/company-documents/${file.body.id}/download`);
    expect(downloaded.status).toBe(404);
  });

  it("updates a document and refuses deletion to non-admins", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const created = await member.agent
      .post("/api/company-documents")
      .send({ name: "Draft", content: tiptap("first draft") });

    const updated = await member.agent
      .patch(`/api/company-documents/${created.body.id}`)
      .send({ name: "Final", content: tiptap("final draft") });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Final");

    const missing = await member.agent
      .patch("/api/company-documents/00000000-0000-0000-0000-000000000000")
      .send({ name: "Nope" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Document not found" });

    const refused = await member.agent.delete(`/api/company-documents/${created.body.id}`);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ message: "Only admins can delete company documents" });

    const deleted = await admin.agent.delete(`/api/company-documents/${created.body.id}`);
    expect(deleted.status).toBe(204);
    expect((await admin.agent.get(`/api/company-documents/${created.body.id}`)).status).toBe(404);

    // Quirk: the admin guard runs before the existence check, so an unknown id
    // is a 404 for an admin and a 403 for everyone else.
    const unknownForAdmin = await admin.agent.delete(
      "/api/company-documents/00000000-0000-0000-0000-000000000000"
    );
    expect(unknownForAdmin.status).toBe(404);
  });

  it("searches documents and folders by name, returning both lists", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const folder = await createFolder(user.agent, { name: "Security policies" });
    await user.agent
      .post("/api/company-documents")
      .send({ name: "Security handbook", folderId: folder.id });
    await user.agent.post("/api/company-documents").send({ name: "Unrelated" });

    const res = await user.agent.get("/api/company-documents/search").query({ q: "Security" });
    expect(res.status).toBe(200);
    expect(res.body.documents.map((d: { name: string }) => d.name)).toEqual(["Security handbook"]);
    expect(res.body.folders.map((f: { name: string }) => f.name)).toEqual(["Security policies"]);

    // Quirk: both searches use LIKE, which is case-sensitive in Postgres, so the
    // obvious lowercase query from a search box finds nothing.
    const lowercase = await user.agent.get("/api/company-documents/search").query({ q: "security" });
    expect(lowercase.body).toEqual({ documents: [], folders: [] });

    // Quirk: an empty query short-circuits to two empty lists.
    const blank = await user.agent.get("/api/company-documents/search").query({ q: "  " });
    expect(blank.status).toBe(200);
    expect(blank.body).toEqual({ documents: [], folders: [] });
  });
});
