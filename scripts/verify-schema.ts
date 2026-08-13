/**
 * verify-schema.ts — does a real database contain exactly what the journal says?
 *
 *   npm run db:verify                                  audit the configured database
 *   npm run db:verify -- --against "$PROD_URL"         audit another one
 *   npm run db:verify -- --against "$PROD_URL" --reference "$LOCAL_URL"
 *
 * #24 exists because two `embedding vector(1536)` columns were applied to
 * production out of band: `server/embeddings.ts` required them, no migration
 * created them, and nothing noticed for as long as the only databases anyone
 * compared were built from the same repository. `tests/smoke/migrations.test.ts`
 * cannot catch that class of fault — it diffs the journal against
 * `shared/schema.ts`, and a column that exists only in production is in neither.
 * This command is the missing half: it diffs the journal against a database.
 *
 * How it works. A throwaway database is created on the *reference* server and
 * built by running the journal into it; the audited database is only read from.
 * That split is the safety property — point `--against` at production and this
 * command still creates nothing there, drops nothing there, and writes nothing
 * there. The reference server defaults to whatever `DATABASE_URL` / `PG*`
 * resolve to, which under ADR-0018 is a local container or a development branch.
 *
 * What it reports. A column, index, or constraint the database has and the
 * journal does not was applied out of band — the fault this command exists for.
 * One the journal has and the database does not is a migration never applied.
 * Exit code 1 on either, so it can gate a deploy (ADR-0016).
 */

import pg from "pg";
import { maskDatabaseUrl, requireDatabaseUrl } from "../shared/databaseUrl";
import { flagValue } from "./lib/args";
import { isEntryPoint } from "./lib/entrypoint";
import { describeSchema, diffSchemas, formatDifferences, type SchemaDifference } from "./lib/schemaSnapshot";
import { migrate } from "./migrate";

/** Created and dropped on the reference server, once per run. */
const REFERENCE_DB = "docuflow_schema_reference";

/** The database every server has; where `CREATE DATABASE` must be issued from. */
const ADMIN_DB = "postgres";

function urlForDatabase(url: string, name: string): string {
  const target = new URL(url);
  target.pathname = `/${name}`;
  return target.toString();
}

function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

async function withClient<T>(url: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

interface Options {
  against: string;
  reference: string;
}

function parseArgs(argv: string[]): Options {
  const valueOf = (flag: string) => flagValue(argv, flag, "a database URL");

  // Both default to the configured database: bare `db:verify` audits your own,
  // building the reference alongside it.
  return {
    against: valueOf("--against") ?? requireDatabaseUrl(),
    reference: valueOf("--reference") ?? requireDatabaseUrl(),
  };
}

/**
 * Build the reference: a database holding exactly what the journal produces from
 * empty, and nothing else. Dropped and recreated each run so a half-finished
 * previous run cannot be mistaken for the journal's output.
 */
async function buildReference(referenceServerUrl: string, report: (message: string) => void): Promise<string> {
  const adminUrl = urlForDatabase(referenceServerUrl, ADMIN_DB);
  const referenceUrl = urlForDatabase(referenceServerUrl, REFERENCE_DB);

  await withClient(adminUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${REFERENCE_DB}`);
    await client.query(`CREATE DATABASE ${REFERENCE_DB}`);
  });

  const ran = await migrate(referenceUrl);
  report(`reference built: ${ran.length} migrations applied`);
  return referenceUrl;
}

async function dropReference(referenceServerUrl: string): Promise<void> {
  await withClient(urlForDatabase(referenceServerUrl, ADMIN_DB), (client) =>
    client.query(`DROP DATABASE IF EXISTS ${REFERENCE_DB}`)
  );
}

export async function verifySchema(
  options: Options,
  report: (message: string) => void = () => {}
): Promise<SchemaDifference[]> {
  if (databaseNameOf(options.against) === REFERENCE_DB) {
    throw new Error(
      `Refusing to audit "${REFERENCE_DB}" — that is the name this command creates ` +
        `and drops on the reference server. Point --against at the database you mean.`
    );
  }

  report(`auditing  ${maskDatabaseUrl(options.against)}`);
  report(`reference ${maskDatabaseUrl(urlForDatabase(options.reference, REFERENCE_DB))}`);

  // Read the audited database first: if it is unreachable, say so before
  // spending a migration run building something to compare it against.
  const subject = await withClient(options.against, describeSchema);

  const referenceUrl = await buildReference(options.reference, report);
  try {
    const reference = await withClient(referenceUrl, describeSchema);
    return diffSchemas(reference, subject);
  } finally {
    await dropReference(options.reference);
  }
}

if (isEntryPoint(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));

  verifySchema(options, (message) => console.log(message))
    .then((differences) => {
      if (differences.length === 0) {
        console.log("\nSchema matches the journal exactly.");
        return;
      }
      console.error(`\n${differences.length} difference(s) between this database and the journal:\n`);
      console.error(formatDifferences(differences));
      console.error(
        `\nEXTRA means DDL reached this database outside the journal — add a migration ` +
          `that declares it, then baseline or apply as appropriate.\n` +
          `MISSING means a migration was never applied here: run \`npm run db:migrate\`.`
      );
      process.exit(1);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
