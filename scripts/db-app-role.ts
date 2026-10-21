/**
 * db-app-role.ts — npm run db:app-role
 *
 * Gives the local `docuflow_app` role the password named in DATABASE_APP_URL
 * (#323). A fresh `npm run db:up` volume creates the role already
 * (docker/dev-db-init); a volume that predates it only has the role migration
 * 0010 created, with no password. Connects as the owner (DATABASE_MIGRATE_URL,
 * else DATABASE_URL) and refuses any host that is not this machine.
 */

import pg from "pg";
import { requireMigrateDatabaseUrl } from "../shared/databaseUrl";

const APP_ROLE = "docuflow_app";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function requireLocal(label: string, url: URL): void {
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing to change a role on non-local host "${url.hostname}" (${label}). This is for local development.`);
  }
}

async function main(): Promise<void> {
  const appUrl = process.env.DATABASE_APP_URL;
  if (!appUrl) throw new Error("DATABASE_APP_URL is not set; it names the password to give docuflow_app.");
  const app = new URL(appUrl);
  if (decodeURIComponent(app.username) !== APP_ROLE) {
    throw new Error(`DATABASE_APP_URL must connect as ${APP_ROLE}, not "${decodeURIComponent(app.username)}".`);
  }
  const password = decodeURIComponent(app.password);
  if (!password) throw new Error("DATABASE_APP_URL has no password.");

  const ownerUrl = requireMigrateDatabaseUrl();
  requireLocal("DATABASE_APP_URL", app);
  requireLocal("owner URL", new URL(ownerUrl));

  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    // ALTER ROLE takes no bind parameters.
    await owner.query(`ALTER ROLE ${APP_ROLE} WITH PASSWORD ${pg.escapeLiteral(password)}`);
  } finally {
    await owner.end();
  }
  console.log(`Set the password of ${APP_ROLE} from DATABASE_APP_URL.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
