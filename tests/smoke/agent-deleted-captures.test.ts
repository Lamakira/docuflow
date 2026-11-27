import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb, ownerDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice, bearer, PNG_1X1, type AgentDevice } from "../helpers/agent";
import { timeEntryScreenshots } from "../../shared/schema";
import { eq } from "drizzle-orm";

/** Captures an admin deleted on the web are listed for the agent, which drops its local copy. */
describe("agent deleted captures", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function trackingUser(app: Awaited<ReturnType<typeof makeApp>>) {
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProject } = await createCrmProject(user.agent, { status: "won_in_progress" });
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    return { user, device, entry };
  }

  async function capture(device: AgentDevice, timeEntryId: string, capturedAt: string) {
    const slot = await device.request.post("/api/agent/screenshots/presign").send({
      deviceId: device.deviceId,
      timeEntryId,
      capturedAt,
      clientType: "desktop",
      clientVersion: "0.1.0",
    });
    expect(slot.status).toBe(200);
    const put = await device.request.put(slot.body.uploadURL).set("Content-Type", "image/png").send(PNG_1X1);
    expect(put.status).toBe(200);
    const confirmed = await device.request
      .post("/api/agent/screenshots/confirm")
      .send({ screenshotId: slot.body.screenshotId, deviceId: device.deviceId });
    expect(confirmed.status).toBe(200);
    return slot.body.screenshotId as string;
  }

  const removeOnWeb = (admin: Awaited<ReturnType<typeof registerAdmin>>, id: string) =>
    admin.agent.delete(`/api/time-tracking/screenshots/${id}`).send({ reason: "test" });

  it("returns only the deleted capture, with the capturedAt the agent sent", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const { device, entry } = await trackingUser(app);
    const keptAt = new Date(Date.now() - 60_000).toISOString();
    const goneAt = new Date(Date.now() - 30_000).toISOString();
    await capture(device, entry.id, keptAt);
    const goneId = await capture(device, entry.id, goneAt);
    expect((await removeOnWeb(admin, goneId)).status).toBe(200);

    const res = await device.request.get("/api/agent/screenshots/deleted");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(goneId);
    expect(Date.parse(res.body.data[0].capturedAt)).toBe(Date.parse(goneAt));
  });

  it("does not return another user's deleted capture", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const a = await trackingUser(app);
    const b = await trackingUser(app);
    const id = await capture(a.device, a.entry.id, new Date().toISOString());
    expect((await removeOnWeb(admin, id)).status).toBe(200);

    const res = await b.device.request.get("/api/agent/screenshots/deleted");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("does not return a deleted capture older than since", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const { device, entry } = await trackingUser(app);
    const id = await capture(device, entry.id, new Date().toISOString());
    expect((await removeOnWeb(admin, id)).status).toBe(200);
    const old = new Date(Date.now() - 10 * 86_400_000);
    await ownerDb.update(timeEntryScreenshots).set({ capturedAt: old }).where(eq(timeEntryScreenshots.id, id));

    const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const narrow = await device.request.get(`/api/agent/screenshots/deleted?since=${encodeURIComponent(since)}`);
    expect(narrow.body.data).toEqual([]);
    const wide = await device.request.get("/api/agent/screenshots/deleted");
    expect(wide.body.data.map((r: { id: string }) => r.id)).toEqual([id]);
  });

  it("answers 401 without agent auth", async () => {
    const app = await makeApp();
    const res = await bearer(app, "nope").get("/api/agent/screenshots/deleted");
    expect(res.status).toBe(401);
  });
});
