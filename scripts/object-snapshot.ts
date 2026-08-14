/**
 * object-snapshot.ts — the object half of ADR-0018's snapshot pair.
 *
 *   npm run objects:manifest -- --from ./staged --exported-at <iso> --copied-at <iso>
 *   npm run objects:listing  -- --bucket docuflow --prefix .private/
 *   npm run objects:reconcile -- --manifest manifest.json --listing listing.txt
 *
 * ADR-0022 specifies the copy and ADR-0023 leaves that specification standing
 * after moving the bucket to Replit App Storage: operator-run and out-of-band,
 * key-preserving, ordered at or after the database export it is paired with, and
 * evidenced by a manifest of keys, sizes, checksums, counts, and both
 * timestamps.
 *
 * What this file is not: the copy itself. A production-side credential and a
 * destination credential meet only in the operator's session, on a machine that
 * is neither this repository, its CI, nor this project's Secrets — so the
 * transfer is a command an operator runs, and what belongs here is the evidence
 * it produces and the check that it worked. The manifest is the Phase 2 evidence
 * artifact under ADR-0017's evidence rule and names no credential and no bucket
 * secret; it holds keys, sizes, and checksums, which grant nothing on their own.
 *
 * Reconciliation is asymmetric on purpose. A key the manifest names and the
 * destination lacks is a failed copy. A key the destination holds and the
 * manifest does not is expected: objects are creation-only, so anything written
 * after the source was read is a superset rather than a discrepancy.
 *
 * `snapshot-rehearsal.ts` asks the same question from the database's side —
 * every key a restored row names must resolve — and reads this same manifest, so
 * one artifact serves the copy check and the dangling-key verifier both.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ListedObject } from "../server/storagePort";
import { flagValue } from "./lib/args";
import { isEntryPoint } from "./lib/entrypoint";

export interface ManifestObject {
  /** Bucket-relative object name. Keys are preserved, never re-keyed (ADR-0022). */
  key: string;
  size: number;
  sha256: string;
}

export interface Manifest {
  /** When the paired database export was taken. */
  exportedAt: string;
  /** When these objects were read. Never before `exportedAt`. */
  copiedAt: string;
  count: number;
  totalBytes: number;
  objects: ManifestObject[];
}

export interface SnapshotTimestamps {
  exportedAt: string;
  copiedAt: string;
}

/** Every file beneath `root`, as bucket-relative keys, in a stable order. */
async function keysUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const keys: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath ?? entry.path, entry.name);
    // Posix separators: a key is what the bucket holds, not what this host spells.
    keys.push(relative(root, absolute).split(sep).join("/"));
  }
  return keys.sort();
}

/**
 * The evidence record for one copy. Reads every object to checksum it, which is
 * the point — a manifest of sizes alone cannot tell a truncated copy from a
 * complete one.
 */
export async function buildManifest(
  root: string,
  timestamps: SnapshotTimestamps
): Promise<Manifest> {
  if (new Date(timestamps.copiedAt) < new Date(timestamps.exportedAt)) {
    throw new Error(
      `The object copy is dated before the export it is paired with ` +
        `(${timestamps.copiedAt} < ${timestamps.exportedAt}). ADR-0022 orders the copy at ` +
        `or after its export: objects are creation-only, so a later copy is a superset of ` +
        `what the export names, while the reverse manufactures dangling keys that are an ` +
        `artifact of sequencing rather than of the migration.`
    );
  }

  const objects: ManifestObject[] = [];
  for (const key of await keysUnder(root)) {
    const contents = await readFile(join(root, key));
    objects.push({
      key,
      size: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  }

  return {
    ...timestamps,
    count: objects.length,
    totalBytes: objects.reduce((total, object) => total + object.size, 0),
    objects,
  };
}

export function formatManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function readManifest(text: string): Manifest {
  return JSON.parse(text) as Manifest;
}

/** A destination listing on disk: `key` per line, optionally `key size`. */
export function parseListing(text: string): ListedObject[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const at = line.lastIndexOf(" ");
      const size = at === -1 ? NaN : Number(line.slice(at + 1));
      return Number.isFinite(size)
        ? { objectName: line.slice(0, at), size }
        : { objectName: line };
    });
}

export interface Reconciliation {
  /** Named by the manifest, absent from the destination: a failed copy. */
  missing: string[];
  /** Held by the destination, not named: expected, and reported for the record. */
  extra: string[];
  mismatched: { key: string; expected: number; found: number }[];
  ok: boolean;
}

export function reconcile(manifest: Manifest, destination: ListedObject[]): Reconciliation {
  const held = new Map(destination.map((entry) => [entry.objectName, entry]));

  const missing: string[] = [];
  const mismatched: Reconciliation["mismatched"] = [];
  for (const object of manifest.objects) {
    const found = held.get(object.key);
    if (!found) {
      missing.push(object.key);
      continue;
    }
    // A provider that reports no size says nothing, which is neither a match nor
    // a mismatch: Replit App Storage lists names only, and the manifest's
    // checksums are what a byte-level check would have to use, at the source.
    if (found.size !== undefined && found.size !== object.size) {
      mismatched.push({ key: object.key, expected: object.size, found: found.size });
    }
  }

  const named = new Set(manifest.objects.map((object) => object.key));
  const extra = destination
    .map((entry) => entry.objectName)
    .filter((objectName) => !named.has(objectName));

  return { missing, extra, mismatched, ok: missing.length === 0 && mismatched.length === 0 };
}

/**
 * The destination's own listing, through the storage port — which is also the
 * first half of the exit ADR-0023 conditions this provider on: list, then
 * download. Imported lazily because reaching a bucket needs the server's whole
 * configuration, and neither of the other two commands here should be blocked by
 * a variable it will never use.
 */
async function listDestination(bucketName: string, prefix?: string): Promise<ListedObject[]> {
  const { storagePort } = await import("../server/objectStorage");
  return storagePort.list({ bucketName, prefix });
}

function formatListing(objects: ListedObject[]): string {
  return objects
    .map((object) => (object.size === undefined ? object.objectName : `${object.objectName} ${object.size}`))
    .join("\n")
    .concat("\n");
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0];

  if (command === "manifest") {
    const from = flagValue(argv, "--from", "a directory holding the copied objects");
    const exportedAt = flagValue(argv, "--exported-at", "the paired export's ISO timestamp");
    const copiedAt = flagValue(argv, "--copied-at", "the copy's ISO timestamp");
    if (!from || !exportedAt || !copiedAt) {
      throw new Error("manifest needs --from, --exported-at, and --copied-at");
    }

    const manifest = await buildManifest(from, { exportedAt, copiedAt });
    const out = flagValue(argv, "--out", "a path to write the manifest to");
    if (out) {
      await writeFile(out, formatManifest(manifest));
      console.log(`manifest: ${manifest.count} object(s), ${manifest.totalBytes} bytes → ${out}`);
    } else {
      process.stdout.write(formatManifest(manifest));
    }
    return 0;
  }

  if (command === "listing") {
    const bucket = flagValue(argv, "--bucket", "the destination bucket name");
    if (!bucket) throw new Error("listing needs --bucket");
    const listing = await listDestination(bucket, flagValue(argv, "--prefix", "an object prefix"));
    process.stdout.write(formatListing(listing));
    return 0;
  }

  if (command === "reconcile") {
    const manifestPath = flagValue(argv, "--manifest", "a path to the copy manifest");
    if (!manifestPath) throw new Error("reconcile needs --manifest");
    const manifest = readManifest(await readFile(manifestPath, "utf8"));

    const listingPath = flagValue(argv, "--listing", "a path to a destination listing");
    const bucket = flagValue(argv, "--bucket", "the destination bucket name");
    if (!listingPath && !bucket) {
      throw new Error("reconcile needs --listing <file> or --bucket <name>");
    }
    const destination = listingPath
      ? parseListing(await readFile(listingPath, "utf8"))
      : await listDestination(bucket!, flagValue(argv, "--prefix", "an object prefix"));

    const result = reconcile(manifest, destination);
    console.log(`manifest:    ${manifest.count} object(s), ${manifest.totalBytes} bytes`);
    console.log(`destination: ${destination.length} object(s)`);
    console.log(`extra at the destination: ${result.extra.length} (expected — objects postdate the export)`);

    if (result.ok) {
      console.log("reconciled: every object the manifest names is present");
      return 0;
    }
    for (const key of result.missing.slice(0, 20)) console.error(`  missing: ${key}`);
    if (result.missing.length > 20) console.error(`  … and ${result.missing.length - 20} more`);
    for (const entry of result.mismatched) {
      console.error(`  size differs: ${entry.key} — manifest ${entry.expected}, destination ${entry.found}`);
    }
    return 1;
  }

  throw new Error(`Unknown command "${command ?? ""}". Use manifest, listing, or reconcile.`);
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
