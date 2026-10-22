import { beforeEach, describe, expect, it } from "vitest";
import { ReplitSidecarSigningError, ReplitStoragePort } from "../../server/replitStorage";
import { SignedUrlsUnsupportedError } from "../../server/storagePort";
import { FAKE_SIDECAR_ENDPOINT, createReplitSidecarFake, type ReplitSidecarFake } from "../fakes/replitSidecar";

/**
 * The harness runs the Google provider, so the Replit port is built directly,
 * with the in-memory sidecar fake as its `fetch`.
 */
const ref = { bucketName: "replit-objstore-test", objectName: "public/installers/1.0.0/app.exe" };

let sidecar: ReplitSidecarFake;

beforeEach(() => {
  sidecar = createReplitSidecarFake();
});

function port(signing: boolean) {
  return new ReplitStoragePort({ signing, fetch: sidecar.fetch });
}

describe("ReplitStoragePort signing through the sidecar", () => {
  it("posts bucket, object, method and an expiry, and returns signed_url", async () => {
    const before = Date.now();
    const url = await port(true).signUrl({ ref, method: "PUT", ttlSec: 900 });

    expect(url).toContain(`/${ref.bucketName}/${ref.objectName}`);
    expect(sidecar.requests).toHaveLength(1);
    const [request] = sidecar.requests;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${FAKE_SIDECAR_ENDPOINT}/object-storage/signed-object-url`);
    expect(request.body).toMatchObject({
      bucket_name: ref.bucketName,
      object_name: ref.objectName,
      method: "PUT",
    });
    const expiresAt = Date.parse(request.body.expires_at as string);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 900_000);
  });

  it("names the status and body when the sidecar does not answer 200", async () => {
    sidecar.failWith(403, "not your bucket");

    const error = await port(true)
      .signUrl({ ref, method: "GET", ttlSec: 60 })
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(ReplitSidecarSigningError);
    expect((error as Error).message).toContain("errorcode: 403");
    expect((error as Error).message).toContain("not your bucket");
  });

  it("refuses to sign, and says so, when the sidecar is not available", async () => {
    const off = port(false);

    expect(off.supportsSignedUrls).toBe(false);
    await expect(off.signUrl({ ref, method: "GET", ttlSec: 60 })).rejects.toBeInstanceOf(
      SignedUrlsUnsupportedError
    );
    expect(sidecar.requests).toHaveLength(0);
    expect(port(true).supportsSignedUrls).toBe(true);
  });
});
