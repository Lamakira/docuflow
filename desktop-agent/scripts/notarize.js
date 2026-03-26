/**
 * notarize.js — electron-builder afterSign hook.
 *
 * Called automatically by electron-builder after code signing.
 * Submits the signed .app to Apple's notary service via notarytool.
 *
 * Required env vars (set in CI or locally before running dist:mac):
 *   APPLE_ID                   — Apple ID email (e.g. dev@yourcompany.com)
 *   APPLE_APP_SPECIFIC_PASSWORD — App-specific password from appleid.apple.com
 *   APPLE_TEAM_ID              — 10-character team ID from developer.apple.com
 *
 * Signing identity is resolved automatically from the macOS Keychain.
 * To set it explicitly, export: CSC_NAME="Developer ID Application: Your Name (TEAMID)"
 *
 * If any env var is missing, notarization is skipped with a clear warning
 * (allows unsigned local dev builds to still go through electron-builder).
 *
 * Docs: https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
 */

"use strict";

const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  // Only run on macOS builds
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;

  // Guard: handle missing credentials.
  // - In CI (GitHub Actions): hard failure — a release must never ship unsigned.
  // - Locally: warn and skip — allows unsigned dev builds without Apple credentials.
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    const isCI = process.env.GITHUB_ACTIONS === "true";
    const msg =
      "[notarize] Missing Apple credentials: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.\n" +
      "  The app will be BLOCKED by Gatekeeper on macOS 13+ without notarization.";
    if (isCI) {
      throw new Error(
        `[notarize] CI build failed — notarization is mandatory for release.\n${msg}\n` +
          "  Add the missing secrets in: GitHub → repo → Settings → Secrets and variables → Actions"
      );
    }
    console.warn(`\n${msg}\n`);
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`\n[notarize] Submitting ${appPath} to Apple notary service...`);
  console.log(`[notarize] Apple ID: ${APPLE_ID} | Team: ${APPLE_TEAM_ID}`);

  await notarize({
    tool: "notarytool",
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  console.log("[notarize] Done — notarization ticket stapled by electron-builder.");
};
