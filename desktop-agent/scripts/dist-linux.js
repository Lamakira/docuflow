/**
 * dist-linux.js — Build Linux .deb package via electron-forge.
 *
 * Target: Ubuntu 20.04+ (x64)
 *
 * Workflow:
 *   1. Clean previous build artifacts (out/ + release/)
 *   2. electron-forge make --platform linux → out/make/deb/x64/*.deb
 *   3. Copy to release/DocuFlow-Agent-{version}-linux-amd64.deb
 *
 * Install on Ubuntu:
 *   sudo dpkg -i release/DocuFlow-Agent-{version}-linux-amd64.deb
 *
 * Note: must be run on Linux (or via WSL/CI runner) — electron-forge cannot
 * cross-compile Linux packages from Windows.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));

// ── Step 0: Clean ────────────────────────────────────────────────────────────

console.log("\n[dist-linux] Step 0: cleaning release/...");
const releaseDir = path.join(ROOT, "release");
if (fs.existsSync(releaseDir)) {
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    console.log("  deleted release/");
  } catch {
    console.warn("  WARNING: could not clean release/ — continuing anyway");
  }
}

// ── Step 1: electron-forge make ─────────────────────────────────────────────

console.log("\n[dist-linux] Step 1: electron-forge make (linux x64, maker-deb)...\n");
execSync(
  "npx electron-forge make --platform linux --arch x64",
  { cwd: ROOT, stdio: "inherit" }
);

// ── Step 2: Locate .deb output ───────────────────────────────────────────────

const makeDebDir = path.join(ROOT, "out", "make", "deb", "x64");
if (!fs.existsSync(makeDebDir)) {
  console.error(`[dist-linux] ERROR: expected output dir not found: ${makeDebDir}`);
  process.exit(1);
}

const debFiles = fs.readdirSync(makeDebDir).filter((f) => f.endsWith(".deb"));
if (debFiles.length === 0) {
  console.error("[dist-linux] ERROR: no .deb file found in out/make/deb/x64/");
  process.exit(1);
}

// ── Step 3: Copy to release/ with canonical name ─────────────────────────────

fs.mkdirSync(releaseDir, { recursive: true });

const version = pkg.version;
const targetName = `DocuFlow-Agent-${version}-linux-amd64.deb`;
const srcPath = path.join(makeDebDir, debFiles[0]);
const destPath = path.join(releaseDir, targetName);

fs.copyFileSync(srcPath, destPath);

const sizeBytes = fs.statSync(destPath).size;
console.log("\n[dist-linux] Done!");
console.log(`  release/${targetName}  (${(sizeBytes / 1048576).toFixed(0)} MB)`);
console.log("\n  Install on Ubuntu:");
console.log(`  sudo dpkg -i release/${targetName}`);
