/**
 * Upload a desktop installer to the public installer directory in Google Cloud
 * Storage, using the service-account credentials in the environment.
 *
 * Usage: node scripts/upload-to-gcs.mjs <platform> <filepath>
 *   platform: windows | macos | linux
 *   filepath: local path to the installer file
 *
 * Environment: INSTALLER_GCS_BUCKET, plus GCS_SERVICE_ACCOUNT_KEY unless
 * Application Default Credentials are already available. See .env.example.
 *
 * Outputs the gs:// path suitable for updating the DB storageUrl.
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { gcsClient, installerBucketName } from "./gcs-client.mjs";

const INSTALLER_PREFIX = "public/installers";

const [, , platform, filePath] = process.argv;
if (!platform || !filePath) {
  console.error("Usage: node scripts/upload-to-gcs.mjs <platform> <filepath>");
  process.exit(1);
}

const bucketName = installerBucketName();
const filename = path.basename(filePath);
const objectName = `${INSTALLER_PREFIX}/${filename}`;
const gcsPath = `gs://${bucketName}/${objectName}`;

// Compute SHA256 for verification
const fileBuffer = fs.readFileSync(filePath);
const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
const fileSize = fileBuffer.length;

console.log(`[upload-to-gcs] Platform: ${platform}`);
console.log(`[upload-to-gcs] File: ${filename} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
console.log(`[upload-to-gcs] SHA256: ${sha256}`);
console.log(`[upload-to-gcs] Target: ${gcsPath}`);
console.log("[upload-to-gcs] Uploading...");

// The client holds credentials of its own, so it uploads straight to the bucket
// — no signed URL in between, and resumable by default for large installers.
await gcsClient().bucket(bucketName).upload(filePath, {
  destination: objectName,
  contentType: "application/octet-stream",
});

console.log(`[upload-to-gcs] Upload complete!`);
console.log(`[upload-to-gcs] GCS path: ${gcsPath}`);
console.log(`GCS_PATH=${gcsPath}`);
