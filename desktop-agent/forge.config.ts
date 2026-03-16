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
    // Copy assets alongside app.asar so they're accessible at process.resourcesPath/assets/
    extraResource: ["./assets"],
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
    { name: "@electron-forge/maker-deb", config: {} },
    { name: "@electron-forge/maker-dmg", config: {} },
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
        ],
      },
    }),
  ],
};

export default config;
