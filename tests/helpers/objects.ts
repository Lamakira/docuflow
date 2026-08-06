import { putObject } from "../fakes/gcs";

/**
 * Complete the half of an upload that normally happens in the browser.
 *
 * The server hands out a signed PUT URL and never sees the bytes; the client
 * uploads straight to storage and posts the URL back. This seeds the fake bucket
 * with what that PUT would have stored, so the follow-up request finds an object
 * where it expects one.
 *
 * Returns the same URL, which is what callers send back as `storagePath`.
 */
export function completeUpload(
  signedUrl: string,
  body: string | Buffer = "file contents",
  contentType = "application/octet-stream"
): string {
  const { pathname } = new URL(signedUrl);
  // "/test-bucket/.private/uploads/<id>" → "test-bucket/.private/uploads/<id>"
  putObject(pathname.slice(1), body, { contentType });
  return signedUrl;
}

/** The `/objects/...` path the server stores for a signed upload URL. */
export function objectPathFor(signedUrl: string, privateDir = "/test-bucket/.private"): string {
  const { pathname } = new URL(signedUrl);
  return `/objects/${pathname.slice(privateDir.length + 1)}`;
}
