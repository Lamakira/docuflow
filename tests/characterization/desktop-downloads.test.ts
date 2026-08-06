import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent } from "../helpers/auth";
import { FAKE_STORAGE_ORIGIN, fakeSignedUrl } from "../fakes/network";

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
 *  - `/downloads/:platform` redirects to a freshly signed GCS URL; the metadata
 *    route redirects to the raw stored URL instead.
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

  const releaseObject = (file: string) => `test-bucket/releases/${file}`;
  /** The stored URL a release carries — unsigned, unlike what `/downloads/:platform` mints. */
  const gcsUrl = (file: string) => `${FAKE_STORAGE_ORIGIN}/${releaseObject(file)}`;

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
      error: "storageUrl must be a GCS HTTPS URL or a local /downloads/:platform path",
    });

    // A pre-release version and a local storage path are both accepted.
    const prerelease = await publish(app, {
      version: "2.0.0-rc.3",
      platform: "linux",
      filename: "DocuFlow-2.0.0-rc.3.AppImage",
      storageUrl: "/downloads/linux",
    });
    expect(prerelease.status).toBe(201);
  });

  it("publishes a version, demotes the previous one, and serves it to anonymous callers", async () => {
    const app = await makeApp();
    const anonymous = newAgent(app);

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
      url: gcsUrl("DocuFlow-0.1.0-setup.exe"),
      fileSize: 1234,
      sha256: "abc123",
    });

    // Without ?format=json the same route redirects to the stored URL as-is.
    const redirect = await anonymous
      .get("/api/downloads/desktop/latest")
      .query({ platform: "windows" })
      .redirects(0);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(gcsUrl("DocuFlow-0.1.0-setup.exe"));

    // `/downloads/:platform` signs a fresh short-lived URL instead.
    const signed = await anonymous.get("/downloads/windows").redirects(0);
    expect(signed.status).toBe(302);
    expect(signed.headers.location).toBe(
      fakeSignedUrl(releaseObject("DocuFlow-0.1.0-setup.exe"), "GET")
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

  it("reports a locally-stored installer whose file is missing from disk", async () => {
    const app = await makeApp();
    const anonymous = newAgent(app);

    await publish(app, {
      version: "0.3.0",
      platform: "linux",
      filename: "DocuFlow-0.3.0.AppImage",
      storageUrl: "/downloads/linux",
    });

    // Availability checks the disk for non-GCS releases, and nothing was written.
    expect((await anonymous.get("/downloads/availability")).body.linux).toBe(false);

    const res = await anonymous.get("/downloads/linux");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: "Installer file is registered but missing from disk",
      filename: "DocuFlow-0.3.0.AppImage",
    });
  });
});
