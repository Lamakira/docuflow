import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "../scripts/lib/entrypoint";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
async function externalDependencies(): Promise<string[]> {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  return allDeps.filter((dep) => !allowlist.includes(dep));
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
 * Exported so `tests/smoke/migrate-bundle.test.ts` builds the bundle it checks
 * from this exact configuration rather than a second copy that could drift.
 */
export async function buildMigrateRunner(outfile: string): Promise<void> {
  await esbuild({
    entryPoints: [join(ROOT, "scripts/migrate.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile,
    external: await externalDependencies(),
    logLevel: "info",
  });
}

async function buildAll() {
  await rm(join(ROOT, "dist"), { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  await esbuild({
    entryPoints: [join(ROOT, "server/index.ts")],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: join(ROOT, "dist/index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: await externalDependencies(),
    logLevel: "info",
  });

  console.log("building migration runner...");
  await buildMigrateRunner(join(ROOT, "dist/migrate.mjs"));
}

// Only when run as a command: importing this module must not start a build.
if (isEntryPoint(import.meta.url)) {
  buildAll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
