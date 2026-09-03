import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice, PNG_1X1, type AgentDevice } from "../helpers/agent";

/**
 * Characterization: the rate limiters in the middleware chain.
 *
 * Every other suite gives each agent its own forwarded IP so these budgets stay
 * out of the way; this one pins an address on purpose and spends it.
 *
 * Quirks frozen here:
 *  - The strict 20-per-15-minutes auth limiter is mounted on `/api/login` and
 *    `/api/register` — the Replit OIDC paths — not on `/api/auth/login` and
 *    `/api/auth/register`, which is where the SPA used to post credentials.
 *    Since #110 those two answer 410 and hold no credential to guess, so the
 *    misplacement no longer leaves a real check on the loose global limit; it is
 *    still frozen here because #111 is what removes both paths.
 *  - The global limit is 120 requests per minute per IP across `/api/`, and it
 *    counts every request, authenticated or not.
 *  - Limits are keyed on the client IP behind one trusted proxy hop, so an
 *    `X-Forwarded-For` header decides which budget a request spends.
 *  - Over the limit the response is 429 with `{ message: "Too many requests,
 *    please try again later" }` and draft-7 `RateLimit` headers.
 *  - `/health` is registered before the limiter and is never throttled.
 *  - The screenshot limiter is mounted on the `/api/agent/screenshots/` prefix,
 *    so presign, upload and confirm share one 10-per-minute budget keyed on the
 *    address — three requests per capture, and every device behind one address
 *    spends the same allowance.
 */
describe("rate limiting (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("throttles /api/ at 120 requests per minute per client IP", async () => {
    const app = await makeApp();
    const ip = "203.0.113.10";

    let lastAllowed: Awaited<ReturnType<typeof request>> | undefined;
    for (let i = 0; i < 120; i++) {
      lastAllowed = await request(app).get("/api/ping").set("X-Forwarded-For", ip);
      expect(lastAllowed.status, `request ${i + 1}`).toBe(200);
    }
    // draft-7 reports the budget in one combined header, not the legacy split ones.
    expect(lastAllowed!.headers["ratelimit"]).toMatch(/^limit=120, remaining=0, reset=\d+$/);
    expect(lastAllowed!.headers["ratelimit-limit"]).toBeUndefined();

    const throttled = await request(app).get("/api/ping").set("X-Forwarded-For", ip);
    expect(throttled.status).toBe(429);
    expect(throttled.body).toEqual({ message: "Too many requests, please try again later" });

    // A different client IP has its own untouched budget.
    const otherClient = await request(app).get("/api/ping").set("X-Forwarded-For", "203.0.113.11");
    expect(otherClient.status).toBe(200);

    // `/health` sits before the limiter and keeps answering.
    const health = await request(app).get("/health").set("X-Forwarded-For", ip);
    expect(health.status).toBe(200);
  });

  it("does not apply the strict auth limiter to the endpoints the SPA logged in through", async () => {
    const app = await makeApp();
    const ip = "203.0.113.20";

    // Twenty-five posts — five past the strict limiter's budget — and every one
    // of them still reaches the route rather than the limiter.
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: "nobody@example.com", password: "wrong-password" });
      expect(res.status, `attempt ${i + 1}`).toBe(410);
    }

    // The limiter that was meant to stop this guards the OIDC path instead.
    const oidcIp = "203.0.113.21";
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await request(app).post("/api/register").set("X-Forwarded-For", oidcIp).send({});
      statuses.push(res.status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
  });

  it("spends one screenshot budget per address across presign, upload and confirm", async () => {
    const app = await makeApp();
    const ip = "203.0.113.30";
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const secondDevice = await loginDevice(app, user);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);

    /** A screenshot-route request pinned to `ip`, whichever device sends it. */
    const pin = (dev: AgentDevice, method: "post" | "put", path: string) =>
      request(app)
        [method](path)
        .set("Authorization", `Bearer ${dev.accessToken}`)
        .set("X-Forwarded-For", ip);

    const presign = (dev: AgentDevice) =>
      pin(dev, "post", "/api/agent/screenshots/presign").send({
        deviceId: dev.deviceId,
        timeEntryId: entry.id,
        capturedAt: new Date().toISOString(),
        clientType: "desktop",
        clientVersion: "0.1.0",
      });

    // One capture is three requests off the same budget: the draft-7 header
    // counts down 9, 8, 7 as presign, upload and confirm each spend from it.
    const slot = await presign(device);
    expect(slot.status).toBe(200);
    expect(slot.headers["ratelimit"]).toMatch(/^limit=10, remaining=9,/);

    const uploaded = await pin(device, "put", slot.body.uploadURL)
      .set("Content-Type", "image/png")
      .send(PNG_1X1);
    expect(uploaded.status).toBe(200);
    expect(uploaded.headers["ratelimit"]).toMatch(/^limit=10, remaining=8,/);

    const confirmed = await pin(device, "post", "/api/agent/screenshots/confirm").send({
      screenshotId: slot.body.screenshotId,
      deviceId: device.deviceId,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers["ratelimit"]).toMatch(/^limit=10, remaining=7,/);

    // Seven presigns exhaust what the capture left behind.
    for (let i = 0; i < 7; i++) {
      expect((await presign(device)).status, `presign ${i + 1}`).toBe(200);
    }

    // The eleventh request carries the screenshot limiter's own message, not the
    // global limiter's.
    const limited = await presign(device);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Screenshot upload rate limit exceeded" });

    // The budget is keyed on the address, not the device: a second device sharing
    // it is refused on its first request.
    const fromSecondDevice = await presign(secondDevice);
    expect(fromSecondDevice.status).toBe(429);

    // Agent routes outside the prefix keep answering — they spend the global budget.
    const elsewhere = await request(app)
      .get("/api/agent/timer/active")
      .set("Authorization", `Bearer ${device.accessToken}`)
      .set("X-Forwarded-For", ip);
    expect(elsewhere.status).toBe(200);
  });
});
