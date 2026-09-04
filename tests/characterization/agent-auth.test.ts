import { randomUUID } from "crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerAdmin, registerUser } from "../helpers/auth";
import { bearer, decodeJwtPayload, expirePairingCode, loginDevice, mintAccessToken, sha256Hex } from "../helpers/agent";

/**
 * Characterization: the desktop agent v1 handshake — how a device gets a token,
 * keeps it, and loses it.
 *
 * Pairing from a signed-in web session is the only enrollment path (#159).
 * `POST /api/agent/auth/login` is 410. Divergences from `docs/agent-protocol.md`
 * that remain:
 *
 *  - §3 says the device token lives 90 days. Nothing expires it — a device token
 *    is valid until the device is revoked.
 *  - §3's security details say `accessToken` may be "JWT or opaque". It is always
 *    an HS256 JWT assembled by hand in `desktopTokens.ts`, carrying
 *    `sub`/`uid`/`iat`/`exp` and naming its signing key in the header. The keys
 *    themselves are covered in `tests/smoke/desktop-tokens.test.ts`.
 *  - §4.1 documents `POST /api/agent/device/revoke` as owner-or-admin. Only the
 *    owner can revoke; an admin gets the same 404 a stranger does.
 *  - The document never mentions `GET /api/agent/ping`,
 *    `POST /api/agent/auth/login`, `GET /api/agent/devices`, or
 *    `POST /api/agent/devices/revoke-machine`. Ping and login are still the
 *    real entry points; login answers 410.
 *
 * Behavior quirks frozen here:
 *  - Every pairing complete creates another device row; nothing reuses a
 *    machine's device.
 *  - The devices listing hands the browser each device's `deviceTokenHash`.
 *  - Revocation is reported as 403 by the bearer middleware but 401 by refresh.
 *  - `revoke-machine` matches on name *and* os, so the same laptop reporting a
 *    new OS version keeps its old tokens alive.
 */
describe("desktop agent auth and devices (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("advertises pairing before anyone enrolls", async () => {
    const app = await makeApp();

    const ping = await newAgent(app).get("/api/agent/ping");
    expect(ping.status).toBe(200);
    expect(ping.body).toEqual({ ok: true, server: "DocuFlow", agentAuth: "pairing-v1" });
  });

  it("lets a signed-in User mint a pairing code that enrolls a Device", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const existing = await loginDevice(app, user, { deviceName: "Already enrolled" });

    const unauthenticated = await newAgent(app).post("/api/agent/pairing/start").send({});
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body).toEqual({ message: "Unauthorized" });

    const start = await user.agent.post("/api/agent/pairing/start").send({});
    expect(start.status).toBe(200);
    expect(start.body.pairingCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    const expiresAt = new Date(start.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 2000);

    const complete = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: start.body.pairingCode,
      deviceMeta: { deviceName: "Paired Workstation", os: "linux-6.0", clientVersion: "0.1.0" },
    });
    expect(complete.status).toBe(200);
    expect(complete.body.deviceToken).toMatch(/^[0-9a-f]{96}$/);
    expect(complete.body.deviceId).not.toBe(existing.deviceId);

    const claims = decodeJwtPayload(complete.body.accessToken);
    expect(claims).toMatchObject({ sub: complete.body.deviceId, uid: user.id });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(Math.floor(new Date(complete.body.expiresAt).getTime() / 1000)).toBe(claims.exp);

    const devices = await user.agent.get("/api/agent/devices");
    expect(devices.body.data).toHaveLength(2);
    const paired = devices.body.data.find((d: { id: string }) => d.id === complete.body.deviceId);
    expect(paired).toMatchObject({
      id: complete.body.deviceId,
      userId: user.id,
      name: "Paired Workstation",
      os: "linux-6.0",
      clientVersion: "0.1.0",
      revokedAt: null,
      deviceTokenHash: sha256Hex(complete.body.deviceToken),
    });

    // Enrollment is what agent routes actually check — a Device without one is 401.
    expect((await bearer(app, complete.body.accessToken).get("/api/agent/capabilities")).status).toBe(
      200
    );
    expect((await existing.request.get("/api/agent/capabilities")).status).toBe(200);
  });

  it("completing a used, expired, or unknown code enrolls nothing", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const start = await user.agent.post("/api/agent/pairing/start").send({});
    const first = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: start.body.pairingCode,
      deviceMeta: { deviceName: "First" },
    });
    expect(first.status).toBe(200);

    const reused = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: start.body.pairingCode,
      deviceMeta: { deviceName: "Second" },
    });
    expect(reused.status).toBe(400);
    expect(reused.body).toEqual({ message: "Pairing code already used" });

    const unknown = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: "ZZZZZZ",
      deviceMeta: { deviceName: "Ghost" },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ message: "Invalid pairing code" });

    const expiring = await user.agent.post("/api/agent/pairing/start").send({});
    await expirePairingCode(expiring.body.pairingCode);
    const expired = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: expiring.body.pairingCode,
      deviceMeta: { deviceName: "Late" },
    });
    expect(expired.status).toBe(400);
    expect(expired.body).toEqual({ message: "Pairing code expired" });

    const devices = await user.agent.get("/api/agent/devices");
    expect(devices.body.data).toHaveLength(1);
    expect(devices.body.data[0].id).toBe(first.body.deviceId);
  });

  it("answers 410 on password login and enrolls nothing, whatever is posted", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const withCredentials = await newAgent(app).post("/api/agent/auth/login").send({
      email: user.email,
      password: "password123",
      deviceMeta: { deviceName: "Workstation", os: "linux-6.0", clientVersion: "0.1.0" },
    });
    expect(withCredentials.status).toBe(410);
    expect(withCredentials.body).toEqual({
      message:
        "This sign-in path has moved to pairing. Pair a Device from a signed-in DocuFlow web session.",
    });

    const empty = await newAgent(app).post("/api/agent/auth/login").send({});
    expect(empty.status).toBe(410);
    expect(empty.body).toEqual(withCredentials.body);

    const garbage = await newAgent(app).post("/api/agent/auth/login").send({ nope: true });
    expect(garbage.status).toBe(410);
    expect(garbage.body).toEqual(withCredentials.body);

    const devices = await user.agent.get("/api/agent/devices");
    expect(devices.body.data).toEqual([]);
  });

  it("exchanges the raw device token for a new access token and touches lastSeenAt", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);

    const before = await user.agent.get("/api/agent/devices");
    const lastSeenBefore = before.body.data[0].lastSeenAt;

    const refresh = await newAgent(app)
      .post("/api/agent/auth/refresh")
      .send({ deviceId: device.deviceId, deviceToken: device.deviceToken });
    expect(refresh.status).toBe(200);
    // Quirk: refresh answers with the token pair only — no `user`, unlike login.
    expect(Object.keys(refresh.body).sort()).toEqual(["accessToken", "expiresAt"]);

    const claims = decodeJwtPayload(refresh.body.accessToken);
    expect(claims).toMatchObject({ sub: device.deviceId, uid: user.id });
    expect(claims.exp - claims.iat).toBe(3600);

    const after = await user.agent.get("/api/agent/devices");
    expect(new Date(after.body.data[0].lastSeenAt).getTime()).toBeGreaterThanOrEqual(
      new Date(lastSeenBefore).getTime()
    );

    // Quirk: the device token is not rotated or consumed — the same raw token
    // keeps working for as long as the device lives.
    const again = await newAgent(app)
      .post("/api/agent/auth/refresh")
      .send({ deviceId: device.deviceId, deviceToken: device.deviceToken });
    expect(again.status).toBe(200);
  });

  it("refuses a refresh whose device id and token do not belong together", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const other = await loginDevice(app, user, { deviceName: "Second Workstation" });

    const unknownDevice = await newAgent(app)
      .post("/api/agent/auth/refresh")
      .send({ deviceId: randomUUID(), deviceToken: device.deviceToken });
    expect(unknownDevice.status).toBe(401);
    expect(unknownDevice.body).toEqual({ message: "Invalid device credentials" });

    // The pair is looked up together, so one device's token cannot refresh another's.
    const crossed = await newAgent(app)
      .post("/api/agent/auth/refresh")
      .send({ deviceId: other.deviceId, deviceToken: device.deviceToken });
    expect(crossed.status).toBe(401);
    expect(crossed.body).toEqual({ message: "Invalid device credentials" });

    // Quirk: a non-UUID device id fails schema validation instead, so the same
    // wrong guess is a 400 or a 401 depending on how it is spelled.
    const malformed = await newAgent(app)
      .post("/api/agent/auth/refresh")
      .send({ deviceId: "not-a-uuid", deviceToken: device.deviceToken });
    expect(malformed.status).toBe(400);
    expect(malformed.body.message).toBe("Invalid request");
    expect(Array.isArray(malformed.body.errors)).toBe(true);
  });

  it("rejects a token that is missing, malformed, expired, or signed by someone else", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);

    const missing = await newAgent(app).get("/api/agent/capabilities");
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ message: "Missing or invalid Authorization header" });

    // Quirk: the scheme check is case-sensitive on the literal "Bearer ".
    const lowercase = await newAgent(app)
      .get("/api/agent/capabilities")
      .set("Authorization", `bearer ${device.accessToken}`);
    expect(lowercase.status).toBe(401);
    expect(lowercase.body).toEqual({ message: "Missing or invalid Authorization header" });

    const notAToken = await bearer(app, "one-segment").get("/api/agent/capabilities");
    expect(notAToken.status).toBe(401);
    expect(notAToken.body).toEqual({ message: "Invalid access token" });

    // Signed with the real secret but already past its `exp` — the branch no
    // live login can produce inside a test run.
    const expired = mintAccessToken({
      deviceId: device.deviceId,
      userId: user.id,
      expiresInSeconds: -60,
    });
    const stale = await bearer(app, expired).get("/api/agent/capabilities");
    expect(stale.status).toBe(401);
    expect(stale.body).toEqual({ message: "Access token expired" });

    // A well-formed token for a device row that no longer exists reads as
    // revoked, not as unknown.
    const ghost = mintAccessToken({
      deviceId: randomUUID(),
      userId: user.id,
      expiresInSeconds: 3600,
    });
    const noSuchDevice = await bearer(app, ghost).get("/api/agent/capabilities");
    expect(noSuchDevice.status).toBe(403);
    expect(noSuchDevice.body).toEqual({
      code: "device_revoked",
      message: "Device has been revoked",
    });
  });

  it("cuts a revoked device off from every agent route, and reports it two ways", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);

    const revoked = await user.agent
      .post("/api/agent/device/revoke")
      .send({ deviceId: device.deviceId });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ ok: true });

    // The bearer middleware re-reads the device on every request, so the still
    // unexpired token stops working immediately — everywhere.
    for (const path of [
      "/api/agent/capabilities",
      "/api/agent/projects",
      "/api/agent/timer/active",
      "/api/agent/worked-today",
      "/api/agent/today-breakdown",
    ]) {
      const res = await device.request.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body).toEqual({ code: "device_revoked", message: "Device has been revoked" });
    }

    // Same state, different status: refresh calls it 401.
    const refresh = await newAgent(app)
      .post("/api/agent/auth/refresh")
      .send({ deviceId: device.deviceId, deviceToken: device.deviceToken });
    expect(refresh.status).toBe(401);
    expect(refresh.body).toEqual({ code: "device_revoked", message: "Device has been revoked" });

    // Quirk: revoking again succeeds and re-stamps `revokedAt`.
    const again = await user.agent
      .post("/api/agent/device/revoke")
      .send({ deviceId: device.deviceId });
    expect(again.status).toBe(200);

    // Pairing again is the documented recovery, and it makes a fresh device.
    const replacement = await loginDevice(app, user);
    expect(replacement.deviceId).not.toBe(device.deviceId);
    expect((await replacement.request.get("/api/agent/capabilities")).status).toBe(200);
  });

  it("lets only the device's owner revoke it", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const admin = await registerAdmin(app);
    const device = await loginDevice(app, owner);

    const anonymous = await newAgent(app)
      .post("/api/agent/device/revoke")
      .send({ deviceId: device.deviceId });
    expect(anonymous.status).toBe(401);

    // Divergence from §4.1: someone else's device is "not found", never "forbidden".
    const foreign = await stranger.agent
      .post("/api/agent/device/revoke")
      .send({ deviceId: device.deviceId });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ message: "Device not found" });

    // Divergence from §4.1 ("must be device owner or admin"): the route matches on
    // ownership alone, so an admin gets the same 404 the stranger did.
    const byAdmin = await admin.agent
      .post("/api/agent/device/revoke")
      .send({ deviceId: device.deviceId });
    expect(byAdmin.status).toBe(404);
    expect(byAdmin.body).toEqual({ message: "Device not found" });

    const unknown = await owner.agent
      .post("/api/agent/device/revoke")
      .send({ deviceId: randomUUID() });
    expect(unknown.status).toBe(404);

    // Quirk: the zod error is not caught by name here, so a malformed id lands
    // in the catch-all and is reported as a server failure.
    const malformed = await owner.agent
      .post("/api/agent/device/revoke")
      .send({ deviceId: "not-a-uuid" });
    expect(malformed.status).toBe(500);
    expect(malformed.body).toEqual({ message: "Failed to revoke device" });

    // The device is untouched by all of the above.
    expect((await device.request.get("/api/agent/capabilities")).status).toBe(200);
  });

  it("revokes a whole machine by name and os, and misses it when either differs", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const stranger = await registerUser(app);

    const first = await loginDevice(app, user, { deviceName: "Laptop", os: "windows-11.0" });
    const second = await loginDevice(app, user, { deviceName: "Laptop", os: "windows-11.0" });
    const upgraded = await loginDevice(app, user, { deviceName: "Laptop", os: "windows-11.1" });
    const strangersLaptop = await loginDevice(app, stranger, {
      deviceName: "Laptop",
      os: "windows-11.0",
    });

    const missingName = await user.agent.post("/api/agent/devices/revoke-machine").send({});
    expect(missingName.status).toBe(400);
    expect(missingName.body).toEqual({ message: "name is required" });

    const revoked = await user.agent
      .post("/api/agent/devices/revoke-machine")
      .send({ name: "Laptop", os: "windows-11.0" });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ ok: true });

    expect((await first.request.get("/api/agent/capabilities")).status).toBe(403);
    expect((await second.request.get("/api/agent/capabilities")).status).toBe(403);
    // Quirk: the os is part of the match, so one OS update leaves a token alive
    // that the user believes they just revoked.
    expect((await upgraded.request.get("/api/agent/capabilities")).status).toBe(200);
    // Scoped to the caller: another user's identically named machine is untouched.
    expect((await strangersLaptop.request.get("/api/agent/capabilities")).status).toBe(200);

    // Quirk: an omitted `os` means "the devices that reported no os at all",
    // not "any os", so it revokes nothing here — and still answers ok.
    const withoutOs = await user.agent
      .post("/api/agent/devices/revoke-machine")
      .send({ name: "Laptop" });
    expect(withoutOs.status).toBe(200);
    expect((await upgraded.request.get("/api/agent/capabilities")).status).toBe(200);
  });

  it("scopes the devices listing to the caller", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const stranger = await registerUser(app);
    await loginDevice(app, user, { deviceName: "One" });
    await loginDevice(app, user, { deviceName: "Two" });
    await loginDevice(app, stranger, { deviceName: "Theirs" });

    const anonymous = await newAgent(app).get("/api/agent/devices");
    expect(anonymous.status).toBe(401);

    const mine = await user.agent.get("/api/agent/devices");
    expect(mine.body.data.map((d: { name: string }) => d.name).sort()).toEqual(["One", "Two"]);

    const theirs = await stranger.agent.get("/api/agent/devices");
    expect(theirs.body.data).toHaveLength(1);

    // Quirk: revoked devices stay in the listing; `revokedAt` is the only signal.
    await user.agent.post("/api/agent/device/revoke").send({ deviceId: mine.body.data[0].id });
    const afterRevoke = await user.agent.get("/api/agent/devices");
    expect(afterRevoke.body.data).toHaveLength(2);
    expect(typeof afterRevoke.body.data[0].revokedAt).toBe("string");
  });
});
