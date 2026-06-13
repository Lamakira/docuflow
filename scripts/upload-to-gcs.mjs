/**
 * Upload a desktop installer to Replit Object Storage (GCS) public directory.
 * Uses the Replit sidecar to generate a signed PUT URL, then streams the file.
 *
 * Usage: node scripts/upload-to-gcs.mjs <platform> <filepath>
 *   platform: windows | macos | linux
 *   filepath: local path to the installer file
 *
 * Outputs the gs:// path suitable for updating the DB storageUrl.
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";

const SIDECAR_URL = "http://127.0.0.1:1106";
const BUCKET = "replit-objstore-64708bc7-367f-45c8-9004-db72f81cbeba";
const INSTALLER_PREFIX = "public/installers";

const [, , platform, filePath] = process.argv;
if (!platform || !filePath) {
  console.error("Usage: node scripts/upload-to-gcs.mjs <platform> <filepath>");
  process.exit(1);
}

const filename = path.basename(filePath);
const objectName = `${INSTALLER_PREFIX}/${filename}`;
const gcsPath = `gs://${BUCKET}/${objectName}`;

// Compute SHA256 for verification
const fileBuffer = fs.readFileSync(filePath);
const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
const fileSize = fileBuffer.length;

console.log(`[upload-to-gcs] Platform: ${platform}`);
console.log(`[upload-to-gcs] File: ${filename} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
console.log(`[upload-to-gcs] SHA256: ${sha256}`);
console.log(`[upload-to-gcs] Target: ${gcsPath}`);

// 1. Get a signed PUT URL from the Replit sidecar
console.log("[upload-to-gcs] Getting signed PUT URL from sidecar...");
const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
const signResp = await fetch(`${SIDECAR_URL}/object-storage/signed-object-url`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    bucket_name: BUCKET,
    object_name: objectName,
    method: "PUT",
    expires_at: expiresAt,
  }),
});
if (!signResp.ok) {
  const body = await signResp.text();
  console.error(`[upload-to-gcs] Sidecar error ${signResp.status}: ${body}`);
  process.exit(1);
}
const { signed_url: signedUrl } = await signResp.json();
console.log("[upload-to-gcs] Got signed URL. Uploading...");

// 2. PUT the file to GCS via signed URL
const CHUNK = 16 * 1024 * 1024; // 16 MB chunks for logging
let uploaded = 0;
const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK });

// For signed URLs we need the full body in one PUT request
// Node's fetch supports ReadableStream body
const { Readable } = await import("stream");
const webStream = Readable.toWeb(fs.createReadStream(filePath));

const putResp = await fetch(signedUrl, {
  method: "PUT",
  headers: {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(fileSize),
  },
  body: webStream,
  duplex: "half",
});
if (!putResp.ok) {
  const body = await putResp.text();
  console.error(`[upload-to-gcs] GCS PUT error ${putResp.status}: ${body.slice(0, 500)}`);
  process.exit(1);
}

console.log(`[upload-to-gcs] Upload complete!`);
console.log(`[upload-to-gcs] GCS path: ${gcsPath}`);
console.log(`GCS_PATH=${gcsPath}`);
