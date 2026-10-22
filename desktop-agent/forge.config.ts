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
  hooks: {
    // Webpack 5 keeps internal handles alive after compiler.run() even when
    // there are no watchers, preventing the process from exiting naturally.
    // Force-exit here once packaging is fully done (afterComplete hooks have
    // already run at this point, so nothing is lost).
    postPackage: async () => {
      setImmediate(() => process.exit(0));
    },
    // The webpack plugin packages only .webpack/, so externals are missing at
    // runtime. Copy uiohook-napi (+ node-gyp-build) into the app's node_modules,
    // keeping only the prebuild for the target platform/arch. Without it the
    // agent silently falls back to powerMonitor (no global input auto-resume).
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      const srcModules = path.join(__dirname, "node_modules");
      const destModules = path.join(buildPath, "node_modules");
      const prebuild = `${platform}-${arch}`;

      const uiohookSrc = path.join(srcModules, "uiohook-napi");
      if (!fs.existsSync(path.join(uiohookSrc, "prebuilds", prebuild))) {
        throw new Error(`uiohook-napi has no prebuild for ${prebuild}`);
      }
      fs.cpSync(uiohookSrc, path.join(destModules, "uiohook-napi"), {
        recursive: true,
        filter: (src) => {
          const rel = path.relative(uiohookSrc, src).split(path.sep);
          if (rel[0] === "libuiohook" || rel[0] === "src" || rel[0] === "build") return false;
          if (rel[0] === "prebuilds" && rel[1] && rel[1] !== prebuild) return false;
          return true;
        },
      });
      fs.cpSync(path.join(srcModules, "node-gyp-build"), path.join(destModules, "node-gyp-build"), {
        recursive: true,
      });
    },
  },
  // uiohook-napi ships prebuilt binaries via node-gyp-build and does not need
  // to be recompiled against Electron headers. Skipping the rebuild step lets
  // node-gyp-build pick up the correct prebuilt at runtime without requiring
  // Visual Studio to be installed.
  rebuildConfig: {
    onlyModules: [],
  },
  packagerConfig: {
    name: "DocuFlow Agent",
    executableName: "docuflow-agent",
    // .node binaries cannot be dlopen'd from inside the asar archive; Electron's
    // require() transparently redirects them to app.asar.unpacked/.
    asar: { unpack: "**/*.node" },
    appBundleId: "com.docuflow.agent",
    // App icon — Forge appends the right extension per OS (.ico win32, .icns darwin, .png linux)
    icon: "./assets/icon",
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
            // Switcher entry: picks the v1 or v2 bar from the `docuflow-ui`
            // localStorage key. widget.tsx (v1) is loaded from there.
            js: "./src/renderer/widget-index.tsx",
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
