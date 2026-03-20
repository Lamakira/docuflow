/**
 * dist-win.js — Build Windows NSIS installer via electron-builder.
 *
 * Workflow:
 *   1. Clean previous build artifacts (out/ + installer/)
 *   2. electron-forge package  → out/<AppName>-win32-x64/
 *   3. electron-builder --prepackaged → release/DocuFlowAgentSetup.exe (single file)
 *
 * Key config:
 *   - differentialPackage: false  → single-file .exe (no separate .nsis.7z)
 *   - compression: normal         → balanced speed/size
 *   - forge ignore: no LICENSES.chromium.html, only en-US+fr locales
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const DEBUG = process.argv.includes("--debug");

// ── Step 0: Clean installer/ ────────────────────────────────────────────────

console.log("\n[dist-win] Step 0: cleaning installer/...");
const installerCleanDir = path.join(ROOT, "release");
if (fs.existsSync(installerCleanDir)) {
  try {
    fs.rmSync(installerCleanDir, { recursive: true, force: true });
    console.log("  deleted installer/");
  } catch {
    console.warn("  WARNING: could not clean installer/ (files may be locked) — continuing anyway");
  }
}
// Note: out/ is cleaned by electron-forge package (overwrite: true)

// ── Step 1: forge package ───────────────────────────────────────────────────

console.log("\n[dist-win] Step 1: electron-forge package...\n");
execSync("npx electron-forge package --platform win32 --arch x64", {
  cwd: ROOT,
  stdio: "inherit",
});

// ── Locate packaged output ──────────────────────────────────────────────────

const outDir = path.join(ROOT, "out");
const appFolderName = fs
  .readdirSync(outDir)
  .find((name) => name.endsWith("-win32-x64") && !name.startsWith("."));

if (!appFolderName) {
  console.error("[dist-win] ERROR: no packaged output found in out/");
  process.exit(1);
}

const prepackaged = path.join(outDir, appFolderName);

// ── Debug: report top 20 biggest files ─────────────────────────────────────

if (DEBUG) {
  console.log("\n[dist-win] DEBUG: top 20 biggest files in packaged app:");
  const allFiles = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else allFiles.push({ path: full, size: fs.statSync(full).size });
    }
  }
  walk(prepackaged);
  allFiles
    .sort((a, b) => b.size - a.size)
    .slice(0, 20)
    .forEach((f) => {
      const rel = path.relative(prepackaged, f.path);
      console.log(`  ${(f.size / 1048576).toFixed(1).padStart(7)} MB  ${rel}`);
    });
  const total = allFiles.reduce((s, f) => s + f.size, 0);
  console.log(`  ${"─".repeat(40)}`);
  console.log(`  ${(total / 1048576).toFixed(0).padStart(7)} MB  TOTAL (${allFiles.length} files)`);
}

console.log(`\n[dist-win] Packaged app: ${prepackaged}`);

// ── Step 2: electron-builder single-file NSIS ───────────────────────────────

console.log("\n[dist-win] Step 2: electron-builder NSIS (single file)...\n");
execSync(
  `npx electron-builder --win nsis --prepackaged "${prepackaged}" --publish never`,
  { cwd: ROOT, stdio: "inherit" }
);

// ── Report output ───────────────────────────────────────────────────────────

const installerDir = path.join(ROOT, "release");
const artifacts = fs.existsSync(installerDir)
  ? fs.readdirSync(installerDir).filter((f) => f.endsWith(".exe"))
  : [];

if (artifacts.length === 0) {
  console.error("[dist-win] ERROR: no .exe found in installer/");
  process.exit(1);
}

console.log("\n[dist-win] ✅ Done! Artifacts:");
artifacts.forEach((f) => {
  const size = fs.statSync(path.join(installerDir, f)).size;
  console.log(`  release/${f}  (${(size / 1048576).toFixed(0)} MB)`);
});
