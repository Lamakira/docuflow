import type { Express } from "express";

let cached: { app: Express; stopBackgroundJobs: () => void } | null = null;

/**
 * Boot the real Express app in-process (same assembly production uses via
 * server/app.ts), once per test file. Server modules are imported dynamically
 * so tests/setup.ts has fixed the environment first.
 */
export async function makeApp(): Promise<Express> {
  if (cached) return cached.app;
  const { createApp } = await import("../../server/app");
  const { detectMigrationFlags } = await import("../../server/migrationFlags");
  const { app, stopBackgroundJobs } = await createApp();
  // Boot parity with server/index.ts: enables the tasks routes when the
  // tasks table exists (the global setup's schema push creates it).
  await detectMigrationFlags();
  cached = { app, stopBackgroundJobs };
  return app;
}

/**
 * Stop the app's periodic dispatchers. The routes start stale-session,
 * due-reminder, and daily-reminder loops on 1–2 minute intervals; left
 * running they outlive the test file that booted them and fire against a
 * closed pool — and, with reminders seeded, reach real email and storage
 * providers. Called from tests/setup.ts before the pool closes.
 */
export function stopApp(): void {
  cached?.stopBackgroundJobs();
  cached = null;
}
