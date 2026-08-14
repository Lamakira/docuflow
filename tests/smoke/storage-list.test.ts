import { afterEach, describe, expect, it } from "vitest";
import { putObject, resetGcs } from "../fakes/gcs";

/**
 * `list` is the one port operation no request needs and ADR-0023 cannot do
 * without. That decision adopts Replit App Storage on the condition that an exit
 * can be demonstrated, and the demonstration it names is "list-then-download, a
 * script DocuFlow writes and owns". A port with no list makes that exit
 * unwritable, so the capability is part of the seam rather than of whichever
 * script happens to need it.
 *
 * It is also what reconciles a snapshot copy: ADR-0022's manifest is compared
 * against what the destination actually holds, and the dangling-key verifier
 * asks the same question from the database's side.
 *
 * The suite runs against the GCS fake because that is the provider a test can
 * stand up. `ReplitStoragePort.list` maps the SDK's own list and is covered by
 * neither this suite nor any other — the same gap PR #72 recorded for the rest
 * of that adapter, and it is honest to name it rather than imply coverage.
 */

const BUCKET = "test-bucket";

async function port() {
  const { storagePort } = await import("../../server/objectStorage");
  return storagePort;
}

afterEach(() => resetGcs());

describe("listing what a bucket holds", () => {
  it("returns every object under a prefix, by name", async () => {
    putObject(`${BUCKET}/.private/uploads/a`, "a");
    putObject(`${BUCKET}/.private/uploads/b`, "bb");

    const listed = await (await port()).list({ bucketName: BUCKET, prefix: ".private/uploads/" });

    expect(listed.map((entry) => entry.objectName).sort()).toEqual([
      ".private/uploads/a",
      ".private/uploads/b",
    ]);
  });

  it("leaves out what the prefix excludes", async () => {
    putObject(`${BUCKET}/.private/uploads/a`, "a");
    putObject(`${BUCKET}/public/logo.png`, "png");

    const listed = await (await port()).list({ bucketName: BUCKET, prefix: ".private/" });

    expect(listed.map((entry) => entry.objectName)).toEqual([".private/uploads/a"]);
  });

  it("lists the whole bucket when no prefix is given", async () => {
    putObject(`${BUCKET}/.private/uploads/a`, "a");
    putObject(`${BUCKET}/public/logo.png`, "png");

    const listed = await (await port()).list({ bucketName: BUCKET });

    expect(listed).toHaveLength(2);
  });

  it("reports each object's size, which a copy manifest reconciles on", async () => {
    putObject(`${BUCKET}/.private/uploads/a`, "12345");

    const [entry] = await (await port()).list({ bucketName: BUCKET, prefix: ".private/" });

    expect(entry.size).toBe(5);
  });

  it("is empty rather than an error when the prefix holds nothing", async () => {
    expect(await (await port()).list({ bucketName: BUCKET, prefix: "nothing/here/" })).toEqual([]);
  });
});
