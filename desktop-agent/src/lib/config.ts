/**
 * Runtime configuration for the Desktop Agent.
 *
 * API_BASE resolution order (first wins):
 *   1. DOCUFLOW_API_URL environment variable
 *   2. ~/.docuflow-url  (plain text file — not committed, machine-local)
 *      Windows : C:\Users\<you>\.docuflow-url
 *      Linux   : /home/<you>/.docuflow-url
 *      macOS   : /Users/<you>/.docuflow-url
 *      Content: one URL per line, first line wins. Example:
 *        https://685f78d0-eb71-48b3-ad3d-cfc7079d359b-00-1ew2ty1yeevg0.spock.replit.dev  ← DEV
 *        # https://techma-doc--masdouk1.replit.app  ← PROD (commented)
 *   3. DEFAULT_API_URL baked in at build time (PROD)
 *
 * HOW TO SWITCH DEV ↔ PROD:
 *   DEV  → put dev URL in ~/.docuflow-url (or delete the prod line)
 *   PROD → delete ~/.docuflow-url  OR  replace its content with prod URL
 *
 * HOW TO VERIFY ACTIVE URL:
 *   Check %APPDATA%\docuflow-desktop-agent\debug.log — first line on startup
 *   shows "API_BASE=... (source: ...)"
 */

import fs from "fs";
import path from "path";
import os from "os";

const DEFAULT_API_URL = "https://techma-doc--masdouk1.replit.app";

export type ApiBaseSource = "env" | "file" | "default";

function resolveApiBase(): { url: string; source: ApiBaseSource } {
  // 1. Environment variable
  if (process.env.DOCUFLOW_API_URL) {
    return { url: process.env.DOCUFLOW_API_URL.replace(/\/+$/, ""), source: "env" };
  }

  // 2. Override file: ~/.docuflow-url (not committed — machine-local)
  try {
    const overridePath = path.join(os.homedir(), ".docuflow-url");
    if (fs.existsSync(overridePath)) {
      const url = fs.readFileSync(overridePath, "utf-8")
        .split("\n")
        .map(l => l.trim())
        .find(l => l.startsWith("http"));
      if (url) {
        const cleaned = url.replace(/\/+$/, "");
        // If the file points to the same URL as the default (prod), treat it as default
        // so the DEV/PROD badge reflects the actual environment, not the source.
        const source: ApiBaseSource = cleaned === DEFAULT_API_URL.replace(/\/+$/, "") ? "default" : "file";
        return { url: cleaned, source };
      }
    }
  } catch { /* ignore */ }

  // 3. Build-time default (PROD)
  return { url: DEFAULT_API_URL.replace(/\/+$/, ""), source: "default" };
}

const resolved = resolveApiBase();
export const API_BASE: string = resolved.url;
export const API_BASE_SOURCE: ApiBaseSource = resolved.source;

/** Human-readable hostname for display in the UI. */
export const API_HOST: string = (() => {
  try {
    return new URL(API_BASE).hostname;
  } catch {
    return API_BASE;
  }
})();
