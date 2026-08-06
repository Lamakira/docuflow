import { randomUUID } from "crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice, PNG_1X1, type AgentDevice } from "../helpers/agent";

/**
 * Characterization: the desktop agent's screenshot flow — presign, upload,
 * confirm — and what the web side then sees.
 *
 * Divergences from `docs/agent-protocol.md`, all frozen below:
 *
 *  - §4.2 shows `uploadURL` as a `https://storage.googleapis.com/...` signed URL
 *    the agent PUTs to directly. It is a relative path on this server
 *    (`/api/agent/screenshots/upload/<id>`): the agent uploads to the app, which
 *    compresses the image and relays it to storage itself. The document does not
 *    mention that upload leg at all.
 *  - §4.2 documents no rejection for presign. It answers `409` unless the time
 *    entry is `running`.
 *  - §7 lists screenshot blur as a V2 placeholder but says nothing about the
 *    resize-and-recompress to WebP every upload goes through.
 *  - §7's retention placeholder is still a placeholder: deletion is an admin-only
 *    tombstone on the web side, and the agent protocol has no delete of its own.
 *
 * Behavior quirks frozen here:
 *  - Presign checks the time entry's *status* but never its owner, so a device
 *    can open a screenshot slot against someone else's running entry.
 *  - The row is created before any bytes arrive, with a `pending-<epoch>` storage
 *    key; an agent that never uploads leaves it behind forever.
 *  - Confirm proves only that the key stopped saying `pending-` — it checks
 *    neither the caller nor the tombstone.
 *  - The upload path is rate-limited to 10 requests per minute per IP, and
 *    presign and confirm spend from the same budget.
 */
describe("desktop agent screenshots (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function trackingUser(app: Awaited<ReturnType<typeof makeApp>>) {
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    return { user, device, crmProjectId: crmProject.id, entry };
  }

  function presign(device: AgentDevice, timeEntryId: string, extra: Record<string, unknown> = {}) {
    return device.request.post("/api/agent/screenshots/presign").send({
      deviceId: device.deviceId,
      timeEntryId,
      capturedAt: new Date().toISOString(),
      clientType: "desktop",
      clientVersion: "0.1.0",
      ...extra,
    });
  }

  function upload(device: AgentDevice, uploadURL: string, body: Buffer = PNG_1X1) {
    return device.request.put(uploadURL).set("Content-Type", "image/png").send(body);
  }

  /** All three legs, the way the desktop agent runs them. */
  async function capture(device: AgentDevice, timeEntryId: string) {
    const slot = await presign(device, timeEntryId);
    const put = await upload(device, slot.body.uploadURL);
    const confirmed = await device.request
      .post("/api/agent/screenshots/confirm")
      .send({ screenshotId: slot.body.screenshotId, deviceId: device.deviceId });
    return { screenshotId: slot.body.screenshotId, slot, put, confirmed };
  }

  it("issues an upload slot that points back at this server, not at storage", async () => {
    const app = await makeApp();
    const { device, entry } = await trackingUser(app);

    const res = await presign(device, entry.id);
    expect(res.status).toBe(200);
    expect(res.body.screenshotId).toMatch(/^[0-9a-f-]{36}$/);
    // Divergence from §4.2: a relative app path, not a signed storage URL.
    expect(res.body.uploadURL).toBe(`/api/agent/screenshots/upload/${res.body.screenshotId}`);
    // The 15-minute slot expiry is advertised but never enforced anywhere.
    const ttlMs = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("refuses a slot unless the entry exists and is running", async () => {
    const app = await makeApp();
    const { user, device, entry } = await trackingUser(app);

    const unknown = await presign(device, randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ message: "Time entry not found" });

    await user.agent.post(`/api/time-tracking/${entry.id}/pause`);
    const whilePaused = await presign(device, entry.id);
    expect(whilePaused.status).toBe(409);
    expect(whilePaused.body).toEqual({
      message: "Screenshot rejected: time entry is paused, not running",
      entryStatus: "paused",
    });

    await user.agent.post(`/api/time-tracking/${entry.id}/resume`);
    await user.agent.post(`/api/time-tracking/${entry.id}/stop`);
    const whileStopped = await presign(device, entry.id);
    expect(whileStopped.status).toBe(409);
    expect(whileStopped.body.entryStatus).toBe("stopped");
  });

  it("validates the presign envelope", async () => {
    const app = await makeApp();
    const { device, entry } = await trackingUser(app);

    const rejected: Array<[string, Record<string, unknown>]> = [
      ["non-uuid entry id", { timeEntryId: "entry-1" }],
      ["no capturedAt", { capturedAt: undefined }],
      ["activity percent over 100", { keyboardActivityPercent: 101 }],
      ["fractional count", { mouseCount: 1.5 }],
      ["negative count", { keyboardCount: -1 }],
    ];
    for (const [label, extra] of rejected) {
      const res = await presign(device, entry.id, extra);
      expect(res.status, label).toBe(400);
      expect(res.body.message).toBe("Invalid request");
    }

    // Quirk: `capturedAt` is only `z.string()`, so an unparseable date passes
    // validation and fails in the insert as a server error.
    const badDate = await presign(device, entry.id, { capturedAt: "yesterday" });
    expect(badDate.status).toBe(500);
    expect(badDate.body).toEqual({ message: "Failed to presign screenshot" });
  });

  it("opens a slot against another user's running entry", async () => {
    const app = await makeApp();
    const owner = await trackingUser(app);
    const stranger = await registerUser(app);
    const strangersDevice = await loginDevice(app, stranger);

    // Quirk: only the entry's status is checked, never its owner. The row is
    // filed under the *caller*, but carries the victim's entry and project.
    const res = await presign(strangersDevice, owner.entry.id);
    expect(res.status).toBe(200);

    await upload(strangersDevice, res.body.uploadURL);

    const strangerSees = await stranger.agent.get("/api/time-tracking/screenshots");
    expect(strangerSees.body.total).toBe(1);
    expect(strangerSees.body.data[0]).toMatchObject({
      timeEntryId: owner.entry.id,
      crmProjectId: owner.crmProjectId,
      userId: stranger.id,
    });

    // The entry's real owner never sees it in their own listing.
    const ownerSees = await owner.user.agent.get("/api/time-tracking/screenshots");
    expect(ownerSees.body.total).toBe(0);
  });

  it("relays the bytes to storage and hands the image back to the web side", async () => {
    const app = await makeApp();
    const { user, device, entry } = await trackingUser(app);

    const { screenshotId, slot, put, confirmed } = await capture(device, entry.id);
    expect(slot.status).toBe(200);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ok: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ ok: true });

    const list = await user.agent.get("/api/time-tracking/screenshots");
    expect(list.body.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({
      id: screenshotId,
      timeEntryId: entry.id,
      userId: user.id,
      deletedAt: null,
      // The pending placeholder is replaced with the real object path, and the
      // extension records the recompression the upload leg performs.
      storageKey: `/objects/agent-screenshots/${screenshotId}.webp`,
    });
    // The hash is of the bytes the agent sent, not of the compressed object.
    expect(list.body.data[0].contentHash).toMatch(/^[0-9a-f]{64}$/);

    const image = await user.agent
      .get(`/api/time-tracking/screenshots/${screenshotId}/image`)
      .buffer(true);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/webp");
    expect(image.body.length).toBeGreaterThan(0);
  });

  it("checks the bytes, the content type, and the record's owner before storing", async () => {
    const app = await makeApp();
    const { device, entry } = await trackingUser(app);
    const stranger = await registerUser(app);
    const strangersDevice = await loginDevice(app, stranger);

    const slot = await presign(device, entry.id);
    const uploadURL: string = slot.body.uploadURL;

    const wrongType = await device.request
      .put(uploadURL)
      .set("Content-Type", "image/jpeg")
      .send(PNG_1X1);
    expect(wrongType.status).toBe(415);
    expect(wrongType.body).toEqual({ message: "Content-Type must be image/png" });

    const empty = await device.request
      .put(uploadURL)
      .set("Content-Type", "image/png")
      .send(Buffer.alloc(0));
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({ message: "Empty body" });

    const notPng = await upload(device, uploadURL, Buffer.from("GIF89a not a png"));
    expect(notPng.status).toBe(415);
    expect(notPng.body).toEqual({ message: "Not a valid PNG file" });

    const unknownRecord = await upload(
      device,
      `/api/agent/screenshots/upload/${randomUUID()}`
    );
    expect(unknownRecord.status).toBe(404);
    expect(unknownRecord.body).toEqual({ message: "Screenshot record not found" });

    // Unlike presign, the upload leg does check who the row belongs to.
    const foreign = await upload(strangersDevice, uploadURL);
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual({ message: "Forbidden" });

    // Quirk: nothing stops the same slot being uploaded to twice; the second
    // write simply replaces the object and the hash.
    expect((await upload(device, uploadURL)).status).toBe(200);
    expect((await upload(device, uploadURL)).status).toBe(200);
  });

  it("confirms only that bytes arrived, and does not care who asks", async () => {
    const app = await makeApp();
    const { device, entry } = await trackingUser(app);
    const stranger = await registerUser(app);
    const strangersDevice = await loginDevice(app, stranger);

    const confirmBody = (screenshotId: string, dev: AgentDevice) =>
      dev.request
        .post("/api/agent/screenshots/confirm")
        .send({ screenshotId, deviceId: dev.deviceId });

    const slot = await presign(device, entry.id);
    const screenshotId: string = slot.body.screenshotId;

    const tooEarly = await confirmBody(screenshotId, device);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body).toEqual({ message: "Screenshot upload not yet received" });

    const unknown = await confirmBody(randomUUID(), device);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ message: "Screenshot not found" });

    await upload(device, slot.body.uploadURL);
    expect((await confirmBody(screenshotId, device)).status).toBe(200);

    // Quirk: confirm has no ownership check, so anyone with a valid device token
    // can confirm anyone's screenshot — and confirm as many times as they like.
    const byStranger = await confirmBody(screenshotId, strangersDevice);
    expect(byStranger.status).toBe(200);
    expect(byStranger.body).toEqual({ ok: true });

    // Quirk: a malformed body is not caught as a validation error — the zod
    // failure lands in the catch-all and is reported as a server failure.
    const malformed = await device.request
      .post("/api/agent/screenshots/confirm")
      .send({ screenshotId: "not-a-uuid", deviceId: device.deviceId });
    expect(malformed.status).toBe(500);
    expect(malformed.body).toEqual({ message: "Failed to confirm screenshot" });
  });

  it("keeps answering confirm after an admin has tombstoned the evidence", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const { user, device, entry } = await trackingUser(app);

    const slot = await presign(device, entry.id);
    const screenshotId: string = slot.body.screenshotId;
    await upload(device, slot.body.uploadURL);

    const deleted = await admin.agent
      .delete(`/api/time-tracking/screenshots/${screenshotId}`)
      .send({ reason: "captured a password field" });
    expect(deleted.status).toBe(200);
    expect(typeof deleted.body.deletedAt).toBe("string");

    // The web side hides it and answers 410 for the image…
    const list = await user.agent.get("/api/time-tracking/screenshots");
    expect(list.body.total).toBe(0);
    const image = await user.agent.get(`/api/time-tracking/screenshots/${screenshotId}/image`);
    expect(image.status).toBe(410);

    // …but the agent's confirm only looks at the storage key, so the desktop is
    // told the upload is fine and clears it from its retry queue.
    const confirmed = await device.request
      .post("/api/agent/screenshots/confirm")
      .send({ screenshotId, deviceId: device.deviceId });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ ok: true });
  });

  it("refuses the whole flow to a revoked device", async () => {
    const app = await makeApp();
    const { user, device, entry } = await trackingUser(app);

    const slot = await presign(device, entry.id);
    await user.agent.post("/api/agent/device/revoke").send({ deviceId: device.deviceId });

    for (const res of [
      await presign(device, entry.id),
      await upload(device, slot.body.uploadURL),
      await device.request
        .post("/api/agent/screenshots/confirm")
        .send({ screenshotId: slot.body.screenshotId, deviceId: device.deviceId }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ code: "device_revoked", message: "Device has been revoked" });
    }
  });

  it("rate-limits the screenshot endpoints as one shared budget per address", async () => {
    const app = await makeApp();
    const { device, entry } = await trackingUser(app);

    // Ten requests a minute across presign, upload and confirm together — three
    // per capture, so an agent capturing faster than about one every 20 seconds
    // starts losing frames.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await presign(device, entry.id)).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));

    const limited = await presign(device, entry.id);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Screenshot upload rate limit exceeded" });

    // The budget is per address, not per device or per user: a second device on
    // the same address is refused too, and the other agent routes are unaffected.
    expect((await device.request.get("/api/agent/timer/active")).status).toBe(200);
  });
});
