#!/usr/bin/env node
/**
 * publish-windows.js — Publish a locally built Windows installer to DocuFlow.
 *
 * Splits the .exe into 20 MB chunks and streams them to the server's chunked
 * upload endpoint, bypassing Replit's reverse proxy body-size limit.
 * No external npm dependencies — uses only Node.js built-ins.
 *
 * Usage:
 *   npm run publish:windows
 *   node scripts/publish-windows.js
 *   node scripts/publish-windows.js --version 0.1.6
 *   node scripts/publish-windows.js --version 0.1.6 --file path/to/setup.exe
 *   node scripts/publish-windows.js --api-url https://... --token <token>
 *
 * Configuration (in priority order):
 *   --token <value>            or  DESKTOP_RELEASE_CI_TOKEN env var
 *   --api-url <url>            or  DOCUFLOW_API_URL env var  or  ~/.docuflow-url
 *   --version <semver>         or  auto-detected from filename
 *   --file <path>              or  auto-detected from desktop-agent/release/
 *   --chunk-size-mb <number>   default: 20
 */

import fs      from "fs";
import path    from "path";
import https   from "https";
import http    from "http";
import crypto  from "crypto";
import os      from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let version     = "";
let filePath    = "";
let apiUrl      = process.env.DOCUFLOW_API_URL || "";
let token       = process.env.DESKTOP_RELEASE_CI_TOKEN || "";
let chunkSizeMb = 20;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--version":       version     = args[++i]; break;
    case "--file":          filePath    = args[++i]; break;
    case "--api-url":       apiUrl      = args[++i]; break;
    case "--token":         token       = args[++i]; break;
    case "--chunk-size-mb": chunkSizeMb = parseInt(args[++i], 10); break;
    default:
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(1);
  }
}

// ── Resolve server URL ────────────────────────────────────────────────────────

if (!apiUrl) {
  const urlFile = path.join(os.homedir(), ".docuflow-url");
  if (fs.existsSync(urlFile)) {
    apiUrl = fs.readFileSync(urlFile, "utf8").trim();
  }
}
if (!apiUrl) {
  console.error(
    "Error: server URL not found.\n" +
    "  Set DOCUFLOW_API_URL, pass --api-url, or create ~/.docuflow-url"
  );
  process.exit(1);
}
apiUrl = apiUrl.replace(/\/$/, "");

// ── Resolve token ─────────────────────────────────────────────────────────────

if (!token) {
  console.error(
    "Error: DESKTOP_RELEASE_CI_TOKEN not set.\n" +
    "  Set the env var or pass --token <value>"
  );
  process.exit(1);
}

// ── Resolve installer file ────────────────────────────────────────────────────

if (!filePath) {
  const releaseDir = path.join(__dirname, "..", "desktop-agent", "release");
  if (fs.existsSync(releaseDir)) {
    const exes = fs.readdirSync(releaseDir)
      .filter(f => f.endsWith(".exe") && f.toLowerCase().includes("windows"));
    if (exes.length === 1) {
      filePath = path.join(releaseDir, exes[0]);
    } else if (exes.length > 1) {
      console.error(
        `Multiple Windows .exe files found in ${releaseDir}:\n` +
        exes.map(f => `  ${f}`).join("\n") +
        "\n  Specify one with --file <path>"
      );
      process.exit(1);
    }
  }
}
if (!filePath) {
  console.error(
    "Error: no Windows .exe found in desktop-agent/release/.\n" +
    "  Run 'cd desktop-agent && npm run dist:win' first, or pass --file <path>"
  );
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`Error: file not found: ${filePath}`);
  process.exit(1);
}

const filename = path.basename(filePath);

// ── Resolve version ───────────────────────────────────────────────────────────

if (!version) {
  const match = filename.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  if (match) version = match[1];
}
if (!version) {
  console.error(
    "Error: could not detect version from filename.\n" +
    "  Pass --version <semver> (e.g. --version 0.1.6)"
  );
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Error: invalid version format: ${version} (expected semver, e.g. 0.1.6)`);
  process.exit(1);
}

// ── File info ─────────────────────────────────────────────────────────────────

const fileBuffer  = fs.readFileSync(filePath);
const fileSize    = fileBuffer.length;
const sha256      = crypto.createHash("sha256").update(fileBuffer).digest("hex");
const fileSizeMb  = (fileSize / 1024 / 1024).toFixed(1);
const chunkSize   = chunkSizeMb * 1024 * 1024;
const totalChunks = Math.ceil(fileSize / chunkSize);
const uploadId    = crypto.randomUUID();

// ── Banner ────────────────────────────────────────────────────────────────────

console.log("");
console.log("DocuFlow Windows Release Publisher");
console.log("─".repeat(52));
console.log(`  Version    : ${version}`);
console.log(`  Platform   : windows`);
console.log(`  File       : ${filename}`);
console.log(`  Size       : ${fileSizeMb} MB (${fileSize.toLocaleString()} bytes)`);
console.log(`  SHA256     : ${sha256.slice(0, 16)}...`);
console.log(`  Server     : ${apiUrl}`);
console.log(`  Chunks     : ${totalChunks} × ${chunkSizeMb} MB`);
console.log(`  Upload ID  : ${uploadId}`);
console.log("");

// ── HTTP helper ───────────────────────────────────────────────────────────────

function postChunk(chunkData, chunkIndex) {
  return new Promise((resolve, reject) => {
    const url       = new URL(`${apiUrl}/api/internal/desktop-releases/upload-chunk`);
    const isHttps   = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const port      = url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80);

    const options = {
      hostname: url.hostname,
      port,
      path:     url.pathname,
      method:   "POST",
      headers: {
        "Authorization":  `Bearer ${token}`,
        "Content-Type":   "application/octet-stream",
        "Content-Length": chunkData.length,
        "X-Upload-Id":    uploadId,
        "X-Chunk-Index":  chunkIndex,
        "X-Total-Chunks": totalChunks,
        "X-Version":      version,
        "X-Platform":     "windows",
        "X-Filename":     filename,
        "X-File-Size":    fileSize,
        "X-SHA256":       sha256,
      },
    };

    const req = transport.request(options, (res) => {
      let body = "";
      res.on("data", d => (body += d));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve({ status: res.statusCode, body: parsed });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
          }
        } catch {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("error", reject);
    req.write(chunkData);
    req.end();
  });
}

// ── Upload ────────────────────────────────────────────────────────────────────

console.log("  Uploading...");
console.log("");

for (let i = 0; i < totalChunks; i++) {
  const start   = i * chunkSize;
  const end     = Math.min(start + chunkSize, fileSize);
  const chunk   = fileBuffer.subarray(start, end);
  const chunkMb = (chunk.length / 1024 / 1024).toFixed(1);
  const pct     = Math.round(((i + 1) / totalChunks) * 100);
  const label   = `[${String(i + 1).padStart(String(totalChunks).length)}/${totalChunks}]`;

  process.stdout.write(`  ${label}  ${chunkMb} MB  →  `);

  const result = await postChunk(chunk, i);

  if (result.status === 201) {
    console.log(`done  (${pct}%)`);
    console.log("");
    console.log("  Published successfully!");
    console.log(`  Version  : ${result.body.version}`);
    console.log(`  File     : ${result.body.filename}`);
    console.log(`  Size     : ${((result.body.fileSize || 0) / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  SHA256   : ${(result.body.sha256 || "").slice(0, 16)}...`);
    console.log(`  Download : ${apiUrl}/downloads/windows`);
    console.log(`  Check    : ${apiUrl}/downloads/availability`);
    console.log("");
  } else {
    console.log(`ok  (${pct}%)`);
  }
}
