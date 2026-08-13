/**
 * snapshot-rehearsal.ts — the two checks a restored snapshot has to pass.
 *
 *   npm run snapshot:check                       report, change nothing
 *   npm run snapshot:check -- --keys manifest    also verify keys resolve
 *   npm run snapshot:scrub                       apply the rewrites, then re-check
 *   npm run snapshot:check -- --against "$URL"   a database other than the configured one
 *
 * ADR-0018 lets production data into this environment only as a restored
 * snapshot, and ADR-0022 — unchanged by ADR-0023's provider swap — names what
 * must be true of one before it is used:
 *
 *   1. No absolute production storage URL survives in the database. A restored
 *      row pointing at production storage re-creates the connection ADR-0018
 *      forbids, as data, with no credential involved. `downloadRoutes.ts`
 *      redirects clients straight at `desktop_releases.storage_url`.
 *   2. Every storage key the database names resolves in the destination bucket.
 *      Objects the bucket holds that the database does not name are expected —
 *      they postdate the export. The reverse is a failure.
 *
 * ADR-0023 made the destination Google-backed, which is why the scan cannot key
 * on the host: a production URL and one of ours share `storage.googleapis.com`
 * and only the bucket name separates them. So "ours" is read from the
 * object-storage roots this environment is configured with, and the scan itself
 * is driven by `information_schema` rather than a list of tables — a column
 * nobody thought of is the failure this exists to catch.
 *
 * The scan is a check across every column that can hold a URL; the scrub is a
 * fix only where a decision has been recorded. A finding in a column no rule
 * covers fails the run rather than being rewritten on a guess, and nothing is
 * written until every finding is covered.
 *
 * One query per candidate column, which is slow on a large database and fine
 * for an operator command that runs once per rehearsal.
 */

import type { Client } from "pg";
import pg from "pg";
import { maskDatabaseUrl, requireDatabaseUrl } from "../shared/databaseUrl";
import { isEntryPoint } from "./lib/entrypoint";
import type { Report } from "./lib/db";

/** Absolute storage references, in both forms the repository has ever written. */
const STORAGE_URL = /(?:https:\/\/storage\.googleapis\.com\/|gs:\/\/)[^\s"'<>)\\]+/g;

/** Column types a URL can hide in. `json` is included; the schema uses `jsonb`. */
const SCANNED_TYPES = ["text", "character varying", "jsonb", "json"];

/** Not application data: the runner's own ledger. */
const SKIPPED_TABLES = ["schema_migrations"];

export interface StorageUrlFinding {
  table: string;
  column: string;
  /** Rows holding at least one foreign storage URL. */
  rows: number;
  /** The first one found, so the operator can see what they are dealing with. */
  sample: string;
  /** The rule that covers this column, or `undeclared` when none does. */
  scrub: string;
}

/** The bucket an absolute storage reference names, or nothing if it names none. */
function bucketOf(url: string): string | undefined {
  const rest = url.startsWith("gs://")
    ? url.slice("gs://".length)
    : url.slice("https://storage.googleapis.com/".length);
  const bucket = rest.split("/")[0];
  return bucket.length > 0 ? bucket : undefined;
}

/**
 * Every absolute storage reference in a value that points at a bucket other than
 * this environment's. Text rather than a URL column on purpose: the same URL
 * turns up inside JSON, inside markdown, and inside a `text` column holding a
 * serialized attachment list.
 */
export function foreignStorageUrls(value: string, ownBuckets: string[]): string[] {
  const found = value.match(STORAGE_URL) ?? [];
  return found.filter((url) => {
    const bucket = bucketOf(url);
    return bucket !== undefined && !ownBuckets.includes(bucket);
  });
}

/**
 * The buckets this environment writes to, read from the object-storage roots it
 * is already configured with (`/bucket/prefix`). Deliberately not a variable of
 * its own: a second place to name the bucket is a second place to get it wrong,
 * and the roots are what the application actually resolves against.
 */
export function ownBucketsOf(env: Record<string, string | undefined>): string[] {
  const roots = [
    env.PRIVATE_OBJECT_DIR ?? "",
    ...(env.PUBLIC_OBJECT_SEARCH_PATHS ?? "").split(","),
  ];
  const buckets = roots
    .map((root) => root.trim().replace(/^\//, "").split("/")[0])
    .filter((bucket) => bucket.length > 0);
  return Array.from(new Set(buckets));
}

/** The prefix beneath the bucket that `PRIVATE_OBJECT_DIR` names, without slashes. */
function privatePrefixOf(privateDir: string): string {
  return privateDir.replace(/^\//, "").split("/").slice(1).join("/");
}

/**
 * The name the bucket holds an object under, from whatever form the database
 * stores. `normalizeObjectEntityPath` reduces an upload to `/objects/{entityId}`
 * beneath `PRIVATE_OBJECT_DIR`, so that prefix has to go back on before a key
 * can be compared against a listing. A screenshot's `storage_key` is already an
 * object name and passes through.
 */
export function toObjectName(value: string, privateDir: string): string {
  const absolute = value.match(STORAGE_URL)?.[0];
  if (absolute === value) {
    const rest = value.startsWith("gs://")
      ? value.slice("gs://".length)
      : value.slice("https://storage.googleapis.com/".length);
    return rest.split("/").slice(1).join("/");
  }

  if (value.startsWith("/objects/")) {
    const entityId = value.slice("/objects/".length);
    const prefix = privatePrefixOf(privateDir);
    return prefix ? `${prefix}/${entityId}` : entityId;
  }

  return value.replace(/^\//, "");
}

/** Columns holding a storage key rather than a URL — the keys a copy must carry. */
const KEY_SOURCES = [
  { table: "time_entry_screenshots", column: "storage_key" },
  { table: "company_documents", column: "storage_path" },
];

/**
 * A column whose foreign URLs have a recorded answer, and what that answer is.
 * There is one, because ADR-0022 settled one. Every other column is
 * `undeclared` until somebody decides what the rehearsed environment should
 * hold instead — which is a decision, not a default.
 */
interface ScrubRule {
  table: string;
  column: string;
  /** Shown in the report, so the run says what it did and why. */
  label: string;
  apply(client: Client, ownBuckets: string[]): Promise<number>;
}

const SCRUB_RULES: ScrubRule[] = [
  {
    table: "desktop_releases",
    column: "storage_url",
    label: "→ /downloads/{platform}",
    /**
     * The installers this environment serves are its own build artifacts, so a
     * restored production row is repointed at the local path `downloadRoutes.ts`
     * already understands. Until this environment has built an installer, that
     * path reports the platform unavailable, which is the honest state (#60).
     */
    async apply(client, ownBuckets) {
      const { rows } = await client.query<{ id: string; platform: string; storage_url: string }>(
        `SELECT id, platform, storage_url FROM desktop_releases WHERE storage_url IS NOT NULL`
      );
      const foreign = rows.filter((row) => foreignStorageUrls(row.storage_url, ownBuckets).length > 0);
      for (const row of foreign) {
        await client.query(`UPDATE desktop_releases SET storage_url = $1 WHERE id = $2`, [
          `/downloads/${row.platform}`,
          row.id,
        ]);
      }
      return foreign.length;
    },
  },
];

function ruleFor(table: string, column: string): ScrubRule | undefined {
  return SCRUB_RULES.find((rule) => rule.table === table && rule.column === column);
}

/** Every column in the public schema a URL could be stored in. */
async function scannableColumns(client: Client): Promise<{ table: string; column: string }[]> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.data_type = ANY($1)
        AND c.table_name <> ALL($2)
      ORDER BY c.table_name, c.column_name`,
    [SCANNED_TYPES, SKIPPED_TABLES]
  );
  return rows.map((row) => ({ table: row.table_name, column: row.column_name }));
}

/** What the restored database still says about storage that is not ours. */
export async function scanStorageUrls(
  client: Client,
  ownBuckets: string[]
): Promise<StorageUrlFinding[]> {
  const findings: StorageUrlFinding[] = [];

  for (const { table, column } of await scannableColumns(client)) {
    const { rows } = await client.query<{ value: string }>(
      `SELECT "${column}"::text AS value FROM "${table}"
        WHERE "${column}"::text LIKE '%storage.googleapis.com/%'
           OR "${column}"::text LIKE '%gs://%'`
    );

    const hits = rows
      .map((row) => foreignStorageUrls(row.value, ownBuckets))
      .filter((urls) => urls.length > 0);
    if (hits.length === 0) continue;

    findings.push({
      table,
      column,
      rows: hits.length,
      sample: hits[0][0],
      scrub: ruleFor(table, column)?.label ?? "undeclared",
    });
  }

  return findings;
}

/**
 * Apply the recorded rewrites — but only once every finding has one. A column
 * nobody has decided about stops the run with the database untouched, because
 * guessing at it is the failure mode this whole check exists for.
 */
export async function scrubStorageUrls(
  client: Client,
  ownBuckets: string[],
  report: Report = () => {}
): Promise<StorageUrlFinding[]> {
  const findings = await scanStorageUrls(client, ownBuckets);

  const undeclared = findings.filter((finding) => finding.scrub === "undeclared");
  if (undeclared.length > 0) {
    throw new Error(
      `Refusing to scrub: ${undeclared.length} column(s) hold a foreign storage URL and no ` +
        `rule covers them.\n` +
        undeclared
          .map((finding) => `  - ${finding.table}.${finding.column} (${finding.rows} row(s)): ${finding.sample}`)
          .join("\n") +
        `\nDecide what this environment should hold instead, add the rule to ` +
        `SCRUB_RULES in scripts/snapshot-rehearsal.ts, and run again. ` +
        `Nothing was written.`
    );
  }

  for (const finding of findings) {
    const rule = ruleFor(finding.table, finding.column)!;
    const changed = await rule.apply(client, ownBuckets);
    report(`scrubbed ${finding.table}.${finding.column}: ${changed} row(s) ${rule.label}`);
  }

  return findings;
}

/** Every object name the restored database expects the bucket to hold. */
export async function namedStorageKeys(client: Client, privateDir: string): Promise<string[]> {
  const keys = new Set<string>();

  for (const { table, column } of KEY_SOURCES) {
    const { rows } = await client.query<{ value: string }>(
      `SELECT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`
    );
    for (const row of rows) {
      const name = toObjectName(row.value, privateDir);
      if (name.length > 0) keys.add(name);
    }
  }

  return Array.from(keys);
}

/**
 * Keys the database names that the destination does not hold. The other
 * direction is not a fault: the object copy is taken at or after its paired
 * database export, so the bucket is a superset by construction (ADR-0022).
 */
export function findDanglingKeys(named: string[], destination: Iterable<string>): string[] {
  const held = new Set(destination);
  return Array.from(new Set(named)).filter((key) => !held.has(key));
}

/** The operator's copy manifest: one object name per line, `#` comments allowed. */
export function readManifestKeys(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * ADR-0021 places Replit development environments outside the published
 * geography, so a restored production snapshot may not be loaded into one —
 * a residency rule, not only an isolation one. `REPLIT_DEV_DOMAIN` is the
 * variable Replit documents for the workspace's own URL, so its presence is the
 * signal that this process is in the workspace rather than the published app.
 *
 * It is a heuristic, and the override exists for the case it gets wrong: set
 * `ALLOW_DEVELOPMENT_REHEARSAL=1` only for a database holding synthetic data.
 */
export function assertRehearsalTarget(env: Record<string, string | undefined>): void {
  if (env.REPLIT_DEV_DOMAIN && env.ALLOW_DEVELOPMENT_REHEARSAL !== "1") {
    throw new Error(
      `Refusing to run in a Replit development workspace. ADR-0021 places development ` +
        `environments outside the published geography, so a restored production snapshot ` +
        `may not be loaded into one — rehearsal runs against a database in the published ` +
        `environment. Set ALLOW_DEVELOPMENT_REHEARSAL=1 only for synthetic data.`
    );
  }
}

interface Options {
  against: string;
  scrub: boolean;
  keys?: string;
}

function parseArgs(argv: string[]): Options {
  const valueOf = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    if (at === -1) return undefined;
    const value = argv[at + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    return value;
  };

  return {
    against: valueOf("--against") ?? requireDatabaseUrl(),
    scrub: argv.includes("--scrub"),
    keys: valueOf("--keys"),
  };
}

async function main(options: Options): Promise<number> {
  assertRehearsalTarget(process.env);

  const ownBuckets = ownBucketsOf(process.env);
  if (ownBuckets.length === 0) {
    throw new Error(
      `No object-storage roots configured. PRIVATE_OBJECT_DIR and ` +
        `PUBLIC_OBJECT_SEARCH_PATHS name this environment's buckets, and without them ` +
        `every storage URL in the database looks foreign.`
    );
  }

  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  console.log(`rehearsing ${maskDatabaseUrl(options.against)}`);
  console.log(`this environment's buckets: ${ownBuckets.join(", ")}`);

  const client = new pg.Client({ connectionString: options.against });
  await client.connect();
  try {
    if (options.scrub) {
      await scrubStorageUrls(client, ownBuckets, (message) => console.log(message));
    }

    const findings = await scanStorageUrls(client, ownBuckets);
    if (findings.length === 0) {
      console.log("storage URLs: clean — no absolute reference to a bucket that is not ours");
    } else {
      console.error(`\nstorage URLs: ${findings.length} column(s) still hold a foreign reference:`);
      for (const finding of findings) {
        console.error(`  - ${finding.table}.${finding.column} (${finding.rows} row(s)) ${finding.scrub}: ${finding.sample}`);
      }
      console.error(options.scrub ? "" : "Run `npm run snapshot:scrub` to apply the recorded rewrites.");
    }

    const named = await namedStorageKeys(client, privateDir);
    console.log(`storage keys: ${named.length} named by the database`);

    let dangling: string[] = [];
    if (options.keys) {
      const { readFile } = await import("node:fs/promises");
      const destination = readManifestKeys(await readFile(options.keys, "utf8"));
      dangling = findDanglingKeys(named, destination);
      console.log(`              ${destination.length} held by the destination`);
      if (dangling.length === 0) {
        console.log("              every key the database names resolves");
      } else {
        console.error(`\n${dangling.length} key(s) the database names are not in the destination:`);
        for (const key of dangling.slice(0, 20)) console.error(`  - ${key}`);
        if (dangling.length > 20) console.error(`  … and ${dangling.length - 20} more`);
      }
    } else {
      console.log("              no --keys manifest given; keys were not verified");
    }

    return findings.length === 0 && dangling.length === 0 ? 0 : 1;
  } finally {
    await client.end();
  }
}

if (isEntryPoint(import.meta.url)) {
  main(parseArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
