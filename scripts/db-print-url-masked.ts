/**
 * db-print-url-masked.ts — npm run db:print:url:masked
 *
 * Prints a masked version of the effective connection string for debugging.
 * Password is always hidden.
 */

import { maskDatabaseUrl, requireDatabaseUrl, resolveDatabaseUrl } from "../shared/databaseUrl";

const { source } = resolveDatabaseUrl();

try {
  console.log(`Source : ${source}`);
  console.log(`URL    : ${maskDatabaseUrl(requireDatabaseUrl())}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
