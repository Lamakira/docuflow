/**
 * Electron Forge configuration.
 *
 * Forge is used for dev (electron-forge start) and packaging (electron-forge package).
 * Distribution is handled by electron-builder (see scripts/dist-win.js).
 */

import type { ForgeConfig } from "@electron-forge/shared-types";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import path from "path";
import fs from "fs";

const config: ForgeConfig = {
  packagerConfig: {
    name: "DocuFlow Agent",
    executableName: "docuflow-agent",
    asar: true,
    appBundleId: "com.docuflow.agent",
    // App icon — Forge appends the right extension per OS (.ico win32, .icns darwin, .png linux)
    icon: "./assets/icon",
    // Copy assets alongside app.asar so they're accessible at process.resourcesPath/assets/
    extraResource: ["./assets"],
    // uiohook-napi ships platform-specific .node binaries that cannot live inside the asar archive.
    // Electron's require() transparently redirects lookups to app.asar.unpacked/ for these paths.
    asarUnpack: ["**/uiohook-napi/**", "**/uiohook-napi-*/**"],
    // Remove large Electron binary files that are unnecessary for users.
    // NOTE: we use afterComplete (not ignore) to avoid overriding the webpack plugin's
    // default ignore function (which excludes everything except .webpack/).
    afterComplete: [
      async (buildPath: string) => {
        // 1. Remove Chromium license HTML (8.7 MB) — not needed at runtime
        const licensesPath = path.join(buildPath, "LICENSES.chromium.html");
        if (fs.existsSync(licensesPath)) {
          fs.rmSync(licensesPath);
        }

        // 2. Remove unused locale paks — keep only en-US and fr
        const localesDir = path.join(buildPath, "locales");
        if (fs.existsSync(localesDir)) {
          const keep = new Set(["en-US.pak", "fr.pak"]);
          for (const file of fs.readdirSync(localesDir)) {
            if (!keep.has(file)) {
              fs.rmSync(path.join(localesDir, file));
            }
          }
        }
      },
    ],
  },
  makers: [
    // ZIP portable — fallback, no install needed
    { name: "@electron-forge/maker-zip", platforms: ["win32", "darwin"] },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "docuflow-agent",
          productName: "DocuFlow Agent",
          genericName: "Time Tracker",
          description: "DocuFlow Desktop Agent — time tracking and activity monitoring",
          productDescription:
            "DocuFlow Desktop Agent lets you track time, monitor activity, and capture screenshots. Syncs automatically with your DocuFlow workspace.",
          categories: ["Utility", "Office"],
          icon: "./assets/icon.png",
          maintainer: "DocuFlow <support@docuflow.app>",
          homepage: "https://techma-doc--masdouk1.replit.app",
          // libayatana-appindicator3-1: system tray support on Ubuntu 22.04+
          // libappindicator3-1: fallback for Ubuntu 20.04
          depends: ["libayatana-appindicator3-1 | libappindicator3-1"],
          section: "utils",
        },
      },
    },
    // NOTE: maker-dmg is declared here for completeness but is NOT used by the
    // release pipeline. dist-mac.js calls `electron-forge package` (not `make`),
    // then passes the packaged .app to electron-builder which creates the DMG.
    // electron-builder is used because it handles code signing and notarization
    // via the afterSign hook (scripts/notarize.js).
    // This entry exists so `forge make` would work in isolation if needed.
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        // DMG window name (shown in Finder title bar)
        name: "DocuFlow Agent",
        // Compressed read-only format — standard for macOS distribution (macOS 10.11+)
        format: "ULFO",
        // Overwrite any existing DMG in out/make/
        overwrite: true,
      },
    },
  ],
  plugins: [
    new WebpackPlugin({
      mainConfig: "./webpack.main.config.js",
      renderer: {
        config: "./webpack.renderer.config.js",
        entryPoints: [
          {
            html: "./src/renderer/index.html",
            js: "./src/renderer/index.tsx",
            name: "main_window",
            preload: {
              js: "./src/renderer/preload.ts",
            },
          },
          {
            html: "./src/renderer/widget.html",
            js: "./src/renderer/widget.tsx",
            name: "widget_window",
            preload: {
              js: "./src/renderer/widget-preload.ts",
            },
          },
        ],
      },
    }),
  ],
};

export default config;
