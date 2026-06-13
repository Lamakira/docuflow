/**
 * dist-linux.js — Build Linux .deb package.
 *
 * Same pattern as dist-win.js:
 *   1. electron-forge package --platform linux  → out/<AppName>-linux-x64/
 *   2. electron-builder --linux deb --prepackaged → release/DocuFlow-Agent-{v}-linux-amd64.deb
 *
 * Must run on Linux (Ubuntu recommended).
 * Output: desktop-agent/release/DocuFlow-Agent-{version}-linux-amd64.deb
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));

// ── Step 0: Clean release/ ────────────────────────────────────────────────────

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

// ── Step 1: electron-forge package ───────────────────────────────────────────

console.log("\n[dist-linux] Step 1: electron-forge package...\n");
execSync("npx electron-forge package --platform linux --arch x64", {
  cwd: ROOT,
  stdio: "inherit",
});

// ── Locate packaged output ────────────────────────────────────────────────────

const outDir = path.join(ROOT, "out");
const appFolderName = fs
  .readdirSync(outDir)
  .find((name) => name.endsWith("-linux-x64") && !name.startsWith("."));

if (!appFolderName) {
  console.error("[dist-linux] ERROR: no packaged output found in out/");
  process.exit(1);
}

const prepackaged = path.join(outDir, appFolderName);
console.log(`\n[dist-linux] Packaged app: ${prepackaged}`);

// ── Step 1.5: Fix permissions ─────────────────────────────────────────────────
// electron-forge creates the app folder with drwx------ (700) on some systems.
// This blocks regular users from entering /opt/DocuFlow Desktop Agent/ after install.
// We fix it here: directories → 755, files → 644, executables → 755.

console.log("\n[dist-linux] Step 1.5: fixing permissions...");
try {
  // Make the app folder traversable by all users
  execSync(`chmod 755 "${prepackaged}"`, { stdio: "pipe" });
  // Recursively set directories to 755
  execSync(`find "${prepackaged}" -type d -exec chmod 755 {} +`, { stdio: "pipe" });
  // Set all regular files to 644
  execSync(`find "${prepackaged}" -type f -exec chmod 644 {} +`, { stdio: "pipe" });
  // Make the main executable runnable
  const execNames = ["docuflow-agent", "chrome_crashpad_handler", "chrome-sandbox"];
  for (const name of execNames) {
    const p = path.join(prepackaged, name);
    if (fs.existsSync(p)) {
      execSync(`chmod 755 "${p}"`, { stdio: "pipe" });
      console.log(`  chmod 755 ${name}`);
    }
  }
  // Also make .so shared libs executable (must quote path properly to handle spaces)
  execSync(`find "${prepackaged}" \\( -name "*.so" -o -name "*.so.*" \\) -exec chmod 755 {} +`, { stdio: "pipe", shell: true });
  console.log("  Permissions fixed.");
} catch (err) {
  console.error("[dist-linux] WARNING: could not fix permissions:", err.message);
  // Don't exit — try to build anyway
}

// ── Step 2: electron-builder .deb ────────────────────────────────────────────

console.log("\n[dist-linux] Step 2: electron-builder deb...\n");
execSync(
  `npx electron-builder --linux deb --prepackaged "${prepackaged}" --publish never`,
  { cwd: ROOT, stdio: "inherit" }
);

// ── Report output ─────────────────────────────────────────────────────────────

const artifacts = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((f) => f.endsWith(".deb"))
  : [];

if (artifacts.length === 0) {
  console.error("[dist-linux] ERROR: no .deb found in release/");
  process.exit(1);
}

console.log("\n[dist-linux] Done! Artifacts:");
artifacts.forEach((f) => {
  const size = fs.statSync(path.join(releaseDir, f)).size;
  console.log(`  release/${f}  (${(size / 1048576).toFixed(0)} MB)`);
});
console.log("\n  Install on Ubuntu:");
console.log(`  sudo dpkg -i release/${artifacts[0]}`);
