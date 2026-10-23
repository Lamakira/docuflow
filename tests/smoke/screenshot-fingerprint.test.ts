import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { hammingDistance, isSimilarFingerprint, SIMILAR_MAX_HAMMING_DISTANCE } from "../../shared/activityEvidence";
import { makeApp } from "../helpers/app";
import { ownerDb, resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice } from "../helpers/agent";
import { screenPng } from "../helpers/screens";

/**
 * #341. A capture is fingerprinted with a difference hash when it is uploaded,
 * so "Similar" never needs to decode an image at list time.
 */
describe("capture fingerprint (#341)", () => {
  it("is 16 lowercase hex digits and stable", async () => {
    const { differenceHash, loadSharp } = await import("../../server/modules/activity/fingerprint");
    const sharp = await loadSharp();
    const png = await screenPng("editor");
    const a = await differenceHash(sharp, png);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await differenceHash(sharp, png)).toBe(a);
  });

  it("treats the same screen with another clock as Similar, another layout as not", async () => {
    const { differenceHash, loadSharp } = await import("../../server/modules/activity/fingerprint");
    const sharp = await loadSharp();
    const at1041 = await differenceHash(sharp, await screenPng("editor", "10:41"));
    const at1042 = await differenceHash(sharp, await screenPng("editor", "10:42"));
    const browser = await differenceHash(sharp, await screenPng("browser", "10:41"));

    expect(hammingDistance(at1041, at1042)!).toBeLessThanOrEqual(SIMILAR_MAX_HAMMING_DISTANCE);
    expect(isSimilarFingerprint(at1041, at1042)).toBe(true);
    expect(hammingDistance(at1041, browser)!).toBeGreaterThan(SIMILAR_MAX_HAMMING_DISTANCE);
    expect(isSimilarFingerprint(at1041, browser)).toBe(false);
  });

  it("is null without sharp or for bytes that are not an image", async () => {
    const { differenceHash, loadSharp } = await import("../../server/modules/activity/fingerprint");
    expect(await differenceHash(null, await screenPng("editor"))).toBeNull();
    expect(await differenceHash(await loadSharp(), Buffer.from("not an image"))).toBeNull();
  });

  describe("at upload", () => {
    beforeEach(async () => {
      await resetDb();
    });

    async function slot() {
      const app = await makeApp();
      const user = await registerUser(app);
      const device = await loginDevice(app, user);
      const { crmProject } = await createCrmProject(user.agent);
      const task = await createTask(user.agent, crmProject.id);
      const entry = await startTimer(user.agent, crmProject.id, task.id);
      const presigned = await device.request.post("/api/agent/screenshots/presign").send({
        deviceId: device.deviceId,
        timeEntryId: entry.id,
        capturedAt: new Date().toISOString(),
        clientType: "desktop",
        clientVersion: "0.1.0",
      });
      return { device, screenshotId: presigned.body.screenshotId as string, uploadURL: presigned.body.uploadURL as string };
    }

    async function row(id: string) {
      const { timeEntryScreenshots } = await import("../../shared/schema");
      const { eq } = await import("drizzle-orm");
      const [r] = await ownerDb.select().from(timeEntryScreenshots).where(eq(timeEntryScreenshots.id, id));
      return r;
    }

    it("stores the fingerprint of the PNG and leaves the content hash as the PNG's SHA-256", async () => {
      const { device, screenshotId, uploadURL } = await slot();
      const png = await screenPng("editor");

      const res = await device.request.put(uploadURL).set("Content-Type", "image/png").send(png);
      expect(res.status).toBe(200);

      const stored = await row(screenshotId);
      const { differenceHash, loadSharp } = await import("../../server/modules/activity/fingerprint");
      expect(stored.perceptualHash).toBe(await differenceHash(await loadSharp(), png));
      expect(stored.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
      expect(stored.contentHash).toBe(createHash("sha256").update(png).digest("hex"));
    });
  });
});
