import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent } from "../helpers/auth";
import { FAKE_STORAGE_ORIGIN, fakeSignedUrl, putObject, signedUrlPattern } from "../fakes/gcs";

const CI_TOKEN = "test-ci-token";

/**
 * Characterization: the public desktop-installer endpoints and the CI-only
 * registration route behind them.
 *
 * Quirks frozen here:
 *  - All download endpoints are public — no session, no API key.
 *  - Registration is guarded by a bearer token read from the environment at
 *    request time; with the variable unset every call is 401, whatever is sent.
 *  - Publishing a version demotes the previous one for that platform only.
 *  - `/downloads/:platform` redirects to a freshly signed URL; the "latest" route
 *    redirects through it, since the raw object is private.
 *  - A release registers only once its object exists in this environment's bucket;
 *    a row naming another bucket answers as unavailable (ADR-0018).
 *  - Installers are published by PUTting to a URL from the upload-url route; the
 *    old upload and upload-chunk routes are gone.
 *  - These routes report errors as `{ error }`, not `{ message }`.
 */
describe("desktop downloads (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.DESKTOP_RELEASE_CI_TOKEN = CI_TOKEN;
  });

  afterEach(() => {
    delete process.env.DESKTOP_RELEASE_CI_TOKEN;
  });

  const releaseObject = (file: string) => `test-bucket/public/installers/9.9.9/${file}`;
  /** The stored URL a release carries — unsigned, unlike what `/downloads/:platform` mints. */
  const gcsUrl = (file: string) => `${FAKE_STORAGE_ORIGIN}/${releaseObject(file)}`;
  /** Puts the installer in the fake bucket, as a publisher's PUT would. */
  const seed = (...files: string[]) => files.forEach((f) => putObject(releaseObject(f), "bytes"));

  async function publish(
    app: Awaited<ReturnType<typeof makeApp>>,
    body: Record<string, unknown>
  ) {
    return newAgent(app)
      .post("/api/internal/desktop-releases")
      .set("Authorization", `Bearer ${CI_TOKEN}`)
      .send(body);
  }

  it("reports nothing available before anything is published", async () => {
    const app = await makeApp();
    const anonymous = newAgent(app);

    const availability = await anonymous.get("/downloads/availability");
    expect(availability.status).toBe(200);
    expect(availability.body).toEqual({ windows: false, macos: false, linux: false });

    const versions = await anonymous.get("/api/downloads/desktop/versions");
    expect(versions.status).toBe(200);
    expect(versions.body).toEqual([]);

    const latest = await anonymous
      .get("/api/downloads/desktop/latest")
      .query({ platform: "windows" });
    expect(latest.status).toBe(404);
    expect(latest.body).toEqual({ error: "No release found for platform: windows" });

    const installer = await anonymous.get("/downloads/windows");
    expect(installer.status).toBe(404);
    expect(installer.body).toEqual({ error: "No release published yet for platform: windows" });

    const badPlatform = await anonymous
      .get("/api/downloads/desktop/latest")
      .query({ platform: "solaris" });
    expect(badPlatform.status).toBe(400);
    expect(badPlatform.body).toEqual({ error: "platform must be one of: windows, macos, linux" });
  });

  it("refuses registration without the CI bearer token", async () => {
    const app = await makeApp();
    seed("a.exe");

    const noAuth = await newAgent(app)
      .post("/api/internal/desktop-releases")
      .send({ version: "1.0.0", platform: "windows", filename: "a.exe", storageUrl: gcsUrl("a.exe") });
    expect(noAuth.status).toBe(401);
    expect(noAuth.body).toEqual({ error: "Unauthorized" });

    const wrongToken = await newAgent(app)
      .post("/api/internal/desktop-releases")
      .set("Authorization", "Bearer nope")
      .send({ version: "1.0.0", platform: "windows", filename: "a.exe", storageUrl: gcsUrl("a.exe") });
    expect(wrongToken.status).toBe(401);

    // Quirk: with the environment variable unset, even the right token is 401 —
    // the guard fails closed.
    delete process.env.DESKTOP_RELEASE_CI_TOKEN;
    const unconfigured = await newAgent(app)
      .post("/api/internal/desktop-releases")
      .set("Authorization", `Bearer ${CI_TOKEN}`)
      .send({ version: "1.0.0", platform: "windows", filename: "a.exe", storageUrl: gcsUrl("a.exe") });
    expect(unconfigured.status).toBe(401);
  });

  it("validates the registration payload", async () => {
    const app = await makeApp();
    seed("a.exe");

    const missing = await publish(app, { version: "1.0.0", platform: "windows" });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({
      error: "Missing required fields: version, platform, filename, storageUrl",
    });

    const badPlatform = await publish(app, {
      version: "1.0.0",
      platform: "solaris",
      filename: "a.exe",
      storageUrl: gcsUrl("a.exe"),
    });
    expect(badPlatform.status).toBe(400);
    expect(badPlatform.body).toEqual({ error: "Invalid platform" });

    const badVersion = await publish(app, {
      version: "v1",
      platform: "windows",
      filename: "a.exe",
      storageUrl: gcsUrl("a.exe"),
    });
    expect(badVersion.status).toBe(400);
    expect(badVersion.body).toEqual({ error: "Invalid version format (expected semver)" });

    const badFilename = await publish(app, {
      version: "1.0.0",
      platform: "windows",
      filename: "../escape.exe",
      storageUrl: gcsUrl("a.exe"),
    });
    expect(badFilename.status).toBe(400);
    expect(badFilename.body).toEqual({ error: "Invalid filename" });

    const badUrl = await publish(app, {
      version: "1.0.0",
      platform: "windows",
      filename: "a.exe",
      storageUrl: "https://example.test/a.exe",
    });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body).toEqual({
      error: "storageUrl must be a https://storage.googleapis.com/<bucket>/<object> URL",
    });

    // The local disk path is retired with the disk fallback.
    const localPath = await publish(app, {
      version: "1.0.0",
      platform: "linux",
      filename: "a.AppImage",
      storageUrl: "/downloads/linux",
    });
    expect(localPath.status).toBe(400);

    // A pre-release version is accepted.
    seed("DocuFlow-2.0.0-rc.3.AppImage");
    const prerelease = await publish(app, {
      version: "2.0.0-rc.3",
      platform: "linux",
      filename: "DocuFlow-2.0.0-rc.3.AppImage",
      storageUrl: gcsUrl("DocuFlow-2.0.0-rc.3.AppImage"),
    });
    expect(prerelease.status).toBe(201);
  });

  it("publishes a version, demotes the previous one, and serves it to anonymous callers", async () => {
    const app = await makeApp();
    const anonymous = newAgent(app);
    seed("DocuFlow-0.1.0-setup.exe", "DocuFlow-0.2.0-setup.exe", "DocuFlow-0.2.0.dmg");

    const first = await publish(app, {
      version: "0.1.0",
      platform: "windows",
      filename: "DocuFlow-0.1.0-setup.exe",
      storageUrl: gcsUrl("DocuFlow-0.1.0-setup.exe"),
      fileSize: 1234,
      sha256: "abc123",
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      version: "0.1.0",
      platform: "windows",
      filename: "DocuFlow-0.1.0-setup.exe",
      isLatest: true,
      fileSize: 1234,
      sha256: "abc123",
    });

    const availability = await anonymous.get("/downloads/availability");
    expect(availability.body).toEqual({ windows: true, macos: false, linux: false });

    const metadata = await anonymous
      .get("/api/downloads/desktop/latest")
      .query({ platform: "windows", format: "json" });
    expect(metadata.status).toBe(200);
    expect(metadata.body).toMatchObject({
      version: "0.1.0",
      platform: "windows",
      url: "/downloads/windows",
      fileSize: 1234,
      sha256: "abc123",
    });

    // Without ?format=json the same route redirects through the signed route.
    const redirect = await anonymous
      .get("/api/downloads/desktop/latest")
      .query({ platform: "windows" })
      .redirects(0);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe("/downloads/windows");

    // `/downloads/:platform` signs a fresh short-lived URL.
    const signed = await anonymous.get("/downloads/windows").redirects(0);
    expect(signed.status).toBe(302);
    expect(signed.headers.location).toBe(
      fakeSignedUrl(releaseObject("DocuFlow-0.1.0-setup.exe"), "read")
    );

    const second = await publish(app, {
      version: "0.2.0",
      platform: "windows",
      filename: "DocuFlow-0.2.0-setup.exe",
      storageUrl: gcsUrl("DocuFlow-0.2.0-setup.exe"),
    });
    expect(second.status).toBe(201);

    const macos = await publish(app, {
      version: "0.2.0",
      platform: "macos",
      filename: "DocuFlow-0.2.0.dmg",
      storageUrl: gcsUrl("DocuFlow-0.2.0.dmg"),
    });
    expect(macos.status).toBe(201);

    const versions = await anonymous.get("/api/downloads/desktop/versions");
    expect(versions.body).toHaveLength(3);
    // Quirk: the version list omits `storageUrl` on purpose.
    expect(versions.body[0]).not.toHaveProperty("storageUrl");
    const windowsRows = versions.body.filter((r: { platform: string }) => r.platform === "windows");
    expect(windowsRows.filter((r: { isLatest: boolean }) => r.isLatest)).toHaveLength(1);
    expect(windowsRows.find((r: { isLatest: boolean }) => r.isLatest).version).toBe("0.2.0");

    // Publishing Windows did not disturb macOS.
    expect((await anonymous.get("/downloads/availability")).body).toEqual({
      windows: true,
      macos: true,
      linux: false,
    });
  });

  it("refuses to register an object that is not in the bucket yet, then accepts it once it is", async () => {
    const app = await makeApp();
    const body = {
      version: "0.4.0",
      platform: "windows",
      filename: "DocuFlow-0.4.0-setup.exe",
      storageUrl: gcsUrl("DocuFlow-0.4.0-setup.exe"),
    };

    const early = await publish(app, body);
    expect(early.status).toBe(409);
    expect((await newAgent(app).get("/api/downloads/desktop/versions")).body).toEqual([]);

    seed("DocuFlow-0.4.0-setup.exe");
    expect((await publish(app, body)).status).toBe(201);
  });

  it("refuses to register a bucket that is not this environment's own", async () => {
    const app = await makeApp();
    const res = await publish(app, {
      version: "0.4.0",
      platform: "windows",
      filename: "a.exe",
      storageUrl: `${FAKE_STORAGE_ORIGIN}/other-env-bucket/public/installers/a.exe`,
    });
    expect(res.status).toBe(422);
  });

  it("answers a foreign-bucket row as unavailable, not as an error", async () => {
    const app = await makeApp();
    const anonymous = newAgent(app);
    // A row left by another environment, inserted past the route's own check.
    const { db } = await import("../../server/db");
    const { desktopReleases } = await import("@shared/schema");
    await db.insert(desktopReleases).values({
      version: "0.5.0",
      platform: "windows",
      filename: "a.exe",
      storageUrl: `${FAKE_STORAGE_ORIGIN}/other-env-bucket/public/installers/a.exe`,
      isLatest: true,
    });
    putObject("other-env-bucket/public/installers/a.exe", "bytes");

    expect((await anonymous.get("/downloads/availability")).body.windows).toBe(false);
    const res = await anonymous.get("/downloads/windows").redirects(0);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No release published yet for platform: windows" });
  });

  it("reports availability only while the object exists", async () => {
    const app = await makeApp();
    const { db } = await import("../../server/db");
    const { desktopReleases } = await import("@shared/schema");
    await db.insert(desktopReleases).values({
      version: "0.6.0",
      platform: "linux",
      filename: "a.deb",
      storageUrl: gcsUrl("a.deb"),
      isLatest: true,
    });
    expect((await newAgent(app).get("/downloads/availability")).body.linux).toBe(false);
    seed("a.deb");
    expect((await newAgent(app).get("/downloads/availability")).body.linux).toBe(true);
  });

  describe("upload-url", () => {
    const valid = {
      platform: "windows",
      version: "1.2.3",
      filename: "DocuFlow-Agent-1.2.3-windows-setup.exe",
      fileSize: 1234,
      sha256: "a".repeat(64),
    };
    const post = (app: Awaited<ReturnType<typeof makeApp>>, body: unknown, token: string | null = CI_TOKEN) => {
      const req = newAgent(app).post("/api/internal/desktop-releases/upload-url");
      return (token ? req.set("Authorization", `Bearer ${token}`) : req).send(body as object);
    };

    it("refuses a missing or wrong CI token", async () => {
      const app = await makeApp();
      expect((await post(app, valid, null)).status).toBe(401);
      expect((await post(app, valid, "nope")).status).toBe(401);
    });

    it("validates the body", async () => {
      const app = await makeApp();
      expect((await post(app, { platform: "windows" })).status).toBe(400);
      expect((await post(app, { ...valid, platform: "solaris" })).body).toEqual({ error: "Invalid platform" });
      expect((await post(app, { ...valid, version: "v1" })).status).toBe(400);
      expect((await post(app, { ...valid, filename: "../x.exe" })).status).toBe(400);
      expect((await post(app, { ...valid, fileSize: -1 })).status).toBe(400);
      expect((await post(app, { ...valid, sha256: "xyz" })).status).toBe(400);
    });

    it("returns a signed PUT and the storageUrl to register", async () => {
      const app = await makeApp();
      const res = await post(app, valid);
      expect(res.status).toBe(200);
      const object = `test-bucket/public/installers/1.2.3/${valid.filename}`;
      expect(res.body.uploadUrl).toMatch(signedUrlPattern(object.replace(/[.]/g, "\\."), "write"));
      expect(res.body.storageUrl).toBe(`${FAKE_STORAGE_ORIGIN}/${object}`);
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

      // The full publish path: registration is refused until the PUT has landed.
      const register = { ...valid, storageUrl: res.body.storageUrl };
      expect((await publish(app, register)).status).toBe(409);
      putObject(object, "bytes");
      expect((await publish(app, register)).status).toBe(201);
      expect((await newAgent(app).get("/downloads/windows").redirects(0)).headers.location).toBe(
        fakeSignedUrl(object, "read")
      );
    });
  });

  it("no longer serves the disk upload routes", async () => {
    const app = await makeApp();
    for (const route of ["upload", "upload-chunk"]) {
      const res = await newAgent(app)
        .post(`/api/internal/desktop-releases/${route}`)
        .set("Authorization", `Bearer ${CI_TOKEN}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("x"));
      expect(res.status).toBe(404);
    }
  });
});
