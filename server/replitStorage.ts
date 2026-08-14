/**
 * `StoragePort` over Replit App Storage (ADR-0023).
 *
 * The SDK authenticates itself from `REPL_IDENTITY` against the connectors
 * host — there is no credential variable to supply, which is why
 * `server/config.ts` asks for a bucket and not a key on this provider. Probed
 * 2026-08-13: the `@google-cloud/storage` client cannot reach an App Storage
 * bucket at all ("Could not load the default credentials"), so this is not an
 * alternative path to the same bucket, it is the only one.
 *
 * Two properties of the SDK shape everything here. It has **no signed URLs**, so
 * `supportsSignedUrls` is false and ADR-0016's direct client-to-bucket transfers
 * do not hold on this provider — every byte moves through the server. And it has
 * **no object metadata API**, so the ACL policy `objectAcl.ts` used to keep in
 * GCS custom metadata is kept beside the object instead, as a sibling
 * `.acl.json`. That is a deliberate stopgap: ADR-0012 makes the database row the
 * authority over object identity, so the policy's eventual home is a table, and
 * a sibling object costs a second round trip per access check and has no
 * atomicity with the object it guards.
 */

import { Client } from "@replit/object-storage";
import { Readable } from "stream";
import type {
  ListRequest,
  ListedObject,
  ObjectMetadata,
  SignUrlRequest,
  StoragePort,
  StoredObjectRef,
} from "./storagePort";
import { SignedUrlsUnsupportedError } from "./storagePort";
import type { ObjectAclPolicy } from "./objectAcl";

/** Suffix of the sibling object holding an object's ACL policy. */
const ACL_SUFFIX = ".acl.json";

/**
 * The SDK returns `{ ok, value, error }` rather than throwing. Unwrapping in one
 * place keeps every method below reading like the operation it performs, and
 * makes the provider's error the cause of ours rather than a bare rejection.
 */
function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
  what: string
): T {
  if (!result.ok) {
    throw new Error(`Replit App Storage: ${what} failed — ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result.value;
}

export class ReplitStoragePort implements StoragePort {
  readonly providerName = "Replit App Storage";

  /** The SDK cannot sign. Callers must proxy transfers through the server. */
  readonly supportsSignedUrls = false;

  private readonly clients = new Map<string, Client>();

  /**
   * One client per bucket, as the SDK's own guidance requires. Bucket names
   * reach us inside `PRIVATE_OBJECT_DIR` and `PUBLIC_OBJECT_SEARCH_PATHS`, both
   * of which Replit injects when App Storage is enabled, so the name in a ref is
   * already this App's bucket rather than something a caller chose.
   */
  private clientFor(bucketName: string): Client {
    let client = this.clients.get(bucketName);
    if (!client) {
      client = new Client({ bucketId: bucketName });
      this.clients.set(bucketName, client);
    }
    return client;
  }

  async exists(ref: StoredObjectRef): Promise<boolean> {
    const result = await this.clientFor(ref.bucketName).exists(ref.objectName);
    return unwrap(result, `exists(${ref.objectName})`);
  }

  /**
   * The listing ADR-0023's exit path is built on. The SDK reports a name and
   * nothing else — no size — so a reconciliation against this provider compares
   * which keys are present and cannot compare bytes; ADR-0022's manifest carries
   * the sizes and checksums, taken at the source, for exactly that reason.
   *
   * The `.acl.json` siblings this adapter writes beside each object are its own
   * bookkeeping rather than workspace content, and they are filtered out here so
   * that a copy reconciliation does not report every policy file as an object
   * the database failed to name.
   */
  async list(request: ListRequest): Promise<ListedObject[]> {
    const result = await this.clientFor(request.bucketName).list(
      request.prefix ? { prefix: request.prefix } : undefined
    );
    const objects = unwrap(result, `list(${request.prefix ?? "*"})`);
    return objects
      .filter((object) => !object.name.endsWith(ACL_SUFFIX))
      .map((object) => ({ objectName: object.name }));
  }

  /**
   * The SDK reports neither content type nor size, so both are absent and the
   * download path falls back to `application/octet-stream` with no
   * `Content-Length`. Storing the content type alongside the ACL policy is the
   * obvious fix and belongs with the move of that policy into the database.
   */
  async getMetadata(_ref: StoredObjectRef): Promise<ObjectMetadata> {
    return {};
  }

  async readBytes(ref: StoredObjectRef): Promise<Buffer> {
    const result = await this.clientFor(ref.bucketName).downloadAsBytes(ref.objectName);
    const value = unwrap(result, `readBytes(${ref.objectName})`);
    // The SDK hands back an array of chunks; callers want one buffer.
    return Array.isArray(value) ? Buffer.concat(value) : (value as Buffer);
  }

  createReadStream(ref: StoredObjectRef): Readable {
    return this.clientFor(ref.bucketName).downloadAsStream(ref.objectName);
  }

  async writeBytes(ref: StoredObjectRef, contents: Buffer): Promise<void> {
    const result = await this.clientFor(ref.bucketName).uploadFromBytes(
      ref.objectName,
      contents
    );
    unwrap(result, `writeBytes(${ref.objectName})`);
  }

  async getAclPolicy(ref: StoredObjectRef): Promise<ObjectAclPolicy | null> {
    const aclRef = { ...ref, objectName: `${ref.objectName}${ACL_SUFFIX}` };
    const client = this.clientFor(aclRef.bucketName);

    // An object written before this provider, or by a path that does not set a
    // policy, simply has no sibling. That is "no policy", not a failure —
    // `canAccessObject` already treats a null policy as deny.
    const present = await client.exists(aclRef.objectName);
    if (!present.ok || !present.value) return null;

    const result = await client.downloadAsText(aclRef.objectName);
    if (!result.ok) return null;
    try {
      return JSON.parse(result.value) as ObjectAclPolicy;
    } catch {
      return null;
    }
  }

  async setAclPolicy(ref: StoredObjectRef, policy: ObjectAclPolicy): Promise<void> {
    const aclRef = { ...ref, objectName: `${ref.objectName}${ACL_SUFFIX}` };
    const result = await this.clientFor(aclRef.bucketName).uploadFromText(
      aclRef.objectName,
      JSON.stringify(policy)
    );
    unwrap(result, `setAclPolicy(${ref.objectName})`);
  }

  async signUrl(_request: SignUrlRequest): Promise<string> {
    throw new SignedUrlsUnsupportedError(this.providerName);
  }
}
