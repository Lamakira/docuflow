import { describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { newAgent } from "../helpers/auth";

/**
 * `/health` says which build answered (#229, Defect D). Seam: HTTP.
 *
 * Liveness alone let a four-hour-old server pass for the current one during the
 * Phase 8 Stripe run, so the identity is part of the contract now. Still
 * unauthenticated, still ahead of the rate limiter.
 */

describe("health identity", () => {
  it("reports the commit and when this process started, not only that it is alive", async () => {
    const app = await makeApp();

    const health = await newAgent(app).get("/health");

    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(typeof health.body.timestamp).toBe("string");

    expect(typeof health.body.commit).toBe("string");
    expect(health.body.commit.length).toBeGreaterThan(0);
    expect(typeof health.body.startedAt).toBe("string");
    expect(Number.isNaN(Date.parse(health.body.startedAt))).toBe(false);
  });

  it("holds startedAt still across calls, so it dates the process and not the request", async () => {
    const app = await makeApp();
    const anonymous = newAgent(app);

    const first = await anonymous.get("/health");
    const second = await anonymous.get("/health");

    expect(second.body.startedAt).toBe(first.body.startedAt);
    expect(second.body.timestamp).not.toBe(first.body.timestamp);
  });
});
