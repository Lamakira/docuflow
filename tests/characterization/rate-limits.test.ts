import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";

/**
 * Characterization: the rate limiters in the middleware chain.
 *
 * Every other suite gives each agent its own forwarded IP so these budgets stay
 * out of the way; this one pins an address on purpose and spends it.
 *
 * Quirks frozen here:
 *  - The strict 20-per-15-minutes auth limiter is mounted on `/api/login` and
 *    `/api/register` — the Replit OIDC paths — not on `/api/auth/login` and
 *    `/api/auth/register`, which are what the SPA posts to. Real credential
 *    checks are therefore only covered by the loose global limit.
 *  - The global limit is 120 requests per minute per IP across `/api/`, and it
 *    counts every request, authenticated or not.
 *  - Limits are keyed on the client IP behind one trusted proxy hop, so an
 *    `X-Forwarded-For` header decides which budget a request spends.
 *  - Over the limit the response is 429 with `{ message: "Too many requests,
 *    please try again later" }` and draft-7 `RateLimit` headers.
 *  - `/health` is registered before the limiter and is never throttled.
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

  it("does not apply the strict auth limiter to the endpoints the SPA logs in through", async () => {
    const app = await makeApp();
    const ip = "203.0.113.20";

    // Twenty-five failed logins — five past the strict limiter's budget — and
    // every one of them still reaches the credential check.
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: "nobody@example.com", password: "wrong-password" });
      expect(res.status, `attempt ${i + 1}`).toBe(401);
      expect(res.body).toEqual({ message: "Invalid email or password" });
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
});
