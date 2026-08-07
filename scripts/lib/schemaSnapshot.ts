/**
 * schemaSnapshot.ts — what a database actually contains, read back from it.
 *
 * `shared/schema.ts` says what the code expects and `migrations/` says what was
 * applied; neither can tell you what is really in a database. Both the schema
 * diff in `tests/smoke/migrations.test.ts` and the audit in
 * `scripts/verify-schema.ts` need that third answer, and they must ask for it
 * the same way — a difference in how the two introspect is a difference they
 * would report as schema drift.
 *
 * Read-only: nothing here writes, so it is safe against any database, including
 * one it is auditing.
 */

import type pg from "pg";

/**
 * Columns with their real types — `format_type` renders the type modifier, so
 * `varchar(255)` and `vector(1536)` compare as themselves rather than collapsing
 * into `character varying` and `USER-DEFINED` the way `information_schema` does.
 *
 * Sorted by name, not by position: a column appended by `ALTER TABLE` lands last
 * while the same column in a `CREATE TABLE` sits wherever the schema file
 * declares it, and that difference means nothing.
 */
const COLUMNS_SQL = `
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull AS not_null,
         pg_get_expr(d.adbin, d.adrelid) AS default_expr
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND c.relname <> $1
  ORDER BY c.relname, a.attname
`;

const INDEXES_SQL = `
  SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename <> $1
  ORDER BY tablename, indexname
`;

/** Primary keys, foreign keys, uniques, and checks, as Postgres renders them. */
const CONSTRAINTS_SQL = `
  SELECT c.conrelid::regclass::text AS table_name,
         c.conname AS constraint_name,
         pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public'
    AND c.conrelid::regclass::text <> $1
  ORDER BY 1, 2
`;

/**
 * The runner's own bookkeeping table. It is not part of the schema any migration
 * declares, so every comparison excludes it — a baselined database has one and a
 * freshly pushed database does not, and that is not drift.
 */
const LEDGER_TABLE = "schema_migrations";

export interface ColumnRow {
  table_name: string;
  column_name: string;
  type: string;
  not_null: boolean;
  default_expr: string | null;
}

export interface IndexRow {
  table_name: string;
  index_name: string;
  definition: string;
}

export interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  definition: string;
}

export interface SchemaSnapshot {
  columns: ColumnRow[];
  indexes: IndexRow[];
  constraints: ConstraintRow[];
}

export async function describeSchema(client: pg.Client): Promise<SchemaSnapshot> {
  const [columns, indexes, constraints] = await Promise.all([
    client.query<ColumnRow>(COLUMNS_SQL, [LEDGER_TABLE]),
    client.query<IndexRow>(INDEXES_SQL, [LEDGER_TABLE]),
    client.query<ConstraintRow>(CONSTRAINTS_SQL, [LEDGER_TABLE]),
  ]);
  return { columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows };
}

/** Restrict a snapshot to a set of tables, for comparing one area of a schema. */
export function onlyTables(snapshot: SchemaSnapshot, tables: readonly string[]): SchemaSnapshot {
  const wanted = new Set(tables);
  return {
    columns: snapshot.columns.filter((row) => wanted.has(row.table_name)),
    indexes: snapshot.indexes.filter((row) => wanted.has(row.table_name)),
    constraints: snapshot.constraints.filter((row) => wanted.has(row.table_name)),
  };
}

export type DifferenceKind = "column" | "index" | "constraint";

export type SchemaRow = ColumnRow | IndexRow | ConstraintRow;

export interface SchemaDifference {
  kind: DifferenceKind;
  /** `table.name` — what the two sides disagree about. */
  key: string;
  /** Absent when the subject has something the reference does not. */
  reference?: SchemaRow;
  /** Absent when the reference has something the subject does not. */
  subject?: SchemaRow;
}

function keyed<T extends SchemaRow>(rows: T[], name: (row: T) => string): Map<string, T> {
  return new Map(rows.map((row) => [`${row.table_name}.${name(row)}`, row]));
}

function diffKind<T extends SchemaRow>(
  kind: DifferenceKind,
  reference: T[],
  subject: T[],
  name: (row: T) => string
): SchemaDifference[] {
  const left = keyed(reference, name);
  const right = keyed(subject, name);
  const differences: SchemaDifference[] = [];

  for (const [key, referenceRow] of left) {
    const subjectRow = right.get(key);
    if (!subjectRow) {
      differences.push({ kind, key, reference: referenceRow });
    } else if (JSON.stringify(referenceRow) !== JSON.stringify(subjectRow)) {
      differences.push({ kind, key, reference: referenceRow, subject: subjectRow });
    }
  }
  for (const [key, subjectRow] of right) {
    if (!left.has(key)) differences.push({ kind, key, subject: subjectRow });
  }

  return differences;
}

/**
 * What `subject` has that `reference` does not, and the reverse. The reference
 * is the journal: a subject-only row is something applied out of band, and a
 * reference-only row is a migration the subject never received.
 */
export function diffSchemas(reference: SchemaSnapshot, subject: SchemaSnapshot): SchemaDifference[] {
  return [
    ...diffKind("column", reference.columns, subject.columns, (row) => row.column_name),
    ...diffKind("index", reference.indexes, subject.indexes, (row) => row.index_name),
    ...diffKind("constraint", reference.constraints, subject.constraints, (row) => row.constraint_name),
  ];
}

export function formatDifferences(differences: SchemaDifference[]): string {
  return differences
    .map((difference) => {
      const { kind, key, reference, subject } = difference;
      if (!subject) return `  MISSING   ${kind} ${key} — in the journal, not in this database`;
      if (!reference) return `  EXTRA     ${kind} ${key} — in this database, not in the journal`;
      return (
        `  DIFFERS   ${kind} ${key}\n` +
        `              journal:  ${JSON.stringify(reference)}\n` +
        `              database: ${JSON.stringify(subject)}`
      );
    })
    .join("\n");
}
