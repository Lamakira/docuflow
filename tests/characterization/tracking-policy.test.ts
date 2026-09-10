import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerAdmin, registerUser } from "../helpers/auth";
import { DEFAULT_SCREENSHOT_POLICY } from "../../shared/schema";

/**
 * Member-readable Tracking Policy (#191). Seam: HTTP `/api/*`.
 * Members can inspect the policy applied to them; writes stay on org-settings.
 */

describe("Tracking Policy HTTP (#191)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets a Member inspect the Tracking Policy applied in the Active Workspace", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const admin = await registerAdmin(app);

    const anonymous = await newAgent(app).get("/api/time-tracking/tracking-policy");
    expect(anonymous.status).toBe(401);

    const before = await member.agent.get("/api/time-tracking/tracking-policy");
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ screenshotPolicy: DEFAULT_SCREENSHOT_POLICY });

    const patched = await admin.agent.patch("/api/admin/org-settings").send({
      screenshotPolicy: { screenshotsEnabled: false, idleTimeoutMinutes: 15 },
    });
    expect(patched.status).toBe(200);

    const after = await member.agent.get("/api/time-tracking/tracking-policy");
    expect(after.status).toBe(200);
    expect(after.body.screenshotPolicy).toMatchObject({
      screenshotsEnabled: false,
      idleTimeoutMinutes: 15,
      captureIntervalMinMin: 3,
    });
  });
});
