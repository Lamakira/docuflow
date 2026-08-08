/**
 * `npm run build`, and nothing else. What each output is and why it is shaped
 * the way it is lives in `script/bundles.ts`; this file is the command that
 * runs them in order. Importing it starts a build — so nothing imports it.
 */

import { build as viteBuild } from "vite";
import { rm } from "fs/promises";
import { join } from "node:path";
import { ROOT, buildMigrateRunner, buildServer } from "./bundles";

async function buildAll() {
  await rm(join(ROOT, "dist"), { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  await buildServer(join(ROOT, "dist/index.cjs"));

  console.log("building migration runner...");
  await buildMigrateRunner(join(ROOT, "dist/migrate.mjs"));
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
