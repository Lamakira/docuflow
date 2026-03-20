/**
 * dist-mac.js — Build macOS .dmg.
 *
 * Same pattern as dist-win.js:
 *   1. electron-forge package --platform darwin  → out/<AppName>-darwin-x64/
 *   2. electron-builder --mac dmg --prepackaged  → release/DocuFlow-Agent-{v}-macos.dmg
 *
 * IMPORTANT: must run on macOS — DMG creation requires macOS hdiutil.
 *
 * Code signing:
 *   Not configured. Without Apple Developer ID, Gatekeeper warns on first launch.
 *   Bypass: right-click → Open → Open (one-time).
 *
 * Output: desktop-agent/release/DocuFlow-Agent-{version}-macos.dmg
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── Guard: macOS only ─────────────────────────────────────────────────────────

if (process.platform !== "darwin") {
  console.error("[dist-mac] ERROR: This script must run on macOS.");
  console.error("           DMG creation requires macOS hdiutil.");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));

// ── Warn if .icns missing ─────────────────────────────────────────────────────

if (!fs.existsSync(path.join(ROOT, "assets", "icon.icns"))) {
  console.warn("[dist-mac] WARNING: assets/icon.icns not found — app will use default Electron icon.");
  console.warn("           Run: node scripts/gen-icons.js  (on macOS)");
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

// ── Step 1: electron-forge package ───────────────────────────────────────────

console.log("\n[dist-mac] Step 1: electron-forge package...\n");
execSync("npx electron-forge package --platform darwin --arch x64", {
  cwd: ROOT,
  stdio: "inherit",
});

// ── Locate packaged output ────────────────────────────────────────────────────

const outDir = path.join(ROOT, "out");
const appFolderName = fs
  .readdirSync(outDir)
  .find((name) => name.endsWith("-darwin-x64") && !name.startsWith("."));

if (!appFolderName) {
  console.error("[dist-mac] ERROR: no packaged output found in out/");
  process.exit(1);
}

const prepackaged = path.join(outDir, appFolderName);
console.log(`\n[dist-mac] Packaged app: ${prepackaged}`);

// ── Step 2: electron-builder DMG ─────────────────────────────────────────────

console.log("\n[dist-mac] Step 2: electron-builder dmg...\n");
execSync(
  `npx electron-builder --mac dmg --prepackaged "${prepackaged}"`,
  { cwd: ROOT, stdio: "inherit" }
);

// ── Report output ─────────────────────────────────────────────────────────────

const artifacts = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((f) => f.endsWith(".dmg"))
  : [];

if (artifacts.length === 0) {
  console.error("[dist-mac] ERROR: no .dmg found in release/");
  process.exit(1);
}

console.log("\n[dist-mac] Done! Artifacts:");
artifacts.forEach((f) => {
  const size = fs.statSync(path.join(releaseDir, f)).size;
  console.log(`  release/${f}  (${(size / 1048576).toFixed(0)} MB)`);
});
console.log("\n  Install on macOS:");
console.log("  1. Open the .dmg");
console.log("  2. Drag DocuFlow Agent.app to Applications");
console.log("  3. First launch: right-click → Open (bypasses Gatekeeper)");
