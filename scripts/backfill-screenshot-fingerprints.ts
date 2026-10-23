/**
 * backfill-screenshot-fingerprints.ts — give every existing capture the
 * fingerprint new uploads get at the door (#341), so the gallery's Similar
 * lens can compare captures taken before it existed.
 *
 *   npm run db:backfill:screenshot-fingerprints
 *   npm run db:backfill:screenshot-fingerprints -- --batch-size 50
 *
 * Needs the same environment as the server (`DATABASE_URL` for the app role, the
 * object-storage settings of the deployment, loaded from `.env` when present):
 * it reads each capture's image from storage, so it must run where the objects
 * are reachable. It runs as the app role, one Workspace at a time inside that
 * Workspace's context, so row-level security applies exactly as it does to the
 * server.
 *
 * Idempotent and resumable: only live, uploaded captures whose fingerprint is
 * still null are visited, in batches walked by id. A capture whose object is
 * missing or unreadable keeps a null fingerprint (it is never Similar), is
 * counted, and does not stop the run. Rerun at will; a rerun writes only what a
 * previous run could not.
 */

import { isEntryPoint } from "./lib/entrypoint";
import { flagValue } from "./lib/args";

export interface FingerprintBackfillTotals {
  workspaces: number;
  scanned: number;
  written: number;
  missing: number;
}

export async function backfillAllWorkspaces(
  options: { batchSize?: number } = {},
  report: (message: string) => void = () => {}
): Promise<FingerprintBackfillTotals> {
  // Server modules resolve configuration at import; load them only when run.
  const { db } = await import("../server/db");
  const { workspaces } = await import("../shared/schema");
  const { runWithWorkspaceContext } = await import("../server/workspaceContext");
  const { ObjectStorageService, objectRefFromEntityPath } = await import("../server/objectStorage");
  const { backfillScreenshotFingerprints, loadSharp } = await import("../server/modules/activity/fingerprint");

  const sharp = await loadSharp();
  if (!sharp) throw new Error("sharp is not available; no fingerprint can be computed");
  const objects = new ObjectStorageService();
  const totals: FingerprintBackfillTotals = { workspaces: 0, scanned: 0, written: 0, missing: 0 };

  const rows = await db.select({ id: workspaces.id }).from(workspaces);
  for (const { id } of rows) {
    const result = await runWithWorkspaceContext({ workspaceId: id }, () =>
      backfillScreenshotFingerprints({
        sharp,
        batchSize: options.batchSize,
        readObject: (storageKey) => objects.readObjectBytes(objectRefFromEntityPath(storageKey)),
        report,
      })
    );
    totals.workspaces++;
    totals.scanned += result.scanned;
    totals.written += result.written;
    totals.missing += result.missing;
    report(`workspace ${id}: scanned ${result.scanned}, written ${result.written}, missing ${result.missing}`);
  }
  return totals;
}

if (isEntryPoint(import.meta.url)) {
  const batch = flagValue(process.argv.slice(2), "--batch-size");
  backfillAllWorkspaces({ batchSize: batch ? Number(batch) : undefined }, (message) => console.log(message))
    .then(async ({ workspaces, scanned, written, missing }) => {
      console.log(`${workspaces} workspaces: scanned ${scanned}, fingerprinted ${written}, left null ${missing}`);
      const { pool } = await import("../server/db");
      await pool.end();
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
      process.exit();
    });
}
