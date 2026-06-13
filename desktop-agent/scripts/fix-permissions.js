#!/usr/bin/env node
/**
 * Fix permissions on the packaged app folder before building .deb
 *
 * electron-builder sometimes creates the app folder with drwx------ (700)
 * which means only root can access the folder. This prevents the app from
 * being discovered by the desktop environment or launched by regular users.
 *
 * This script runs after electron-builder packages the app but before the .deb is built.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "out");

// Find the packaged app folder (e.g., "DocuFlow Desktop Agent-linux-x64")
const appFolders = fs
  .readdirSync(OUT_DIR)
  .filter((name) => name.endsWith("-linux-x64"));

if (appFolders.length === 0) {
  console.error("[fix-permissions] No packaged app folder found in out/");
  process.exit(1);
}

const appFolder = appFolders[0];
const appFolderPath = path.join(OUT_DIR, appFolder);

// Fix permissions:
// - 755 on the app folder itself (drwxr-xr-x) so anyone can access it
// - 755 on the executable so it's runnable
// - 755 on all subdirectories
// - 644 on files
console.log(`[fix-permissions] Fixing permissions in ${appFolderPath}...`);

try {
  execSync(`chmod 755 "${appFolderPath}"`, { stdio: "pipe" });
  execSync(`chmod -R 755 "${appFolderPath}"`, { stdio: "pipe" });
  // Files should be 644 (not executable)
  execSync(`find "${appFolderPath}" -type f ! -name "*.so" -exec chmod 644 {} +`, { stdio: "pipe" });
  // The main executable should be 755
  execSync(`chmod 755 "${appFolderPath}/docuflow-agent"`, { stdio: "pipe" });
  // Other executables
  execSync(`chmod 755 "${appFolderPath}/chrome_crashpad_handler"`, { stdio: "pipe" });
  execSync(`chmod 755 "${appFolderPath}/chrome-sandbox"`, { stdio: "pipe" });
  console.log("[fix-permissions] Permissions fixed.");
} catch (err) {
  console.error("[fix-permissions] Error:", err.message);
  process.exit(1);
}
