/**
 * Capture fingerprints (#341). A difference hash (dHash) of the screen: 64 bits
 * that survive a changed clock or a blinking cursor but not a different window
 * layout. "Similar" is decided from these bits alone (`shared/activityEvidence`),
 * so the gallery never has to decode an image to compare two captures.
 */

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { timeEntryScreenshots } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace } from "../../workspaceContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SharpFactory = (input: Buffer) => any;

// sharp is optional — loaded lazily so the server starts even if libvips is unavailable
let sharpLoad: Promise<SharpFactory | null> | null = null;

/** The sharp factory, or null when libvips is unavailable. Loaded once, warns once. */
export function loadSharp(): Promise<SharpFactory | null> {
  sharpLoad ??= (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((await import("sharp" as any)) as any).default as SharpFactory;
    } catch {
      console.warn("[fingerprint] sharp not available — screenshot compression and fingerprints disabled");
      return null;
    }
  })();
  return sharpLoad;
}

/**
 * dHash: grayscale, 9x8, each pixel against its right neighbour (left > right is
 * a 1), row-major, most significant bit first: 16 lowercase hex digits. Null when
 * sharp is unavailable or the image cannot be decoded — a capture without a
 * fingerprint is simply never Similar.
 */
export async function differenceHash(
  sharp: SharpFactory | null,
  imageBuffer: Buffer
): Promise<string | null> {
  if (!sharp) return null;
  try {
    const pixels: Buffer = await sharp(imageBuffer)
      .grayscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer();
    if (pixels.length < 72) return null;
    let hex = "";
    for (let row = 0; row < 8; row++) {
      let nibbleBits = 0;
      for (let col = 0; col < 8; col++) {
        const bit = pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? 1 : 0;
        nibbleBits = (nibbleBits << 1) | bit;
        if (col % 4 === 3) {
          hex += nibbleBits.toString(16);
          nibbleBits = 0;
        }
      }
    }
    return hex;
  } catch {
    return null;
  }
}

export interface BackfillFingerprintsOptions {
  /** Bytes of the object a row's `storageKey` names; throws when it is missing. */
  readObject: (storageKey: string) => Promise<Buffer>;
  sharp: SharpFactory | null;
  batchSize?: number;
  report?: (message: string) => void;
}

export interface BackfillFingerprintsResult {
  scanned: number;
  written: number;
  /** Captures whose object or image could not be read; they keep a null fingerprint. */
  missing: number;
}

/**
 * Fingerprints existing captures of the active Workspace (run inside
 * `runWithWorkspaceContext`, so RLS applies). Only live, uploaded rows without a
 * fingerprint are visited, walked by id so one run passes over rows that stay
 * null. The data is the checkpoint: a rerun revisits only what is still null.
 */
export async function backfillScreenshotFingerprints(
  options: BackfillFingerprintsOptions
): Promise<BackfillFingerprintsResult> {
  const batchSize = options.batchSize ?? 100;
  const report = options.report ?? (() => {});
  const result: BackfillFingerprintsResult = { scanned: 0, written: 0, missing: 0 };
  let afterId = "";

  for (;;) {
    const batch = await db
      .select({ id: timeEntryScreenshots.id, storageKey: timeEntryScreenshots.storageKey })
      .from(timeEntryScreenshots)
      .where(
        and(
          inWorkspace(timeEntryScreenshots),
          isNull(timeEntryScreenshots.perceptualHash),
          isNull(timeEntryScreenshots.deletedAt),
          sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
          gt(timeEntryScreenshots.id, afterId)
        )
      )
      .orderBy(asc(timeEntryScreenshots.id))
      .limit(batchSize);
    if (batch.length === 0) break;
    afterId = batch[batch.length - 1].id;

    for (const row of batch) {
      result.scanned++;
      let hash: string | null = null;
      try {
        hash = await differenceHash(options.sharp, await options.readObject(row.storageKey));
      } catch {
        hash = null;
      }
      if (!hash) {
        result.missing++;
        report(`no fingerprint for ${row.id} (${row.storageKey})`);
        continue;
      }
      await db
        .update(timeEntryScreenshots)
        .set({ perceptualHash: hash })
        .where(
          and(
            eq(timeEntryScreenshots.id, row.id),
            inWorkspace(timeEntryScreenshots),
            isNull(timeEntryScreenshots.perceptualHash)
          )
        );
      result.written++;
    }
  }
  return result;
}
