import { createApp, log } from "./app";
import { config, logConfigSummary } from "./config";
import { serveStatic } from "./static";
import { detectMigrationFlags } from "./migrationFlags";

/**
 * Boot reads the database and never changes it (#24, ADR-0017).
 *
 * This entry point used to create the tasks and desktop-agent tables on every
 * start, link orphan projects into the CRM, and seed the default CRM modules —
 * schema and data changes applied by whichever instance happened to boot first,
 * with no record of what ran or when. All of it now lives in `migrations/` and
 * `scripts/`, applied by an explicit command: `npm run db:migrate`, then
 * `npm run db:seed` and `npm run db:backfill:crm-links` on a new database.
 * `migrations/README.md` has the order.
 */
(async () => {
  // First line of the boot log: what this process resolved its environment to.
  logConfigSummary();

  // Read-only probe: which optional migrations this database has, which decides
  // whether the tasks routes serve or answer 503. It creates nothing — a
  // database short of a migration is a deploy that skipped its pre-deploy step.
  await detectMigrationFlags();

  const { app, httpServer } = await createApp();

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (config.isProduction) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = config.port;
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
