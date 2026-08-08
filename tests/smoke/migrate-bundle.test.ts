import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMigrateRunner } from "../../script/bundles";
import { loadMigrations } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";
import { resolveTestDatabaseUrl } from "../test-db-url";

/**
 * The migration runner as the image runs it (#35).
 *
 * `tests/smoke/migrations.test.ts` checks the journal and the runner as a
 * module. What it cannot see is the second thing #35 built: the same runner
 * bundled to `dist/migrate.mjs` and executed with no checkout around it, which
 * is how ADR-0016's gated pre-deploy step reaches a database on Render.
 *
 * Three things break silently in that form, and none of them break in the
 * module:
 *
 *  - `format: "cjs"` empties `import.meta`, so the runner would resolve the
 *    journal against the wrong directory and never recognise itself as the
 *    command it was invoked as. esbuild warns; a warning is not a failure.
 *  - `migrations/` missing from the image, or landing anywhere other than
 *    beside `dist/`, which the runner resolves relative to itself.
 *  - a flag lost in the move. `--baseline` especially: it is what a database
 *    predating the journal needs, and Phase 2 points this at exactly such a
 *    database, once, with no second chance to notice the flag was inert.
 *
 * So the bundle is built from `script/bundles.ts` — the same function the image
 * build calls, not a second copy of its configuration — laid out the way the
 * runtime stage lays it out, and run as a command.
 *
 * **What this stages is not the image.** `stagedApp` symlinks the checkout's
 * `node_modules`, where the runtime stage installs `npm ci --omit=dev`, so a
 * bundle that reached for a devDependency would resolve here and fail there.
 * "imports nothing the runtime image would not have" is what covers that, off
 * the build's own metafile rather than off what happened to resolve. Building
 * and running the real image is `.github/workflows/ci.yml`'s `image` job.
 */

const REPO = join(import.meta.dirname, "..", "..");
const TEST_DB_URL = resolveTestDatabaseUrl();

/** Recreated per test: every case here wants a database with no history. */
const PROBE_DB = "docuflow_migrate_bundle";

/**
 * /app as the runtime stage builds it: the bundle under `dist/`, the journal
 * beside it, and a dependency tree the bundle's externals resolve from. No
 * source, no package.json, no tsx.
 */
let stagedApp: string;

/** What the build left for node_modules to answer, from its metafile. */
let externalImports: string[];

function bundlePath(): string {
  return join(stagedApp, "dist", "migrate.mjs");
}

/**
 * Invoke the bundle the way `docker run <image> node dist/migrate.mjs …` does.
 *
 * The environment is DATABASE_URL and PATH and nothing else, which is half the
 * point: `scripts/lib/db.ts` keeps these scripts clear of `server/config.ts` so
 * that a migration is not blocked by an object-storage variable it will never
 * read, and the bundled copy has to inherit that (ADR-0016).
 */
function runMigrate(url: string, ...args: string[]): string {
  return execFileSync(process.execPath, [bundlePath(), ...args], {
    cwd: stagedApp,
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: url },
    encoding: "utf8",
  });
}

/** Does `table` exist? Used for the ledger and for the schema itself. */
async function tableExists(url: string, table: string): Promise<boolean> {
  const { rows } = await withClient(url, (client) =>
    client.query<{ present: boolean }>(
      `SELECT to_regclass('public.${table}') IS NOT NULL AS present`
    )
  );
  return rows[0].present;
}

async function freshProbe(): Promise<string> {
  await withClient(urlForDatabase("postgres"), async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`);
    await client.query(`CREATE DATABASE ${PROBE_DB}`);
  });
  return urlForDatabase(PROBE_DB);
}

describe("dist/migrate.mjs", () => {
  beforeAll(async () => {
    stagedApp = mkdtempSync(join(tmpdir(), "docuflow-staged-app-"));
    mkdirSync(join(stagedApp, "dist"));
    cpSync(join(REPO, "migrations"), join(stagedApp, "migrations"), { recursive: true });
    // The image installs its own, without the devDependency half; a symlink is
    // the cheap stand-in for resolution, and the test below is what makes the
    // difference between the two trees visible rather than lucky.
    symlinkSync(join(REPO, "node_modules"), join(stagedApp, "node_modules"), "dir");

    const built = await buildMigrateRunner(bundlePath());
    const [output] = Object.values(built.metafile.outputs);
    externalImports = output.imports.filter((i) => i.external).map((i) => i.path);
  }, 60_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`)
    );
    rmSync(stagedApp, { recursive: true, force: true });
  });

  it("imports nothing the runtime image would not have", () => {
    // The runtime stage installs `npm ci --omit=dev`, so every bare specifier
    // the bundle left external has to be a `dependencies` entry or a builtin.
    // A devDependency would resolve against the symlinked checkout above and
    // then crash the pre-deploy step on a host with no second chance — and it
    // is the one failure mode staging /app in a tmpdir cannot reproduce.
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    const runtimeDeps = new Set(Object.keys(pkg.dependencies ?? {}));

    const notInstalled = externalImports.filter((specifier) => {
      if (isBuiltin(specifier)) return false;
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      return !runtimeDeps.has(name);
    });

    expect(notInstalled).toEqual([]);
  });

  it("lists the journal against a real database", () => {
    // The suite's own database, already migrated by tests/global-setup.ts
    // through the module. The bundle reading it back as applied is the two
    // forms agreeing about one journal.
    const listed = runMigrate(TEST_DB_URL, "--status");

    for (const migration of loadMigrations()) {
      expect(listed).toContain(`applied  ${migration.version}`);
    }
  });

  it("applies the journal, and finds nothing pending on a second run", async () => {
    const probe = await freshProbe();

    const first = runMigrate(probe);
    expect(first).toContain("applied 0000_fair_amazoness in");
    expect(first).toContain("applied 0004_time_entries_task_id_index in");

    // The SQL really ran, out of the copied journal rather than a checkout.
    expect(await tableExists(probe, "users")).toBe(true);

    const second = runMigrate(probe);
    expect(second.trim()).toBe("no pending migrations");
  }, 120_000);

  it("changes nothing under --dry-run, including the ledger", async () => {
    const probe = await freshProbe();

    const planned = runMigrate(probe, "--dry-run");

    expect(planned).toContain("would apply 0000_fair_amazoness");
    expect(await tableExists(probe, "schema_migrations")).toBe(false);
    expect(await tableExists(probe, "users")).toBe(false);
  }, 60_000);

  it("records a baseline without running what it records", async () => {
    // Baselining through the last version is the artificial case — a real
    // cutover baselines through the version the database already contains, and
    // `tests/smoke/migrations.test.ts` covers that against a schema built by
    // `drizzle-kit push`. What is being pinned here is narrower and is the part
    // the bundle could lose: the flag parses, and what it names is recorded
    // rather than run.
    const journal = loadMigrations();
    const last = journal[journal.length - 1];
    const probe = await freshProbe();

    const output = runMigrate(probe, "--baseline", last.version);

    expect(output).toContain(`baselined ${last.version} (recorded, not run)`);
    expect(output).toContain("no pending migrations");

    const ledger = await withClient(probe, (client) =>
      client.query<{ version: string; baselined: boolean }>(
        `SELECT version, baselined FROM schema_migrations ORDER BY version`
      )
    );
    expect(ledger.rows).toEqual(
      journal.map((migration) => ({ version: migration.version, baselined: true }))
    );
    // Recorded, not run: none of the tables those migrations create are here.
    expect(await tableExists(probe, "users")).toBe(false);
  }, 60_000);
});
