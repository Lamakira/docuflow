import type { Express } from "express";

let cached: Express | null = null;

/**
 * Boot the real Express app in-process (same assembly production uses via
 * server/app.ts), once per test file. Server modules are imported dynamically
 * so tests/setup.ts has fixed the environment first.
 */
export async function makeApp(): Promise<Express> {
  if (cached) return cached;
  const { createApp } = await import("../../server/app");
  const { detectMigrationFlags } = await import("../../server/migrationFlags");
  const { app } = await createApp();
  // Boot parity with server/index.ts: enables the tasks routes when the
  // tasks table exists (the global setup's schema push creates it).
  await detectMigrationFlags();
  cached = app;
  return app;
}
