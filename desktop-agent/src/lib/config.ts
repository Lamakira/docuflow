/**
 * Runtime configuration for the Desktop Agent.
 *
 * API_BASE resolution order (first wins):
 *   1. DOCUFLOW_API_URL environment variable — a runtime override, for a
 *      developer pointing one launch somewhere else.
 *   2. ~/.docuflow-url  (plain text file — not committed, machine-local)
 *      Windows : C:\Users\<you>\.docuflow-url
 *      Linux   : /home/<you>/.docuflow-url
 *      macOS   : /Users/<you>/.docuflow-url
 *      Content: one URL per line, first line wins.
 *   3. DOCUFLOW_DEFAULT_API_URL — baked in at build time by
 *      `webpack.main.config.js`, because a packaged agent on a customer's
 *      machine has neither of the two above. This is how a release names its
 *      host, and `scripts/dist-*.js` refuse to build without it.
 *   4. LOCAL_API_URL below.
 *
 * **The committed last resort is local, and that is load-bearing (#236).** It
 * used to be a production URL, so `npm run dev:v2` on a fresh clone
 * authenticated against production, refreshed a live credential and armed
 * screen capture — which is what happened on 2026-09-18, twenty minutes before
 * a journey run. ADR-0018 forbids this repository holding a production URL at
 * all: "must never contain production credentials, production URLs, or any
 * data-plane connection to production systems". A release gets its host from
 * the build; the source tree gets one that cannot reach anyone's data.
 *
 * HOW TO POINT ONE LAUNCH SOMEWHERE ELSE:
 *   DOCUFLOW_API_URL=https://… npm run dev:v2
 *   or put the URL in ~/.docuflow-url to make it stick for this machine.
 *
 * HOW TO VERIFY THE ACTIVE URL:
 *   The first line of the log reads `API_BASE=… (source: env|file|build|default)`.
 *
 * HOW TO STOP A DEV LAUNCH (#237):
 *   Ctrl+C in the terminal that ran `npm run dev` / `dev:v2`. That used to kill
 *   only `electron-forge` and leave Electron heartbeating; `scripts/start-dev.js`
 *   now takes the process tree down with it. If the prompt returns and the
 *   agent is still alive:
 *     pkill -KILL -f desktop-agent/node_modules/electron
 */

import fs from "fs";
import path from "path";
import os from "os";

/** What a build that named no host falls back to. Reaches only this machine. */
const LOCAL_API_URL = "http://localhost:5000";

/**
 * Read as a **static member expression**, and that is the whole trick:
 * `webpack.DefinePlugin` substitutes this exact text at build time, so it can
 * only be written this way. Destructuring it, or reaching it through a variable
 * holding `process.env`, leaves the lookup intact and the baked value is never
 * seen. Same constraint, same reason, as `DOCUFLOW_COMMIT` in `server/buildInfo.ts`.
 */
const BUILD_API_URL: string = process.env.DOCUFLOW_DEFAULT_API_URL ?? "";

export type ApiBaseSource = "env" | "file" | "build" | "default";

/**
 * Takes its environment rather than reading the global one, so the order above
 * is a testable claim instead of a comment (`tests/smoke/agent-api-base.test.ts`).
 */
export function resolveApiBase(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): { url: string; source: ApiBaseSource } {
  const trim = (url: string) => url.replace(/\/+$/, "");

  // 1. Runtime override.
  if (env.DOCUFLOW_API_URL) {
    return { url: trim(env.DOCUFLOW_API_URL), source: "env" };
  }

  // 2. Override file: ~/.docuflow-url (not committed — machine-local).
  try {
    const overridePath = path.join(homedir, ".docuflow-url");
    if (fs.existsSync(overridePath)) {
      const url = fs
        .readFileSync(overridePath, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("http"));
      if (url) return { url: trim(url), source: "file" };
    }
  } catch {
    /* ignore */
  }

  // 3. Baked at build time — how a packaged release names its host. The
  //    parameter is for the tests; the constant is what a real build carries.
  const baked = env.DOCUFLOW_DEFAULT_API_URL ?? BUILD_API_URL;
  if (baked) return { url: trim(baked), source: "build" };

  // 4. Local. Never production: see the note above and ADR-0018.
  return { url: LOCAL_API_URL, source: "default" };
}

const resolved = resolveApiBase();
export const API_BASE: string = resolved.url;
export const API_BASE_SOURCE: ApiBaseSource = resolved.source;

/** Host only, for display. Falls back to the whole string if it will not parse. */
export function apiHost(): string {
  try {
    return new URL(API_BASE).hostname;
  } catch {
    return API_BASE;
  }
}

export const API_HOST: string = apiHost();
