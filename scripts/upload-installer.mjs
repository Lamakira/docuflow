#!/usr/bin/env node
/**
 * upload-installer.mjs — Chunked upload of a desktop installer to the DocuFlow prod server.
 *
 * Usage:
 *   node scripts/upload-installer.mjs <platform> <file> [api-url]
 *
 * Example:
 *   DESKTOP_RELEASE_CI_TOKEN=xxx node scripts/upload-installer.mjs windows installers/DocuFlow-Agent-0.1.7-windows-setup.exe https://docs.appvibed.com
 *
 * Env vars:
 *   DESKTOP_RELEASE_CI_TOKEN — required
 *   DOCUFLOW_API_URL         — optional fallback for api-url
 */

import { readFileSync } from "fs";
import { createHash, randomBytes } from "crypto";
import path from "path";

const CHUNK_SIZE = 20 * 1024 * 1024; // 20 MB per chunk (server limit 25 MB)

const [, , platform, filePath, apiUrlArg] = process.argv;

if (!platform || !filePath) {
  console.error("Usage: node scripts/upload-installer.mjs <platform> <file> [api-url]");
  process.exit(1);
}

const API_URL = (apiUrlArg || process.env.DOCUFLOW_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.DESKTOP_RELEASE_CI_TOKEN;

if (!API_URL) {
  console.error("Error: set DOCUFLOW_API_URL env var or pass api-url as 3rd argument");
  process.exit(1);
}
if (!TOKEN) {
  console.error("Error: DESKTOP_RELEASE_CI_TOKEN env var is required");
  process.exit(1);
}

// ── Extract version from filename ─────────────────────────────────────────────
const filename = path.basename(filePath);
const versionMatch = filename.match(/(\d+\.\d+\.\d+)/);
if (!versionMatch) {
  console.error("Error: could not extract semver version from filename:", filename);
  process.exit(1);
}
const version = versionMatch[1];

// ── File info ──────────────────────────────────────────────────────────────────
const fileBuffer = readFileSync(filePath);
const fileSize = fileBuffer.length;
const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
const uploadId = randomBytes(12).toString("hex");

console.log(`\nDocuFlow Installer Upload`);
console.log(`─────────────────────────────────────────`);
console.log(`  Platform    : ${platform}`);
console.log(`  Version     : ${version}`);
console.log(`  File        : ${filename}`);
console.log(`  Size        : ${(fileSize / 1048576).toFixed(1)} MB`);
console.log(`  Chunks      : ${totalChunks} × ${CHUNK_SIZE / 1048576} MB`);
console.log(`  SHA256      : ${sha256}`);
console.log(`  Upload ID   : ${uploadId}`);
console.log(`  Target      : ${API_URL}/api/internal/desktop-releases/upload-chunk`);
console.log(``);

// ── Upload chunks ─────────────────────────────────────────────────────────────
for (let i = 0; i < totalChunks; i++) {
  const start = i * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, fileSize);
  const chunk = fileBuffer.slice(start, end);

  process.stdout.write(`  Chunk ${i + 1}/${totalChunks} (${(chunk.length / 1048576).toFixed(1)} MB)... `);

  const response = await fetch(`${API_URL}/api/internal/desktop-releases/upload-chunk`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/octet-stream",
      "X-Upload-Id": uploadId,
      "X-Chunk-Index": String(i),
      "X-Total-Chunks": String(totalChunks),
      "X-Version": version,
      "X-Platform": platform,
      "X-Filename": filename,
      "X-File-Size": String(fileSize),
      "X-SHA256": sha256,
    },
    body: chunk,
  });

  const body = await response.json();

  if (!response.ok) {
    console.error(`\nFAILED (HTTP ${response.status}):`, body);
    process.exit(1);
  }

  if (body.status === "partial") {
    console.log(`OK (partial, received=${body.received}/${body.total})`);
  } else {
    // Final chunk — server returns the release record
    console.log(`OK (complete)`);
    console.log(`\n  Published!`);
    console.log(`  Version    : ${body.version}`);
    console.log(`  Platform   : ${body.platform}`);
    console.log(`  Filename   : ${body.filename}`);
    console.log(`  Size       : ${(body.fileSize / 1048576).toFixed(1)} MB`);
    console.log(`  SHA256     : ${body.sha256}`);
    console.log(`  Download   : ${API_URL}${body.storageUrl}`);
    console.log(``);
  }
}
