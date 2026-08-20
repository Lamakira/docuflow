/**
 * The seam between this application and whatever holds its objects.
 *
 * Until now `server/objectStorage.ts` spoke `@google-cloud/storage` directly and
 * passed that SDK's `File` around as the currency of the module — into
 * `objectAcl.ts`, out to `routes.ts`, and back again. That made the provider a
 * type, not a dependency, so replacing it meant touching every caller.
 *
 * This port is the smallest surface those callers actually use, expressed in
 * terms the application owns: a `StoredObjectRef` is a bucket name and an object
 * name, nothing more. ADR-0012 makes the database row the authority over object
 * identity and ADR-0022 makes the bucket name configuration rather than
 * identity, so a bare `{bucketName, objectName}` is a complete handle — there is
 * no provider state worth carrying alongside it.
 *
 * ADR-0023 puts this environment's objects in Replit App Storage. That SDK has
 * no `File`, no metadata API, and no signed URLs, so the port deliberately does
 * not model any of them as provider objects: metadata is a plain record, ACL
 * policy is fetched and stored through the port rather than through provider
 * metadata, and `signUrl` is declared optional because an implementation that
 * cannot sign must be able to say so at the type level rather than at the first
 * upload.
 */

import type { Readable } from "stream";
import type { ObjectAclPolicy } from "./objectAcl";

/** A complete handle to one object. See the note above on why this is enough. */
export interface StoredObjectRef {
  bucketName: string;
  objectName: string;
}

/**
 * The two fields the download path sets response headers from. Deliberately not
 * the provider's full metadata: everything else it returns is unused, and
 * modelling it would re-create the coupling this port exists to remove.
 */
export interface ObjectMetadata {
  contentType?: string;
  /** Bytes. Absent when the provider does not report it. */
  size?: number;
}

export interface SignUrlRequest {
  ref: StoredObjectRef;
  method: "GET" | "PUT";
  ttlSec: number;
}

/** Which objects to enumerate. No prefix means the whole bucket. */
export interface ListRequest {
  bucketName: string;
  prefix?: string;
}

/**
 * One object as a listing reports it. The name is what a manifest and a
 * database row are compared on; the size is what reconciles a copy, and is
 * absent on a provider that does not report it — the Replit SDK's listing
 * carries a name and nothing else.
 */
export interface ListedObject {
  objectName: string;
  size?: number;
}

/**
 * Raised by an implementation that cannot mint signed URLs, so the caller fails
 * with a named reason rather than a provider stack trace. Callers that must work
 * on every provider should check `supportsSignedUrls` instead of catching this.
 */
export class SignedUrlsUnsupportedError extends Error {
  constructor(provider: string) {
    super(
      `${provider} cannot mint signed URLs. Uploads and downloads must be ` +
        `proxied through the server on this provider.`
    );
    this.name = "SignedUrlsUnsupportedError";
    Object.setPrototypeOf(this, SignedUrlsUnsupportedError.prototype);
  }
}

export interface StoragePort {
  /** Name for the provider, used in errors and the boot line. */
  readonly providerName: string;

  /**
   * Whether `signUrl` will succeed. False means the client must not be handed a
   * URL to transfer against directly — ADR-0016's direct signed transfers do not
   * hold on this provider, and every byte moves through the server instead.
   */
  readonly supportsSignedUrls: boolean;

  exists(ref: StoredObjectRef): Promise<boolean>;

  /**
   * What the bucket holds, by name. No request path needs this and ADR-0023
   * cannot do without it: that decision adopts a Replit-provided capability only
   * where an exit can be demonstrated, and the exit it names is list-then-
   * download. A port that cannot enumerate makes the exit unwritable, so this
   * belongs to the seam rather than to whichever script reaches for it — and the
   * same call reconciles ADR-0022's copy manifest against the destination.
   */
  list(request: ListRequest): Promise<ListedObject[]>;

  /**
   * Remove one object. Missing objects are a successful delete: purge is
   * idempotent, and a row whose bytes were already gone must still be able to
   * finish the cascade.
   */
  delete(ref: StoredObjectRef): Promise<void>;

  getMetadata(ref: StoredObjectRef): Promise<ObjectMetadata>;

  /**
   * The whole object in memory. Correct for documents and screenshots, which are
   * bounded; `createReadStream` is what the installer path wants.
   */
  readBytes(ref: StoredObjectRef): Promise<Buffer>;

  /**
   * A stream of the object's bytes. An implementation whose provider has no
   * streaming read may buffer and wrap, but the memory cost of doing so belongs
   * to that implementation rather than to every caller.
   */
  createReadStream(ref: StoredObjectRef): Readable;

  writeBytes(
    ref: StoredObjectRef,
    contents: Buffer,
    options?: { contentType?: string }
  ): Promise<void>;

  /**
   * ACL policy for one object. Where this is stored is the implementation's
   * business: GCS keeps it in custom object metadata, and a provider without a
   * metadata API has to keep it somewhere else.
   */
  getAclPolicy(ref: StoredObjectRef): Promise<ObjectAclPolicy | null>;

  setAclPolicy(ref: StoredObjectRef, policy: ObjectAclPolicy): Promise<void>;

  /** Throws `SignedUrlsUnsupportedError` when `supportsSignedUrls` is false. */
  signUrl(request: SignUrlRequest): Promise<string>;
}
