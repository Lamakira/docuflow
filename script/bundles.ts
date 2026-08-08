/**
 * What `npm run build` produces, as functions rather than a command.
 *
 * Split out of `script/build.ts` so that importing a bundle's configuration
 * cannot start a build. `script/build.ts` used to be both, guarded by an
 * `isEntryPoint` check — which meant a checkout where `process.argv[1]` failed
 * to realpath-match its own module exited 0 having built nothing, and CI's
 * build step passed. There is no guard to get wrong now: this module only
 * defines, and `script/build.ts` only runs.
 */

import { build as esbuild } from "esbuild";
import { readFile } from "fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
//
// A library an OpenTelemetry instrumentation patches must NOT be listed here
// (#26). Patching happens when the module is required, and a bundled module is
// never required — inlining express here is what silently removed route spans
// and `http.route` from every HTTP metric, with the SDK reporting nothing wrong.
// `express` and `pg` are therefore external on purpose; so is every
// `@opentelemetry/*` package, by not being listed. See server/telemetry.ts.
const allowlist = [
  "@google/generative-ai",
  "@neondatabase/serverless",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

/** Everything outside the allowlist, resolved from node_modules at runtime. */
export async function externalDependencies(): Promise<string[]> {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  return allDeps.filter((dep) => !allowlist.includes(dep));
}

/**
 * The server, as the image's default CMD runs it.
 *
 * `metafile` so a caller can ask what the bundle left for node_modules to
 * answer. That list is what `dependencies` has to hold and the reason the
 * client's half of the tree may leave it (#36) — derived from the build rather
 * than read off the manifest, because a package moved wrongly does not fail the
 * build, it fails the first request that needed it. See
 * `tests/smoke/server-bundle.test.ts`.
 */
export async function buildServer(outfile: string) {
  return esbuild({
    entryPoints: [join(ROOT, "server/index.ts")],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: await externalDependencies(),
    metafile: true,
    logLevel: "info",
  });
}

/**
 * The migration runner, as a second entry point into the same image (#35).
 *
 * ADR-0016 runs migrations as a gated pre-deploy step, which on Render means a
 * command run against the deployed image — and `npm run db:migrate` is `tsx`,
 * a devDependency the runtime stage deliberately does not install. So the
 * runner is built too, and the image gets a second way to run the one journal.
 *
 * **ESM, not CJS.** `scripts/migrate.ts` finds the journal with
 * `dirname(fileURLToPath(import.meta.url))` and decides whether it was invoked
 * with `isEntryPoint(import.meta.url)`. esbuild's `cjs` format leaves
 * `import.meta` an empty object — it warns, and then the runner looks for
 * `migrations/` in the wrong place and never recognises itself as the command.
 *
 * Not minified, unlike the server: this one is read by an operator during a
 * deploy that has just gone wrong, and its stack traces should name something.
 * It is ~7 KB in an image of ~1.1 GB.
 *
 * `metafile` so a caller can ask what the bundle left external, which is the
 * one thing about it the runtime image can disagree with — see
 * `tests/smoke/migrate-bundle.test.ts`.
 */
export async function buildMigrateRunner(outfile: string) {
  return esbuild({
    entryPoints: [join(ROOT, "scripts/migrate.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile,
    external: await externalDependencies(),
    metafile: true,
    logLevel: "info",
  });
}
