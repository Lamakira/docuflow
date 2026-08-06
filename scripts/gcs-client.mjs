/**
 * Google Cloud Storage access for the release scripts.
 *
 * Credentials come from the same environment the server reads: an inline
 * service-account key in `GCS_SERVICE_ACCOUNT_KEY` (verbatim JSON or
 * base64-encoded), or Application Default Credentials when that is unset. The
 * installer bucket is named by `INSTALLER_GCS_BUCKET` — the same variable the
 * release workflow uses, and never a bucket hard-coded here (ADR-0018: this
 * repository holds no production identifiers).
 */
import { Storage } from "@google-cloud/storage";

export function installerBucketName() {
  const bucket = process.env.INSTALLER_GCS_BUCKET?.trim();
  if (!bucket) {
    throw new Error(
      "INSTALLER_GCS_BUCKET is not set — name the bucket installers are published to."
    );
  }
  return bucket;
}

export function gcsClient() {
  const raw = process.env.GCS_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) return new Storage();

  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const key = JSON.parse(json);
  return new Storage({
    projectId: process.env.GCS_PROJECT_ID?.trim() || key.project_id,
    credentials: { client_email: key.client_email, private_key: key.private_key },
  });
}
