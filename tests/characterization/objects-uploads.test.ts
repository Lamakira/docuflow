import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser } from "../helpers/auth";
import { completeUpload, objectPathFor } from "../helpers/objects";
import { objectMetadata, putObject } from "../fakes/gcs";
import { fakeSignedUrl, signedUrlCalls, signedUrlPattern } from "../fakes/network";
import { transcriptionCallCount } from "../fakes/openai";
import { waitFor } from "../helpers/wait";

/**
 * Characterization: signed upload URLs, object serving, and audio notes.
 *
 * Quirks frozen here:
 *  - Upload URLs come from the storage sidecar; the server only ever sees the
 *    URL, never the bytes.
 *  - `PUT /api/document-images` and `/api/document-attachments` tag whatever the
 *    caller names as **public**, owned by the caller — with no check that the
 *    object was uploaded by them.
 *  - These two routes report errors as `{ error }`, while most of the API uses
 *    `{ message }`.
 *  - `/objects/:path` authenticates optionally and answers a bare 401/404 with
 *    no body when access is denied or the object is missing.
 *  - Audio transcription runs in the background: the upload answers "pending"
 *    and the client polls `/api/audio/:id`.
 */
describe("object storage and uploads (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("issues private and public upload URLs from the storage sidecar", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const privateUrl = await user.agent.post("/api/objects/upload");
    expect(privateUrl.status).toBe(200);
    expect(privateUrl.body.uploadURL).toMatch(
      signedUrlPattern("test-bucket/\\.private/uploads/[0-9a-f-]+")
    );

    const publicUrl = await user.agent.post("/api/objects/upload-public");
    expect(publicUrl.status).toBe(200);
    expect(publicUrl.body.uploadURL).toMatch(
      signedUrlPattern("test-bucket/public/uploads/[0-9a-f-]+")
    );

    expect(signedUrlCalls().map((c) => c.method)).toEqual(["PUT", "PUT"]);
    expect(signedUrlCalls()[0].expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("tags an uploaded image or attachment as public and returns its object path", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const issued = await user.agent.post("/api/objects/upload");
    const uploaded = completeUpload(issued.body.uploadURL, "IMG", "image/png");

    const image = await user.agent.put("/api/document-images").send({ imageURL: uploaded });
    expect(image.status).toBe(200);
    expect(image.body).toEqual({ objectPath: objectPathFor(uploaded) });

    const { pathname } = new URL(uploaded);
    expect(JSON.parse(objectMetadata(pathname.slice(1))!["custom:aclPolicy"])).toEqual({
      owner: user.id,
      // Quirk: document images and attachments are always made public, whatever
      // the document they belong to.
      visibility: "public",
    });

    const missingField = await user.agent.put("/api/document-images").send({});
    expect(missingField.status).toBe(400);
    // Quirk: these routes answer with `error`, not the API-wide `message`.
    expect(missingField.body).toEqual({ error: "imageURL is required" });

    const attachmentIssued = await user.agent.post("/api/objects/upload");
    const attachment = completeUpload(attachmentIssued.body.uploadURL, "DOC", "application/pdf");
    const stored = await user.agent.put("/api/document-attachments").send({ fileURL: attachment });
    expect(stored.status).toBe(200);
    expect(stored.body).toEqual({ objectPath: objectPathFor(attachment) });

    const missingFileUrl = await user.agent.put("/api/document-attachments").send({});
    expect(missingFileUrl.status).toBe(400);
    expect(missingFileUrl.body).toEqual({ error: "fileURL is required" });

    const unknownObject = await user.agent
      .put("/api/document-images")
      .send({ imageURL: fakeSignedUrl("test-bucket/.private/uploads/nope") });
    expect(unknownObject.status).toBe(500);
    expect(unknownObject.body).toEqual({ error: "Internal server error" });
  });

  it("serves a public object to anyone and refuses a private one", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const anonymous = newAgent(app);

    const publicIssued = await owner.agent.post("/api/objects/upload");
    const publicUrl = completeUpload(publicIssued.body.uploadURL, "PUBLIC", "text/plain");
    await owner.agent.put("/api/document-images").send({ imageURL: publicUrl });
    const publicPath = objectPathFor(publicUrl);

    const asAnonymous = await anonymous.get(publicPath).buffer(true);
    expect(asAnonymous.status).toBe(200);
    expect(asAnonymous.text).toBe("PUBLIC");
    expect(asAnonymous.headers["cache-control"]).toBe("public, max-age=3600");

    // An object with no ACL is readable by nobody, logged in or not.
    const untaggedIssued = await owner.agent.post("/api/objects/upload");
    const untaggedUrl = completeUpload(untaggedIssued.body.uploadURL, "SECRET", "text/plain");
    const untaggedPath = objectPathFor(untaggedUrl);

    const refused = await stranger.agent.get(untaggedPath);
    expect(refused.status).toBe(401);
    // Quirk: `sendStatus` means the body is the status text, not JSON.
    expect(refused.text).toBe("Unauthorized");

    const missing = await stranger.agent.get("/objects/uploads/does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.text).toBe("Not Found");
  });

  it("serves public-search-path objects and forces a download when asked", async () => {
    const app = await makeApp();
    await makeApp();
    putObject("test-bucket/public/brochure.pdf", "BROCHURE", { contentType: "application/pdf" });

    const served = await newAgent(app)
      .get("/public-objects/brochure.pdf")
      .buffer(true);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body).toString()).toBe("BROCHURE");
    expect(served.headers["content-disposition"]).toBeUndefined();

    const downloaded = await newAgent(app)
      .get("/public-objects/brochure.pdf")
      .query({ download: "true", filename: "Company brochure.pdf" })
      .buffer(true);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-disposition"]).toBe(
      'attachment; filename="Company brochure.pdf"'
    );

    const missing = await newAgent(app).get("/public-objects/missing.pdf");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "File not found" });
  });

  it("accepts an audio note, transcribes it in the background, and guards the poll", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const stranger = await registerUser(app);

    const issued = await user.agent.post("/api/objects/upload");
    const audioUrl = completeUpload(issued.body.uploadURL, "OGG-BYTES", "audio/webm");

    const uploaded = await user.agent.post("/api/audio/upload").send({ audioUrl });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({
      audioUrl: objectPathFor(audioUrl),
      transcriptStatus: "pending",
    });

    const finished = await waitFor(
      async () => {
        const res = await user.agent.get(`/api/audio/${uploaded.body.id}`);
        return res.body.transcriptStatus === "completed" ? res.body : null;
      },
      { label: "audio transcription to complete" }
    );
    expect(finished.transcript).toBe("fake transcript");
    expect(transcriptionCallCount()).toBe(1);

    const foreign = await stranger.agent.get(`/api/audio/${uploaded.body.id}`);
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual({ error: "Access denied" });

    const missingUrl = await user.agent.post("/api/audio/upload").send({});
    expect(missingUrl.status).toBe(400);
    expect(missingUrl.body).toEqual({ error: "audioUrl is required" });

    const missingRecording = await user.agent.get(
      "/api/audio/00000000-0000-0000-0000-000000000000"
    );
    expect(missingRecording.status).toBe(404);
    expect(missingRecording.body).toEqual({ error: "Audio recording not found" });
  });
});
