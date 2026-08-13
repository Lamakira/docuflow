import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertRehearsalTarget,
  findDanglingKeys,
  foreignStorageUrls,
  namedStorageKeys,
  ownBucketsOf,
  readManifestKeys,
  scanStorageUrls,
  scrubStorageUrls,
  toObjectName,
} from "../../scripts/snapshot-rehearsal";
import { openDb } from "../../scripts/lib/db";
import { resetDb, withClient } from "../helpers/db";
import { resolveTestDatabaseUrl } from "../test-db-url";

/**
 * The two checks ADR-0022 requires of a restored snapshot, and ADR-0023 leaves
 * standing after the provider change: absolute storage URLs are scrubbed out of
 * the restored database, and every storage key the database names resolves in
 * the destination bucket.
 *
 * The scrub is the one that must not be trusted to a table list. ADR-0023 made
 * the destination Google-backed, so a production row and one of ours share the
 * `storage.googleapis.com` host that `downloadRoutes.ts` validates — only the
 * bucket name distinguishes them, and a column nobody thought of is exactly the
 * failure mode. So the scan is driven by `information_schema`, and this suite
 * puts a foreign URL somewhere the rules do not cover to prove the run refuses
 * rather than reports clean.
 */

const OWN_BUCKET = "test-bucket";
const OWN_PRIVATE_DIR = `/${OWN_BUCKET}/.private`;
const FOREIGN = "https://storage.googleapis.com/docuflow-production/.private/uploads/abc";

const url = resolveTestDatabaseUrl();
const { close } = openDb(url);

afterAll(() => close());

beforeEach(async () => {
  await resetDb();
});

/** A user row, because most tables that can hold a URL reference one. */
async function insertUser(): Promise<string> {
  const id = randomUUID();
  await withClient(url, (client) =>
    client.query(`INSERT INTO users (id, email, password) VALUES ($1, $2, 'x')`, [
      id,
      `${id}@example.test`,
    ])
  );
  return id;
}

describe("reading a storage URL", () => {
  it("finds an absolute URL in a bucket that is not ours", () => {
    expect(foreignStorageUrls(FOREIGN, [OWN_BUCKET])).toEqual([FOREIGN]);
  });

  it("ignores one in our own bucket — the destination is Google-backed too", () => {
    const ours = `https://storage.googleapis.com/${OWN_BUCKET}/.private/uploads/abc`;
    expect(foreignStorageUrls(ours, [OWN_BUCKET])).toEqual([]);
  });

  it("reads the gs:// form as well as the https one", () => {
    expect(foreignStorageUrls("gs://docuflow-production/installers/x.exe", [OWN_BUCKET])).toEqual([
      "gs://docuflow-production/installers/x.exe",
    ]);
  });

  it("finds a URL embedded in free text or JSON, not only a bare column", () => {
    const attachments = `[{"url":"${FOREIGN}","filename":"x.pdf"}]`;
    expect(foreignStorageUrls(attachments, [OWN_BUCKET])).toEqual([FOREIGN]);
  });

  it("ignores URLs that are not storage at all", () => {
    expect(foreignStorageUrls("https://example.com/logo.png", [OWN_BUCKET])).toEqual([]);
  });

  it("takes our buckets from the object-storage roots, not from a separate variable", () => {
    expect(
      ownBucketsOf({
        PRIVATE_OBJECT_DIR: OWN_PRIVATE_DIR,
        PUBLIC_OBJECT_SEARCH_PATHS: `/${OWN_BUCKET}/public,/other-bucket/public`,
      })
    ).toEqual([OWN_BUCKET, "other-bucket"]);
  });
});

describe("scanning a restored database", () => {
  it("reports a foreign URL in a column no rule covers, and names it", async () => {
    const id = await insertUser();
    await withClient(url, (client) =>
      client.query(`UPDATE users SET profile_image_url = $1 WHERE id = $2`, [FOREIGN, id])
    );

    const findings = await withClient(url, (client) => scanStorageUrls(client, [OWN_BUCKET]));

    expect(findings).toContainEqual(
      expect.objectContaining({ table: "users", column: "profile_image_url", rows: 1, scrub: "undeclared" })
    );
  });

  it("leaves a row in our own bucket out of the findings", async () => {
    const id = await insertUser();
    await withClient(url, (client) =>
      client.query(`UPDATE users SET profile_image_url = $1 WHERE id = $2`, [
        `https://storage.googleapis.com/${OWN_BUCKET}/public/avatar.png`,
        id,
      ])
    );

    const findings = await withClient(url, (client) => scanStorageUrls(client, [OWN_BUCKET]));

    expect(findings).toEqual([]);
  });

  it("looks inside jsonb, where a URL hides from a column-name search", async () => {
    const id = await insertUser();
    await withClient(url, (client) =>
      client.query(
        `INSERT INTO company_documents (id, name, content, uploaded_by_id)
         VALUES ($1, 'Terms', $2::jsonb, $3)`,
        [randomUUID(), JSON.stringify({ href: FOREIGN }), id]
      )
    );

    const findings = await withClient(url, (client) => scanStorageUrls(client, [OWN_BUCKET]));

    expect(findings).toContainEqual(
      expect.objectContaining({ table: "company_documents", column: "content" })
    );
  });
});

describe("scrubbing a restored database", () => {
  async function insertRelease(storageUrl: string): Promise<void> {
    await withClient(url, (client) =>
      client.query(
        `INSERT INTO desktop_releases (id, version, platform, filename, storage_url, is_latest)
         VALUES ($1, '0.1.6', 'windows', 'DocuFlow-Agent-0.1.6-windows-setup.exe', $2, true)`,
        [randomUUID(), storageUrl]
      )
    );
  }

  async function releaseUrl(): Promise<string> {
    const { rows } = await withClient(url, (client) =>
      client.query(`SELECT storage_url FROM desktop_releases LIMIT 1`)
    );
    return rows[0].storage_url;
  }

  it("points a production installer row at this environment instead", async () => {
    await insertRelease("https://storage.googleapis.com/docuflow-production/installers/setup.exe");

    await withClient(url, (client) => scrubStorageUrls(client, [OWN_BUCKET]));

    // `/downloads/:platform` is what downloadRoutes.ts treats as a local
    // artifact, and it reports the platform unavailable while this environment
    // has not built one (ADR-0022, #60).
    expect(await releaseUrl()).toBe("/downloads/windows");
  });

  it("leaves an installer this environment published alone", async () => {
    const ours = `https://storage.googleapis.com/${OWN_BUCKET}/installers/setup.exe`;
    await insertRelease(ours);

    await withClient(url, (client) => scrubStorageUrls(client, [OWN_BUCKET]));

    expect(await releaseUrl()).toBe(ours);
  });

  it("refuses the whole run when a foreign URL sits in a column no rule covers", async () => {
    const id = await insertUser();
    await withClient(url, (client) =>
      client.query(`UPDATE users SET profile_image_url = $1 WHERE id = $2`, [FOREIGN, id])
    );

    await expect(
      withClient(url, (client) => scrubStorageUrls(client, [OWN_BUCKET]))
    ).rejects.toThrow(/users\.profile_image_url/);
  });

  it("leaves the database untouched when it refuses", async () => {
    const id = await insertUser();
    await withClient(url, (client) =>
      client.query(`UPDATE users SET profile_image_url = $1 WHERE id = $2`, [FOREIGN, id])
    );
    await insertRelease("https://storage.googleapis.com/docuflow-production/installers/setup.exe");

    await expect(
      withClient(url, (client) => scrubStorageUrls(client, [OWN_BUCKET]))
    ).rejects.toThrow();

    expect(await releaseUrl()).toBe(
      "https://storage.googleapis.com/docuflow-production/installers/setup.exe"
    );
  });
});

describe("the keys the restored database names", () => {
  it("resolves an /objects/ path to the object name the bucket holds", () => {
    expect(toObjectName("/objects/uploads/abc", OWN_PRIVATE_DIR)).toBe(".private/uploads/abc");
  });

  it("passes a bare storage key through — a screenshot key is already one", () => {
    expect(toObjectName("screenshots/2026/08/abc.webp", OWN_PRIVATE_DIR)).toBe(
      "screenshots/2026/08/abc.webp"
    );
  });

  it("collects them from every column that holds one", async () => {
    const id = await insertUser();
    await withClient(url, (client) =>
      client.query(
        `INSERT INTO company_documents (id, name, storage_path, uploaded_by_id)
         VALUES ($1, 'Terms', '/objects/uploads/doc-1', $2)`,
        [randomUUID(), id]
      )
    );

    const keys = await withClient(url, (client) => namedStorageKeys(client, OWN_PRIVATE_DIR));

    expect(keys).toContain(".private/uploads/doc-1");
  });

  it("counts a key the destination lacks as dangling", () => {
    const dangling = findDanglingKeys(
      [".private/uploads/doc-1", ".private/uploads/doc-2"],
      [".private/uploads/doc-1"]
    );
    expect(dangling).toEqual([".private/uploads/doc-2"]);
  });

  it("accepts a destination holding more than the database names — objects postdate the export", () => {
    expect(findDanglingKeys([".private/uploads/doc-1"], [".private/uploads/doc-1", "extra"])).toEqual(
      []
    );
  });

  it("reads a manifest as one key per line, ignoring blanks and comments", () => {
    expect(readManifestKeys("a/1\n\n# written by the operator\nb/2\n")).toEqual(["a/1", "b/2"]);
  });
});

describe("the residency guard", () => {
  it("refuses to run inside a Replit development workspace", () => {
    expect(() => assertRehearsalTarget({ REPLIT_DEV_DOMAIN: "x.replit.dev" })).toThrow(
      /development/i
    );
  });

  it("lets a deliberate operator through", () => {
    expect(() =>
      assertRehearsalTarget({ REPLIT_DEV_DOMAIN: "x.replit.dev", ALLOW_DEVELOPMENT_REHEARSAL: "1" })
    ).not.toThrow();
  });

  it("says nothing anywhere else", () => {
    expect(() => assertRehearsalTarget({})).not.toThrow();
  });
});
