import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  formatManifest,
  parseListing,
  readManifest,
  reconcile,
} from "../../scripts/object-snapshot";
import { readManifestKeys } from "../../scripts/snapshot-rehearsal";

/**
 * The object half of ADR-0018's snapshot pair, which ADR-0022 specifies and
 * ADR-0023 leaves standing after the provider change: an operator-run,
 * key-preserving copy, ordered at or after the database export it is paired
 * with, evidenced by a manifest of keys, sizes, checksums, counts, and both
 * timestamps.
 *
 * The manifest is the Phase 2 evidence artifact, so what it may contain is as
 * much the subject here as what it says: keys and sizes, never a credential,
 * never a bucket secret, never a signed URL.
 *
 * Reconciliation is deliberately asymmetric. A key the manifest names and the
 * destination lacks is a failed copy. A key the destination holds and the
 * manifest does not is expected — objects are creation-only, so anything
 * written after the source was read is a superset rather than a discrepancy.
 */

async function corpus(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "docuflow-objects-"));
  for (const [key, contents] of Object.entries(files)) {
    const path = join(root, key);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

const TIMESTAMPS = { exportedAt: "2026-08-13T10:00:00Z", copiedAt: "2026-08-13T10:05:00Z" };

describe("the copy manifest", () => {
  it("names every object by its bucket-relative key, nested ones included", async () => {
    const root = await corpus({
      ".private/uploads/doc-1": "one",
      ".private/uploads/nested/doc-2": "two",
      "public/logo.png": "png",
    });

    const manifest = await buildManifest(root, TIMESTAMPS);

    expect(manifest.objects.map((object) => object.key)).toEqual([
      ".private/uploads/doc-1",
      ".private/uploads/nested/doc-2",
      "public/logo.png",
    ]);
  });

  it("records each object's size and checksum", async () => {
    const root = await corpus({ "a": "12345" });

    const [object] = (await buildManifest(root, TIMESTAMPS)).objects;

    expect(object.size).toBe(5);
    // sha256("12345")
    expect(object.sha256).toBe(
      "5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5"
    );
  });

  it("carries the counts and both snapshot timestamps", async () => {
    const root = await corpus({ a: "1", b: "22" });

    const manifest = await buildManifest(root, TIMESTAMPS);

    expect(manifest.count).toBe(2);
    expect(manifest.totalBytes).toBe(3);
    expect(manifest.exportedAt).toBe(TIMESTAMPS.exportedAt);
    expect(manifest.copiedAt).toBe(TIMESTAMPS.copiedAt);
  });

  it("refuses a copy taken before the export it is paired with", async () => {
    const root = await corpus({ a: "1" });

    // ADR-0022: objects are creation-only, so a copy taken after its export is a
    // superset of what the export names. The reverse manufactures dangling keys
    // that are an artifact of sequencing rather than of the migration.
    await expect(
      buildManifest(root, { exportedAt: "2026-08-13T10:05:00Z", copiedAt: "2026-08-13T10:00:00Z" })
    ).rejects.toThrow(/before the export/i);
  });

  it("survives a round trip through the file it is written to", async () => {
    const root = await corpus({ a: "1" });
    const manifest = await buildManifest(root, TIMESTAMPS);

    expect(readManifest(formatManifest(manifest))).toEqual(manifest);
  });

  it("is read as keys by the dangling-key verifier, so one artifact serves both", async () => {
    const root = await corpus({ ".private/uploads/doc-1": "one" });
    const manifest = await buildManifest(root, TIMESTAMPS);

    expect(readManifestKeys(formatManifest(manifest))).toEqual([".private/uploads/doc-1"]);
  });
});

describe("reconciling the copy against the destination", () => {
  const manifest = {
    exportedAt: TIMESTAMPS.exportedAt,
    copiedAt: TIMESTAMPS.copiedAt,
    count: 2,
    totalBytes: 6,
    objects: [
      { key: "a", size: 3, sha256: "x" },
      { key: "b", size: 3, sha256: "y" },
    ],
  };

  it("reports a key the destination is missing as a failed copy", () => {
    const result = reconcile(manifest, [{ objectName: "a" }]);

    expect(result.missing).toEqual(["b"]);
    expect(result.ok).toBe(false);
  });

  it("accepts a destination holding more than the manifest names", () => {
    const result = reconcile(manifest, [
      { objectName: "a" },
      { objectName: "b" },
      { objectName: "written-later" },
    ]);

    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual(["written-later"]);
    expect(result.ok).toBe(true);
  });

  it("reports a size that does not match, which a key comparison alone would pass", () => {
    const result = reconcile(manifest, [
      { objectName: "a", size: 3 },
      { objectName: "b", size: 99 },
    ]);

    expect(result.mismatched).toEqual([{ key: "b", expected: 3, found: 99 }]);
    expect(result.ok).toBe(false);
  });

  it("says nothing about size when the destination does not report one", () => {
    // Replit App Storage lists names only. Silence is not a match, and it is
    // not a mismatch either — the manifest's checksums are what a byte-level
    // check would have to use, at the source.
    const result = reconcile(manifest, [{ objectName: "a" }, { objectName: "b" }]);

    expect(result.mismatched).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("a destination listing on disk", () => {
  it("reads one key per line, ignoring blanks and comments", () => {
    expect(parseListing("a\n\n# from the bucket\nb\n")).toEqual([
      { objectName: "a" },
      { objectName: "b" },
    ]);
  });

  it("reads a size when the line carries one", () => {
    expect(parseListing("a 3\nb 42\n")).toEqual([
      { objectName: "a", size: 3 },
      { objectName: "b", size: 42 },
    ]);
  });
});
