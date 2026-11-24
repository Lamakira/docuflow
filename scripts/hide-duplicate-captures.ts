/**
 * hide-duplicate-captures.ts - keep one live row per capture and image (F75).
 *
 *   npm run db:hide:duplicate-captures                        # dry run
 *   npm run db:hide:duplicate-captures -- --apply
 *   npm run db:hide:duplicate-captures -- --apply --batch-size 500
 *   npm run db:hide:duplicate-captures -- --undo
 *
 * A set is the uploaded captures of one Time Entry at one instant with one
 * image. The earliest live one stays and the others are tombstoned with the
 * reason `duplicate`; when an Administrator deleted any of the set, every live
 * one is. No row and no stored image is removed.
 *
 * `--undo` restores the captures hidden as duplicates. The upload path hides
 * copies the same way, so undo also restores those; `--apply` hides them again.
 *
 * Needs the same environment as the server (`DATABASE_URL` for the app role). It
 * runs as the app role, one Workspace at a time inside that Workspace's context.
 * Idempotent: a rerun hides only what appeared since.
 */

import { isEntryPoint } from "./lib/entrypoint";
import { flagValue } from "./lib/args";

export interface HideDuplicatesOptions {
  apply?: boolean;
  undo?: boolean;
  batchSize?: number;
}

export interface HideDuplicatesTotals {
  workspaces: number;
  sets: number;
  copies: number;
  hidden: number;
  restored: number;
}

export async function hideDuplicatesInAllWorkspaces(
  options: HideDuplicatesOptions = {},
  report: (message: string) => void = () => {}
): Promise<HideDuplicatesTotals> {
  if (options.apply && options.undo) throw new Error("--apply and --undo exclude each other");
  if (options.batchSize !== undefined && !(Number.isInteger(options.batchSize) && options.batchSize > 0)) {
    throw new Error("--batch-size needs a whole number from 1");
  }
  // Server modules resolve configuration at import; load them only when run.
  const { db } = await import("../server/db");
  const { workspaces } = await import("../shared/schema");
  const { runWithWorkspaceContext } = await import("../server/workspaceContext");
  const { countDuplicateCaptures, hideDuplicateCaptures, restoreDuplicateCaptures } = await import(
    "../server/modules/activity/duplicates"
  );

  const totals: HideDuplicatesTotals = { workspaces: 0, sets: 0, copies: 0, hidden: 0, restored: 0 };
  const rows = await db.select({ id: workspaces.id }).from(workspaces);
  for (const { id } of rows) {
    await runWithWorkspaceContext({ workspaceId: id }, async () => {
      totals.workspaces++;
      if (options.undo) {
        const restored = await restoreDuplicateCaptures();
        totals.restored += restored;
        report(`workspace ${id}: restored ${restored}`);
        return;
      }
      const { sets, copies } = await countDuplicateCaptures();
      totals.sets += sets;
      totals.copies += copies;
      if (!options.apply) {
        report(`workspace ${id}: ${sets} duplicate sets, ${copies} copies would be hidden`);
        return;
      }
      const hidden = await hideDuplicateCaptures({ batchSize: options.batchSize });
      totals.hidden += hidden;
      report(`workspace ${id}: ${sets} duplicate sets, hid ${hidden} copies`);
    });
  }
  return totals;
}

if (isEntryPoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const undo = argv.includes("--undo");
  const batch = flagValue(argv, "--batch-size");
  hideDuplicatesInAllWorkspaces({ apply, undo, batchSize: batch ? Number(batch) : undefined }, (message) =>
    console.log(message)
  )
    .then(async ({ workspaces, sets, copies, hidden, restored }) => {
      if (undo) console.log(`${workspaces} workspaces: restored ${restored}`);
      else if (apply) console.log(`${workspaces} workspaces: ${sets} duplicate sets, hid ${hidden} copies`);
      else console.log(`${workspaces} workspaces: ${sets} duplicate sets, ${copies} copies would be hidden (dry run)`);
      const { pool } = await import("../server/db");
      await pool.end();
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
      process.exit();
    });
}
