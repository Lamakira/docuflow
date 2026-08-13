/**
 * `StoragePort` over Google Cloud Storage — the behaviour this repository had
 * before ADR-0023, unchanged and now behind the seam.
 *
 * Kept because it is still reachable: naming `GCS_SERVICE_ACCOUNT_KEY` or
 * `GOOGLE_APPLICATION_CREDENTIALS` selects this provider, the release scripts
 * publish installers to a real bucket, and it is the only implementation that
 * can sign. ADR-0021 treats the Dockerfile as portability insurance; an
 * implementation that needs no platform to authenticate is the storage half of
 * the same idea.
 */

import { Storage } from "@google-cloud/storage";
import type { Readable } from "stream";
import { config } from "./config";
import type {
  ObjectMetadata,
  SignUrlRequest,
  StoragePort,
  StoredObjectRef,
} from "./storagePort";
import type { ObjectAclPolicy } from "./objectAcl";

/** Where `objectAcl.ts` has always kept the policy: custom object metadata. */
const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

/**
 * The storage action each signed method needs granted. Only the two methods
 * callers actually sign for: a V4 signature binds the method, so an entry no
 * caller uses is a promise nothing has ever verified.
 */
const SIGNING_ACTIONS = {
  GET: "read",
  PUT: "write",
} as const;

/**
 * Client for the configured service account. An inline key is used when set;
 * otherwise the client reads the key file named by
 * `GOOGLE_APPLICATION_CREDENTIALS`. This provider is only selected when one of
 * those exists, so the client is never left to discover at the first signature
 * that it has no identity — and either way that identity is a service account,
 * because signing a URL needs a key that can sign.
 */
export const objectStorageClient = new Storage({
  ...(config.objectStorage.projectId ? { projectId: config.objectStorage.projectId } : {}),
  ...(config.objectStorage.serviceAccount
    ? {
        credentials: {
          client_email: config.objectStorage.serviceAccount.clientEmail,
          private_key: config.objectStorage.serviceAccount.privateKey,
        },
      }
    : {}),
});

export class GcsStoragePort implements StoragePort {
  readonly providerName = "Google Cloud Storage";
  readonly supportsSignedUrls = true;

  private file(ref: StoredObjectRef) {
    return objectStorageClient.bucket(ref.bucketName).file(ref.objectName);
  }

  async exists(ref: StoredObjectRef): Promise<boolean> {
    const [exists] = await this.file(ref).exists();
    return exists;
  }

  async getMetadata(ref: StoredObjectRef): Promise<ObjectMetadata> {
    const [metadata] = await this.file(ref).getMetadata();
    return {
      contentType: metadata.contentType,
      size: metadata.size === undefined ? undefined : Number(metadata.size),
    };
  }

  async readBytes(ref: StoredObjectRef): Promise<Buffer> {
    const [contents] = await this.file(ref).download();
    return contents;
  }

  createReadStream(ref: StoredObjectRef): Readable {
    return this.file(ref).createReadStream();
  }

  async writeBytes(
    ref: StoredObjectRef,
    contents: Buffer,
    options?: { contentType?: string }
  ): Promise<void> {
    await this.file(ref).save(contents, {
      ...(options?.contentType ? { contentType: options.contentType } : {}),
    });
  }

  async getAclPolicy(ref: StoredObjectRef): Promise<ObjectAclPolicy | null> {
    const [metadata] = await this.file(ref).getMetadata();
    const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
    if (!aclPolicy) return null;
    return JSON.parse(aclPolicy as string) as ObjectAclPolicy;
  }

  async setAclPolicy(ref: StoredObjectRef, policy: ObjectAclPolicy): Promise<void> {
    const file = this.file(ref);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Object not found: ${ref.objectName}`);
    }
    await file.setMetadata({
      metadata: { [ACL_POLICY_METADATA_KEY]: JSON.stringify(policy) },
    });
  }

  /**
   * A V4 signed URL the holder uses directly against storage, so large transfers
   * never pass through this process.
   *
   * Content type is deliberately left out of the signature: browsers upload with
   * whatever type the picked file has, and signing one would force every client
   * to send exactly that header.
   */
  async signUrl({ ref, method, ttlSec }: SignUrlRequest): Promise<string> {
    const [signedURL] = await this.file(ref).getSignedUrl({
      version: "v4",
      action: SIGNING_ACTIONS[method],
      expires: Date.now() + ttlSec * 1000,
    });
    return signedURL;
  }
}
