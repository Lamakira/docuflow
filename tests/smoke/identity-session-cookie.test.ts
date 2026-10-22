import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerAdmin, registerUser, sessionTokenFor } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { completeUpload } from "../helpers/objects";
import { FakeIdentityProvider } from "../fakes/identityProvider";
import { config } from "../../server/config";
import {
  isWebSessionPath,
  parseCookieHeader,
  resolveIdentitySession,
  webSessionCredential,
} from "../../server/modules/identity/webSession";
import type { TestUser } from "../helpers/auth";

/**
 * #329: a browser-loaded GET (`<img>`, download link) carries no Authorization
 * header, so the server reads the provider's first-party session cookie — for
 * GET and HEAD only, and only when no Authorization header exists at all.
 */

const APP_ORIGIN = new URL(config.appUrl).origin;

// Same recipe as Clerk's getCookieSuffix over the harness publishable key.
const suffixedCookie = `__session_${createHash("sha1")
  .update(process.env.CLERK_PUBLISHABLE_KEY!)
  .digest("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .substring(0, 8)}`;

describe("web session cookie on safe methods (#329)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function runningEntry(app: Awaited<ReturnType<typeof makeApp>>) {
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    return { user, crmProjectId: crmProject.id, entry, task };
  }

  async function captureScreenshot(user: TestUser, entryId: string, crmProjectId: string) {
    const issued = await user.agent
      .post("/api/time-tracking/screenshots/upload-url")
      .send({ timeEntryId: entryId });
    const uploadedUrl = completeUpload(issued.body.uploadURL, "PNG-BYTES", "image/png");
    const created = await user.agent.post("/api/time-tracking/screenshots").send({
      timeEntryId: entryId,
      crmProjectId,
      storageKey: uploadedUrl,
    });
    return created.body.id as string;
  }

  const cookieAgent = (app: Awaited<ReturnType<typeof makeApp>>, cookie: string) =>
    newAgent(app).set("Cookie", cookie);

  async function scene() {
    const app = await makeApp();
    const { user, crmProjectId, entry, task } = await runningEntry(app);
    const screenshotId = await captureScreenshot(user, entry.id, crmProjectId);
    const image = `/api/time-tracking/screenshots/${screenshotId}/image`;
    const token = await sessionTokenFor(user.id, { azp: APP_ORIGIN });
    return { app, user, entry, task, screenshotId, image, token };
  }

  it("serves the image to the owner, an admin and refuses another Member", async () => {
    const { app, image, token } = await scene();

    const owner = await cookieAgent(app, `${suffixedCookie}=${token}`).get(image).buffer(true);
    expect(owner.status).toBe(200);
    expect(owner.body.toString()).toBe("PNG-BYTES");

    const admin = await registerAdmin(app);
    const adminToken = await sessionTokenFor(admin.id, { azp: APP_ORIGIN });
    const asAdmin = await cookieAgent(app, `${suffixedCookie}=${adminToken}`).get(image).buffer(true);
    expect(asAdmin.status).toBe(200);

    const stranger = await registerUser(app);
    const strangerToken = await sessionTokenFor(stranger.id, { azp: APP_ORIGIN });
    const viaCookie = await cookieAgent(app, `${suffixedCookie}=${strangerToken}`).get(image);
    const viaHeader = await stranger.agent.get(image);
    expect(viaHeader.status).toBe(403);
    expect(viaCookie.status).toBe(403);
  });

  it("reads the plain __session cookie, and prefers the suffixed one", async () => {
    const { app, image, token } = await scene();

    const plain = await cookieAgent(app, `__session=${token}`).get(image).buffer(true);
    expect(plain.status).toBe(200);

    const suffixedWins = await cookieAgent(app, `__session=garbage; ${suffixedCookie}=${token}`)
      .get(image)
      .buffer(true);
    expect(suffixedWins.status).toBe(200);

    const suffixedGarbage = await cookieAgent(app, `__session=${token}; ${suffixedCookie}=garbage`).get(
      image,
    );
    expect(suffixedGarbage.status).toBe(401);
  });

  it("answers HEAD with the cookie", async () => {
    const { app, image, token } = await scene();
    const res = await cookieAgent(app, `${suffixedCookie}=${token}`).head(image);
    expect(res.status).toBe(200);
  });

  it("refuses the cookie on a request another site started", async () => {
    const { app, image, token } = await scene();
    const cookie = `${suffixedCookie}=${token}`;
    for (const site of ["cross-site", "same-site"]) {
      const res = await cookieAgent(app, cookie).set("Sec-Fetch-Site", site).get(image);
      expect(res.status, site).toBe(401);
    }
    for (const site of ["same-origin", "none"]) {
      const res = await cookieAgent(app, cookie).set("Sec-Fetch-Site", site).get(image).buffer(true);
      expect(res.status, site).toBe(200);
    }
  });

  it("serves an image sandboxed, and an HTML upload only as a sandboxed download", async () => {
    const { app, user, image, token } = await scene();
    const cookie = `${suffixedCookie}=${token}`;

    const shot = await cookieAgent(app, cookie).get(image).buffer(true);
    expect(shot.headers["content-disposition"]).toBeUndefined();
    expect(shot.headers["content-security-policy"]).toContain("sandbox");
    expect(shot.headers["x-content-type-options"]).toBe("nosniff");

    const issued = await user.agent.post("/api/company-documents/upload-url");
    const storagePath = completeUpload(issued.body.uploadURL, "<script>steal()</script>", "text/html");
    const page = await user.agent.post("/api/company-documents").send({
      name: "Page",
      fileName: "page.html",
      mimeType: "text/html",
      storagePath,
    });
    const streamed = await cookieAgent(app, cookie)
      .get(`/api/company-documents/${page.body.id}/stream`)
      .buffer(true);
    expect(streamed.status).toBe(200);
    expect(streamed.headers["content-disposition"]).toBe('attachment; filename="page.html"');
    expect(streamed.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  });

  it("answers 401 for an unknown cookie token", async () => {
    const { app, image } = await scene();
    const res = await cookieAgent(app, `${suffixedCookie}=nonsense`).get(image);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("refuses a cookie token minted for another origin or for none", async () => {
    const { app, user, image } = await scene();
    const evil = await sessionTokenFor(user.id, { azp: "https://evil.example" });
    const none = await sessionTokenFor(user.id);
    expect((await cookieAgent(app, `${suffixedCookie}=${evil}`).get(image)).status).toBe(401);
    expect((await cookieAgent(app, `${suffixedCookie}=${none}`).get(image)).status).toBe(401);
    // The same tokens are fine in the header: azp is only demanded of cookies.
    expect((await newAgent(app).set("Authorization", `Bearer ${none}`).get(image)).status).toBe(200);
  });

  it("never lets the cookie authorize a write", async () => {
    const { app, user, entry, task, screenshotId, token } = await scene();
    const cookie = `${suffixedCookie}=${token}`;

    const upload = await cookieAgent(app, cookie)
      .post("/api/time-tracking/screenshots/upload-url")
      .send({ timeEntryId: entry.id });
    expect(upload.status).toBe(401);

    const admin = await registerAdmin(app);
    const adminToken = await sessionTokenFor(admin.id, { azp: APP_ORIGIN });
    const del = await cookieAgent(app, `${suffixedCookie}=${adminToken}`).delete(
      `/api/time-tracking/screenshots/${screenshotId}`,
    );
    expect(del.status).toBe(401);

    const patchPath = `/api/tasks/${task.id}`;
    const viaHeader = await user.agent.patch(patchPath).send({ description: "x" });
    expect(viaHeader.status).not.toBe(401);
    const viaCookie = await cookieAgent(app, cookie).patch(patchPath).send({ description: "x" });
    expect(viaCookie.status).toBe(401);
  });

  it("ignores the cookie when any Authorization header is present", async () => {
    const { app, image, token } = await scene();
    const res = await cookieAgent(app, `${suffixedCookie}=${token}`)
      .set("Authorization", "Basic x")
      .get(image);
    expect(res.status).toBe(401);
  });

  it("does not read the cookie on agent, public API and internal paths", async () => {
    const { app, token } = await scene();
    for (const path of ["/api/agent/timer/active", "/api/v1/projects", "/api/internal/desktop-releases"]) {
      const bare = await newAgent(app).get(path);
      const withCookie = await newAgent(app).get(path).set("Cookie", `${suffixedCookie}=${token}`);
      expect(withCookie.status, path).toBe(bare.status);
      expect(isWebSessionPath(path), path).toBe(false);
    }
  });
});

describe("parseCookieHeader", () => {
  it("splits, trims, decodes, and keeps the first occurrence", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader("a=1; b = two%20words ;a=3;=x;novalue; c=a=b")).toEqual({
      a: "1",
      b: "two words",
      c: "a=b",
    });
  });

  it("keeps a value that cannot be decoded as it came", () => {
    expect(parseCookieHeader("a=%E0%A4%A")).toEqual({ a: "%E0%A4%A" });
  });
});

describe("webSessionCredential", () => {
  const provider = new FakeIdentityProvider();
  const cookie = "__session=tok";

  it("prefers the header and never falls back to the cookie when one exists", () => {
    expect(
      webSessionCredential({ method: "GET", headers: { authorization: "Bearer h", cookie } }, provider),
    ).toEqual({ token: "h", source: "header" });
    expect(
      webSessionCredential({ method: "GET", headers: { authorization: "Basic x", cookie } }, provider),
    ).toBeUndefined();
    expect(
      webSessionCredential({ method: "GET", headers: { authorization: "", cookie } }, provider),
    ).toBeUndefined();
  });

  it("reads the cookie on GET and HEAD only", () => {
    for (const method of ["GET", "HEAD"]) {
      expect(webSessionCredential({ method, headers: { cookie } }, provider)).toEqual({
        token: "tok",
        source: "cookie",
      });
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(webSessionCredential({ method, headers: { cookie } }, provider)).toBeUndefined();
    }
    expect(webSessionCredential({ method: "GET", headers: {} }, provider)).toBeUndefined();
    expect(
      webSessionCredential({ method: "GET", headers: { cookie, "sec-fetch-site": "cross-site" } }, provider),
    ).toBeUndefined();
  });
});

describe("resolveIdentitySession authorizedParties", () => {
  it("refuses a mismatched or absent azp and accepts one of the listed origins", async () => {
    const provider = new FakeIdentityProvider();
    const identity = await provider.importPasswordUser({
      email: "azp@example.com",
      passwordHash: "$2b$04$CJHjh937SDvS7hh3rhGtDeDrY0sTbWMloGRi22XPxY7Zb9scpnnj2",
    });
    const persistence = { getUserByIdentityProviderSubjectId: async () => ({ id: "u1" }) };
    const matching = provider.issueSessionToken(identity.providerSubjectId, {
      authorizedParty: "https://app.example",
    });
    const base = { provider, persistence, authorizedParties: ["https://app.example", "https://app.replit.app"] };

    expect((await resolveIdentitySession({ ...base, token: matching }))?.userId).toBe("u1");
    expect(
      await resolveIdentitySession({ ...base, token: matching, authorizedParties: ["https://other.example"] }),
    ).toBeUndefined();

    // issueSessionToken reuses the token name, so this one now names no party.
    const none = provider.issueSessionToken(identity.providerSubjectId);
    expect(await resolveIdentitySession({ ...base, token: none })).toBeUndefined();
    expect(
      (await resolveIdentitySession({ provider, persistence, token: none }))?.userId,
    ).toBe("u1");
  });
});

describe("storedContentHeaders", () => {
  it("lets script-free types render inline and forces everything else to a sandboxed download", async () => {
    const { storedContentHeaders } = await import("../../server/objectStorage");

    expect(storedContentHeaders("application/pdf", undefined)).toEqual({
      "Content-Type": "application/pdf",
      "Content-Security-Policy": "frame-ancestors 'self'",
    });
    const png = storedContentHeaders("image/png", undefined);
    expect(png["Content-Type"]).toBe("image/png");
    expect(png).not.toHaveProperty("Content-Disposition");
    expect(png["Content-Security-Policy"]).toContain("sandbox");
    expect(storedContentHeaders("Text/Plain; charset=utf-8", undefined)["Content-Type"]).toBe(
      "text/plain; charset=utf-8",
    );
    for (const type of ["text/html", "image/svg+xml", "application/xhtml+xml", "application/octet-stream"]) {
      expect(storedContentHeaders(type, undefined), type).toEqual({
        "Content-Type": type,
        "Content-Disposition": "attachment",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
    }
    expect(storedContentHeaders("text/html", 'inline; filename="a.html"')["Content-Disposition"]).toBe(
      'attachment; filename="a.html"',
    );
    expect(storedContentHeaders("text/html", 'attachment; filename="a.html"')["Content-Disposition"]).toBe(
      'attachment; filename="a.html"',
    );
  });

  it("sends only the parsed type, so a list or a smuggled parameter cannot pick another", async () => {
    const { storedContentHeaders } = await import("../../server/objectStorage");

    for (const stored of ["application/pdf,text/html", "image/png, text/html", "text/html image/png", "", undefined]) {
      expect(storedContentHeaders(stored, undefined), String(stored)).toEqual({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
    }
    expect(storedContentHeaders("text/plain; charset=utf-8,text/html", undefined)["Content-Type"]).toBe(
      "text/plain",
    );
  });
});
