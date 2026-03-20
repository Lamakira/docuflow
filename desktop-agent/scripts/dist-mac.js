/**
 * dist-mac.js — Build macOS .dmg via electron-forge.
 *
 * Target: macOS 12+ (Monterey), universal binary (Intel + Apple Silicon)
 *
 * IMPORTANT: must be run on macOS — DMG creation requires macOS hdiutil.
 * Cross-compilation from Windows/Linux is not supported by maker-dmg.
 *
 * Workflow:
 *   1. Guard: exit if not running on macOS
 *   2. Warn if assets/icon.icns is missing (run gen-icons.js first)
 *   3. Clean release/
 *   4. electron-forge make --platform darwin --arch x64
 *   5. Copy .dmg to release/DocuFlow-Agent-{version}-macos.dmg
 *
 * Code signing:
 *   Not configured here. Without an Apple Developer ID certificate,
 *   macOS Gatekeeper will show a warning on first launch.
 *   Users can bypass via: right-click → Open → Open (once only).
 *
 * To sign (future):
 *   Set APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID env vars and configure
 *   packagerConfig.osxSign + osxNotarize in forge.config.ts.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── Guard: macOS only ─────────────────────────────────────────────────────────

if (process.platform !== "darwin") {
  console.error("[dist-mac] ERROR: This script must be run on macOS.");
  console.error("           DMG creation requires macOS hdiutil (not available on Windows/Linux).");
  console.error("           Run this script on a Mac or in a macOS CI runner (e.g. macos-latest on GitHub Actions).");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));

// ── Warn if .icns is missing ──────────────────────────────────────────────────

const icnsPath = path.join(ROOT, "assets", "icon.icns");
if (!fs.existsSync(icnsPath)) {
  console.warn("[dist-mac] WARNING: assets/icon.icns not found.");
  console.warn("           The app will be built with a default Electron icon.");
  console.warn("           To generate .icns: node scripts/gen-icons.js  (on macOS)");
}

// ── Step 0: Clean release/ ────────────────────────────────────────────────────

console.log("\n[dist-mac] Step 0: cleaning release/...");
const releaseDir = path.join(ROOT, "release");
if (fs.existsSync(releaseDir)) {
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    console.log("  deleted release/");
  } catch {
    console.warn("  WARNING: could not clean release/ — continuing anyway");
  }
}

// ── Step 1: electron-forge make ──────────────────────────────────────────────

console.log("\n[dist-mac] Step 1: electron-forge make (darwin x64, maker-dmg)...\n");
execSync(
  "npx electron-forge make --platform darwin --arch x64",
  { cwd: ROOT, stdio: "inherit" }
);

// ── Step 2: Locate .dmg output ───────────────────────────────────────────────

const makeDmgDir = path.join(ROOT, "out", "make");
if (!fs.existsSync(makeDmgDir)) {
  console.error(`[dist-mac] ERROR: expected output dir not found: ${makeDmgDir}`);
  process.exit(1);
}

// maker-dmg puts the file directly in out/make/
const dmgFiles = fs.readdirSync(makeDmgDir).filter((f) => f.endsWith(".dmg"));
if (dmgFiles.length === 0) {
  console.error("[dist-mac] ERROR: no .dmg file found in out/make/");
  process.exit(1);
}

// ── Step 3: Copy to release/ with canonical name ─────────────────────────────

fs.mkdirSync(releaseDir, { recursive: true });

const version = pkg.version;
const targetName = `DocuFlow-Agent-${version}-macos.dmg`;
const srcPath = path.join(makeDmgDir, dmgFiles[0]);
const destPath = path.join(releaseDir, targetName);

fs.copyFileSync(srcPath, destPath);

const sizeBytes = fs.statSync(destPath).size;
console.log("\n[dist-mac] Done!");
console.log(`  release/${targetName}  (${(sizeBytes / 1048576).toFixed(0)} MB)`);
console.log("\n  Install on macOS:");
console.log("  1. Open the .dmg");
console.log("  2. Drag DocuFlow Agent.app to Applications");
console.log("  3. First launch: right-click → Open (bypasses Gatekeeper for unsigned builds)");
