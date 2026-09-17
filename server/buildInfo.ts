/**
 * Which build is answering (#229).
 *
 * The Phase 8 Stripe run spent its longest stretch talking to a server started
 * four hours before the commit under test. `/health` answered
 * `200 {"status":"ok"}` exactly as a current one would, and the routes that
 * build did not have fell through to the Vite catch-all — which reads as "no
 * such route", not as "wrong build". Liveness was reported; identity was not.
 *
 * Resolution is deliberately offline and synchronous. A deploy sets
 * `DOCUFLOW_COMMIT`; a developer machine has `.git` and no such variable, which
 * is the case that actually bit. Neither is fatal: an unknown commit is
 * reported as unknown rather than guessed, because a wrong sha is worse than
 * no sha.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type BuildIdentitySource = "env" | "git" | "unknown";

export type BuildIdentity = {
  /** Short commit sha, or `"unknown"`. */
  commit: string;
  source: BuildIdentitySource;
};

const SHORT_SHA_LENGTH = 8;

/** The instant this process loaded, not the instant of the request. */
export const PROCESS_STARTED_AT = new Date();

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text.length > 0 ? text : undefined;
}

/**
 * Read the checked-out commit without spawning `git`. `.git/HEAD` either holds
 * a sha outright (detached) or points at a ref file that does.
 */
export function readGitHeadSha(root = process.cwd()): string | null {
  try {
    const head = readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head || null;
    const ref = head.slice("ref:".length).trim();
    return readFileSync(join(root, ".git", ref), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function resolveBuildIdentity(options: {
  env: Record<string, string | undefined>;
  readGitHead: () => string | null;
}): BuildIdentity {
  const injected = trimmed(options.env.DOCUFLOW_COMMIT);
  if (injected) {
    return { commit: injected.slice(0, SHORT_SHA_LENGTH), source: "env" };
  }

  const head = trimmed(options.readGitHead() ?? undefined);
  if (head) {
    return { commit: head.slice(0, SHORT_SHA_LENGTH), source: "git" };
  }

  return { commit: "unknown", source: "unknown" };
}

let resolved: BuildIdentity | null = null;

/** Resolved once per process; the answer cannot change while it runs. */
export function buildIdentity(): BuildIdentity {
  resolved ??= resolveBuildIdentity({
    // Written as a static member expression on purpose: `script/bundles.ts`
    // replaces exactly this text with the build's sha, and a dynamic lookup
    // through `process.env` would miss it. The production bundle ships without
    // `.git`, so this is the only thing it has to go on. Same trick, and same
    // reason, as `process.env.NODE_ENV` in `server/config.ts`.
    env: { DOCUFLOW_COMMIT: process.env.DOCUFLOW_COMMIT },
    readGitHead: () => readGitHeadSha(),
  });
  return resolved;
}
