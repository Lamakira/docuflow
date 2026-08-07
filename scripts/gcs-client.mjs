/**
 * Google Cloud Storage access for the release scripts.
 *
 * Credentials come from the same environment the server reads, and one of the
 * same two must be set: an inline service-account key in
 * `GCS_SERVICE_ACCOUNT_KEY` (verbatim JSON or base64-encoded), or a path to that
 * key file in `GOOGLE_APPLICATION_CREDENTIALS`. The installer bucket is named by
 * `INSTALLER_GCS_BUCKET` — the same variable the release workflow uses, and
 * never a bucket hard-coded here (ADR-0018: this repository holds no production
 * identifiers).
 *
 * This duplicates the rules `server/config.ts` applies, including its validation
 * errors, because a `.mjs` entry point cannot import a TypeScript server module
 * — the same constraint `drizzle.config.ts` runs under. Keep the two in step: a
 * decode this file accepts and the server rejects is a release that succeeds
 * against a bucket the app cannot then read.
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
  if (!raw) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
      throw new Error(
        "No storage credential. Set GCS_SERVICE_ACCOUNT_KEY to the service-account " +
          "key file's JSON, or GOOGLE_APPLICATION_CREDENTIALS to a path to it."
      );
    }
    // The SDK reads the key file the variable names.
    return new Storage();
  }

  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");

  let key;
  try {
    key = JSON.parse(json);
  } catch {
    throw new Error(
      "GCS_SERVICE_ACCOUNT_KEY is not valid JSON. Supply the service-account key " +
        "file's contents, either verbatim or base64-encoded."
    );
  }

  if (!key.client_email || !key.private_key) {
    throw new Error(
      "GCS_SERVICE_ACCOUNT_KEY is missing client_email or private_key — it does " +
        "not look like a service-account key file."
    );
  }

  return new Storage({
    projectId: process.env.GCS_PROJECT_ID?.trim() || key.project_id,
    credentials: { client_email: key.client_email, private_key: key.private_key },
  });
}
