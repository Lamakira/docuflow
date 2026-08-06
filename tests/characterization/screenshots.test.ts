import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { completeUpload, objectPathFor } from "../helpers/objects";
import { FAKE_STORAGE_ORIGIN } from "../fakes/gcs";
import type { TestUser } from "../helpers/auth";

/**
 * Characterization: time-tracking screenshots — the evidence trail behind
 * tracked time.
 *
 * Quirks frozen here:
 *  - The upload is two-legged like company documents: a signed PUT URL first,
 *    then a metadata post carrying the storage key back.
 *  - `storageKey` is normalized but never validated against storage, so a row
 *    can point at an object that does not exist; the failure only shows when
 *    someone asks for the image.
 *  - `crmProjectId` in the metadata post is taken on trust — it is not checked
 *    against the time entry it belongs to.
 *  - Listing caps `limit` at 100 and enriches every row with its entry's
 *    duration and idle time.
 *  - Deleting is a tombstone, not a delete: the row stays and the image route
 *    starts answering 410.
 */
describe("time-tracking screenshots (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function runningEntry(app: Awaited<ReturnType<typeof makeApp>>) {
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    return { user, crmProjectId: crmProject.id, entry };
  }

  /**
   * Both legs of a capture: take a signed URL, stand in for the browser's PUT,
   * then post the metadata back. `uploadedUrl` comes back too because the row
   * stores a normalized form of it, not the URL itself.
   */
  async function captureScreenshot(
    user: TestUser,
    entryId: string,
    crmProjectId: string,
    extra: Record<string, unknown> = {}
  ) {
    const issued = await user.agent
      .post("/api/time-tracking/screenshots/upload-url")
      .send({ timeEntryId: entryId });
    const uploadedUrl = completeUpload(issued.body.uploadURL, "PNG-BYTES", "image/png");

    const created = await user.agent.post("/api/time-tracking/screenshots").send({
      timeEntryId: entryId,
      crmProjectId,
      storageKey: uploadedUrl,
      ...extra,
    });
    return { created, uploadedUrl };
  }

  it("issues an upload URL only for the caller's own entry", async () => {
    const app = await makeApp();
    const { user, entry } = await runningEntry(app);
    const stranger = await registerUser(app);

    const missingId = await user.agent.post("/api/time-tracking/screenshots/upload-url").send({});
    expect(missingId.status).toBe(400);
    expect(missingId.body).toEqual({ message: "timeEntryId is required" });

    const unknownEntry = await user.agent
      .post("/api/time-tracking/screenshots/upload-url")
      .send({ timeEntryId: "00000000-0000-0000-0000-000000000000" });
    expect(unknownEntry.status).toBe(404);
    expect(unknownEntry.body).toEqual({ message: "Time entry not found" });

    const foreign = await stranger.agent
      .post("/api/time-tracking/screenshots/upload-url")
      .send({ timeEntryId: entry.id });
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual({ message: "Not authorized" });

    const issued = await user.agent
      .post("/api/time-tracking/screenshots/upload-url")
      .send({ timeEntryId: entry.id });
    expect(issued.status).toBe(200);
    expect(issued.body.uploadURL).toContain(`${FAKE_STORAGE_ORIGIN}/test-bucket/`);
  });

  it("records a screenshot against an entry and serves the image back", async () => {
    const app = await makeApp();
    const { user, crmProjectId, entry } = await runningEntry(app);

    const { created, uploadedUrl } = await captureScreenshot(user, entry.id, crmProjectId, {
      capturedAt: "2026-05-01T12:00:00.000Z",
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      timeEntryId: entry.id,
      userId: user.id,
      crmProjectId,
      // The signed URL is stored as an internal object path.
      storageKey: objectPathFor(uploadedUrl),
      deletedAt: null,
    });
    expect(created.body.capturedAt).toBe("2026-05-01T12:00:00.000Z");

    const image = await user.agent
      .get(`/api/time-tracking/screenshots/${created.body.id}/image`)
      .buffer(true);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(image.body).toString()).toBe("PNG-BYTES");

    const missingFields = await user.agent
      .post("/api/time-tracking/screenshots")
      .send({ timeEntryId: entry.id });
    expect(missingFields.status).toBe(400);
    expect(missingFields.body).toEqual({
      message: "timeEntryId, crmProjectId, and storageKey are required",
    });
  });

  it("stores a storage key that points at nothing, and only fails when it is read", async () => {
    const app = await makeApp();
    const { user, crmProjectId, entry } = await runningEntry(app);

    const created = await user.agent.post("/api/time-tracking/screenshots").send({
      timeEntryId: entry.id,
      crmProjectId,
      storageKey: "/objects/uploads/never-uploaded",
    });
    // Quirk: nothing verifies the object exists at write time.
    expect(created.status).toBe(200);
    expect(created.body.storageKey).toBe("/objects/uploads/never-uploaded");

    const image = await user.agent.get(`/api/time-tracking/screenshots/${created.body.id}/image`);
    expect(image.status).toBe(404);
    expect(image.body).toEqual({ message: "Screenshot file not found" });
  });

  it("lists screenshots with entry metrics, scoped to the caller unless they are an admin", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const { user, crmProjectId, entry } = await runningEntry(app);

    const { created } = await captureScreenshot(user, entry.id, crmProjectId);

    const mine = await user.agent.get("/api/time-tracking/screenshots");
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ total: 1, limit: 50, offset: 0 });
    expect(mine.body.data[0]).toMatchObject({
      id: created.body.id,
      entryDuration: 0,
      entryIdleTime: 0,
    });

    // Quirk: `limit` is clamped to 100 however large the request.
    const clamped = await user.agent.get("/api/time-tracking/screenshots").query({ limit: 5000 });
    expect(clamped.body.limit).toBe(100);

    const adminSeesAll = await admin.agent.get("/api/time-tracking/screenshots");
    expect(adminSeesAll.body.total).toBe(1);

    const adminFiltered = await admin.agent
      .get("/api/time-tracking/screenshots")
      .query({ userId: admin.id });
    expect(adminFiltered.body.total).toBe(0);

    const otherUser = await registerUser(app);
    const notMine = await otherUser.agent.get("/api/time-tracking/screenshots");
    expect(notMine.body.total).toBe(0);

    const foreignImage = await otherUser.agent.get(
      `/api/time-tracking/screenshots/${created.body.id}/image`
    );
    expect(foreignImage.status).toBe(403);
    expect(foreignImage.body).toEqual({ message: "Not authorized" });

    // An admin may look at anyone's evidence.
    const adminImage = await admin.agent
      .get(`/api/time-tracking/screenshots/${created.body.id}/image`)
      .buffer(true);
    expect(adminImage.status).toBe(200);
  });

  it("tombstones a screenshot on admin delete and answers 410 afterwards", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const { user, crmProjectId, entry } = await runningEntry(app);

    const { created } = await captureScreenshot(user, entry.id, crmProjectId);

    const refused = await user.agent.delete(`/api/time-tracking/screenshots/${created.body.id}`);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ message: "Admin only" });

    const deleted = await admin.agent
      .delete(`/api/time-tracking/screenshots/${created.body.id}`)
      .send({ reason: "contained a password" });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({
      id: created.body.id,
      deletedBy: admin.id,
      deleteReason: "contained a password",
    });
    expect(typeof deleted.body.deletedAt).toBe("string");

    const image = await user.agent.get(`/api/time-tracking/screenshots/${created.body.id}/image`);
    expect(image.status).toBe(410);
    expect(image.body.message).toBe("Screenshot has been removed");
    expect(typeof image.body.deletedAt).toBe("string");

    // The listing hides tombstoned rows entirely, so a client that only lists
    // never learns the evidence existed — the 410 above is the sole trace.
    const list = await user.agent.get("/api/time-tracking/screenshots");
    expect(list.body.total).toBe(0);
    expect(list.body.data).toEqual([]);

    const again = await admin.agent.delete(`/api/time-tracking/screenshots/${created.body.id}`);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe("Screenshot already deleted");

    const missing = await admin.agent.delete(
      "/api/time-tracking/screenshots/00000000-0000-0000-0000-000000000000"
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Screenshot not found" });
  });
});
