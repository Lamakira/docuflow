/**
 * Feature Flags — client-side
 *
 * Single source of truth for all feature gates.
 *
 * HOW TO USE
 *   import { flags } from "@/lib/featureFlags";
 *   if (flags.screencasts) { ... }
 *
 * HOW TO CHANGE
 *   - Edit the `dev` / `prod` values below.
 *   - To force a value in all envs, set both to the same value.
 *   - To override locally without committing: set VITE_FLAG_<NAME>=true|false
 *     in your .env.local file (e.g. VITE_FLAG_SCREENCASTS=false).
 *
 * ENVIRONMENT DETECTION
 *   dev  = Vite dev server (import.meta.env.DEV === true)
 *   prod = production build (import.meta.env.PROD === true)
 *
 * FLAGS
 *   screencasts          Show the Screencasts tab and page
 *   desktopWidget        Floating always-on-top timer widget in Electron
 *   screenshotCompression  WebP compression on screenshot upload (server-side)
 */

interface FlagDef {
  dev: boolean;
  prod: boolean;
  description: string;
}

const FLAG_DEFS = {
  screencasts: {
    dev: true,
    prod: true,
    description: "Screencasts tab and page — screenshot timeline viewer",
  },
  desktopWidget: {
    dev: true,
    prod: true,
    description: "Floating always-on-top timer widget in Electron desktop agent",
  },
  screenshotCompression: {
    dev: true,
    prod: true,
    description: "Server-side WebP compression + 1920px resize on screenshot upload via sharp",
  },
} satisfies Record<string, FlagDef>;

export type FeatureFlag = keyof typeof FLAG_DEFS;

const env = import.meta.env.PROD ? "prod" : "dev";

function resolveFlag(name: FeatureFlag): boolean {
  // Per-flag env var override: VITE_FLAG_SCREENCASTS=true|false
  const envKey = `VITE_FLAG_${name.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
  const override = import.meta.env[envKey];
  if (override === "true") return true;
  if (override === "false") return false;
  return FLAG_DEFS[name][env];
}

/** Resolved flag values for the current environment. */
export const flags = Object.fromEntries(
  (Object.keys(FLAG_DEFS) as FeatureFlag[]).map((k) => [k, resolveFlag(k)])
) as Record<FeatureFlag, boolean>;

/** Type-safe check for a single flag. */
export function isEnabled(flag: FeatureFlag): boolean {
  return flags[flag];
}
