import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createCrmProject } from "../helpers/fixtures";

/**
 * Characterization: the notification bell, org-wide settings, and the two
 * read-only endpoints the SPA reads them through.
 *
 * Quirks frozen here:
 *  - Marking a notification read answers `{ success: true }` whether or not the
 *    id exists or belongs to the caller.
 *  - `PATCH /api/admin/org-settings` refuses an empty payload with 400 "Nothing
 *    to update", and validates each section separately — a request carrying two
 *    sections stops at the first invalid one, having applied nothing.
 *  - The interval bounds are only checked when `captureIntervalMinMin` is
 *    present, so a lone out-of-range `captureIntervalMaxMin` is accepted.
 *  - `GET /api/help-center/screenshot-map` always returns every allowlisted slot,
 *    filling unset ones with null.
 */
describe("notifications and org settings (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists a user's notifications and counts the unread ones", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Olive" });
    const teammate = await registerUser(app);
    const { crmProject } = await createCrmProject(owner.agent, { name: "Notify" });

    const empty = await teammate.agent.get("/api/notifications");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
    expect((await teammate.agent.get("/api/notifications/unread-count")).body).toEqual({ count: 0 });

    await owner.agent
      .patch(`/api/crm/projects/${crmProject.id}`)
      .send({ assigneeId: teammate.id });
    await owner.agent
      .post(`/api/crm/projects/${crmProject.id}/notes`)
      .send({ content: "ping", mentionedUserIds: [teammate.id] });

    const list = await teammate.agent.get("/api/notifications");
    expect(list.body).toHaveLength(2);
    expect(list.body.map((n: { type: string }) => n.type).sort()).toEqual(["assignment", "mention"]);
    expect((await teammate.agent.get("/api/notifications/unread-count")).body).toEqual({ count: 2 });

    // The author sees none of it.
    expect((await owner.agent.get("/api/notifications")).body).toEqual([]);

    const marked = await teammate.agent.patch(`/api/notifications/${list.body[0].id}/read`);
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual({ success: true });
    expect((await teammate.agent.get("/api/notifications/unread-count")).body).toEqual({ count: 1 });

    // Quirk: marking someone else's notification, or one that does not exist,
    // is also a success — the update simply matches no rows.
    const foreign = await owner.agent.patch(`/api/notifications/${list.body[1].id}/read`);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual({ success: true });
    expect((await teammate.agent.get("/api/notifications/unread-count")).body).toEqual({ count: 1 });

    const all = await teammate.agent.patch("/api/notifications/mark-all-read");
    expect(all.status).toBe(200);
    expect(all.body).toEqual({ success: true });
    expect((await teammate.agent.get("/api/notifications/unread-count")).body).toEqual({ count: 0 });
  });

  it("serves the default org settings before anything is configured", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);

    const res = await admin.agent.get("/api/admin/org-settings");
    expect(res.status).toBe(200);
    expect(res.body.screenshotPolicy).toEqual({
      screenshotsEnabled: true,
      captureIntervalMinMin: 3,
      captureIntervalMaxMin: 5,
      activeHoursEnabled: false,
      activeHoursStart: "08:00",
      activeHoursEnd: "18:00",
      idlePromptEnabled: true,
      idleTimeoutMinutes: 10,
      idleCountdownSeconds: 60,
    });
    expect(res.body.allowedTimezones).toEqual([]);
    expect(res.body.helpCenterScreenshots).toEqual({});
  });

  it("merges a screenshot policy patch and validates its bounds", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);

    const ok = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { captureIntervalMinMin: 5, captureIntervalMaxMin: 12 } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });

    const after = await admin.agent.get("/api/admin/org-settings");
    expect(after.body.screenshotPolicy).toMatchObject({
      captureIntervalMinMin: 5,
      captureIntervalMaxMin: 12,
      // Untouched keys keep their defaults.
      screenshotsEnabled: true,
      idleTimeoutMinutes: 10,
    });

    const tooShort = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { captureIntervalMinMin: 1 } });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body).toEqual({
      message: "Minimum capture interval must be at least 3 minutes (1 minute is not allowed)",
    });

    const tooLong = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { captureIntervalMinMin: 3, captureIntervalMaxMin: 20 } });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ message: "Maximum capture interval cannot exceed 15 minutes" });

    const inverted = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { captureIntervalMinMin: 10, captureIntervalMaxMin: 4 } });
    expect(inverted.status).toBe(400);
    expect(inverted.body).toEqual({ message: "Min capture interval cannot exceed max" });

    const idle = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { idleTimeoutMinutes: 61 } });
    expect(idle.status).toBe(400);
    expect(idle.body).toEqual({ message: "Idle timeout must be between 1 and 60 minutes" });

    const countdown = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { idleCountdownSeconds: 10 } });
    expect(countdown.status).toBe(400);
    expect(countdown.body).toEqual({ message: "Idle countdown must be between 15 and 120 seconds" });

    // Quirk: the max-interval bound is nested under the min-interval check, so
    // sending only an out-of-range max is accepted.
    const unguardedMax = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { captureIntervalMaxMin: 99 } });
    expect(unguardedMax.status).toBe(200);
    expect((await admin.agent.get("/api/admin/org-settings")).body.screenshotPolicy
      .captureIntervalMaxMin).toBe(99);

    const nothing = await admin.agent.patch("/api/admin/org-settings").send({});
    expect(nothing.status).toBe(400);
    expect(nothing.body).toEqual({ message: "Nothing to update" });
  });

  it("stores the allowed timezone list and exposes it to every user", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const before = await member.agent.get("/api/screencasts/timezones");
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ allowedTimezones: [] });

    const saved = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ allowedTimezones: ["America/Toronto", "Europe/Paris"] });
    expect(saved.status).toBe(200);

    const after = await member.agent.get("/api/screencasts/timezones");
    expect(after.body).toEqual({ allowedTimezones: ["America/Toronto", "Europe/Paris"] });

    const invalid = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ allowedTimezones: ["America/Toronto", ""] });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({
      message: "allowedTimezones must be an array of non-empty strings",
    });
  });

  it("stores Help Center screenshots by allowlisted slot and serves a complete map", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const map = await member.agent.get("/api/help-center/screenshot-map");
    expect(map.status).toBe(200);
    // Every allowlisted slot is present, unset ones as null.
    expect(map.body["desktop-login"]).toBeNull();
    expect(Object.keys(map.body).length).toBeGreaterThanOrEqual(14);

    const saved = await admin.agent.patch("/api/admin/org-settings").send({
      helpCenterScreenshots: { "desktop-login": "/public-objects/help/desktop-login.png" },
    });
    expect(saved.status).toBe(200);

    const afterSave = await member.agent.get("/api/help-center/screenshot-map");
    expect(afterSave.body["desktop-login"]).toBe("/public-objects/help/desktop-login.png");
    expect(afterSave.body["desktop-header-running"]).toBeNull();

    const cleared = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ helpCenterScreenshots: { "desktop-login": null } });
    expect(cleared.status).toBe(200);
    expect((await member.agent.get("/api/help-center/screenshot-map")).body["desktop-login"]).toBeNull();

    const unknownSlot = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ helpCenterScreenshots: { "not-a-slot": "/public-objects/x.png" } });
    expect(unknownSlot.status).toBe(400);
    expect(unknownSlot.body).toEqual({ message: "Invalid help screenshot slot: not-a-slot" });

    const badPath = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ helpCenterScreenshots: { "desktop-login": "https://example.test/x.png" } });
    expect(badPath.status).toBe(400);
    expect(badPath.body).toEqual({ message: "Invalid public object path for slot desktop-login" });

    const emptyMap = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ helpCenterScreenshots: {} });
    expect(emptyMap.status).toBe(400);
    expect(emptyMap.body).toEqual({ message: "helpCenterScreenshots must contain at least one slot" });
  });
});
