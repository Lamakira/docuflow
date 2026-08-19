/**
 * verify-workspace-backfill.ts — remaining null `workspace_id` values per table.
 *
 *   npm run db:verify:workspace-backfill
 *
 * #94 backfills Workspace-owned rows in the journal and leaves the column
 * nullable. #96 then sets `NOT NULL`. This verifier reports what is still null.
 *
 * Discovery is the catalog: every public table that has a `workspace_id`
 * column is reported, including tables whose column is already `NOT NULL`
 * (those rows read as zero). The global allowlist never appears because it
 * has no such column.
 */

import { isEntryPoint } from "./lib/entrypoint";
import { requireDatabaseUrl } from "../shared/databaseUrl";
import pg from "pg";

export interface TableNulls {
  table: string;
  remainingNulls: number;
  nullable: boolean;
}

export async function remainingWorkspaceIdNulls(
  client: pg.Client
): Promise<TableNulls[]> {
  const columns = await client.query<{ table_name: string; is_nullable: string }>(
    `SELECT table_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'workspace_id'
      ORDER BY table_name`
  );

  const rows: TableNulls[] = [];
  for (const column of columns.rows) {
    const nullable = column.is_nullable === "YES";
    if (!nullable) {
      rows.push({ table: column.table_name, remainingNulls: 0, nullable: false });
      continue;
    }
    const counted = await client.query<{ remaining_nulls: number }>(
      `SELECT count(*)::int AS remaining_nulls
         FROM ${pgClientIdent(column.table_name)}
        WHERE workspace_id IS NULL`,
    );
    rows.push({
      table: column.table_name,
      remainingNulls: counted.rows[0]?.remaining_nulls ?? 0,
      nullable: true,
    });
  }
  return rows;
}

function pgClientIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to interpolate table name ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

export function formatRemaining(rows: TableNulls[]): string {
  return rows
    .map(
      (row) =>
        `${row.table}\t${row.remainingNulls}${row.nullable ? "" : "\tNOT NULL"}`
    )
    .join("\n");
}

if (isEntryPoint(import.meta.url)) {
  const url = requireDatabaseUrl();
  const client = new pg.Client({ connectionString: url });
  client
    .connect()
    .then(() => remainingWorkspaceIdNulls(client))
    .then((rows) => {
      console.log(formatRemaining(rows) || "(no workspace_id columns)");
      const leftover = rows.reduce((sum, row) => sum + row.remainingNulls, 0);
      if (leftover > 0) {
        console.error(`VERIFIER: ${leftover} row(s) still have a null workspace_id`);
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => client.end());
}
