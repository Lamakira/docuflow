/**
 * In-memory stand-in for `@google-cloud/storage` (ADR-0018: fakes only).
 *
 * `vitest.config.ts` aliases the package to this module, so `server/objectStorage.ts`
 * and `server/objectAcl.ts` get these classes instead of the real SDK — the stub sits
 * at the provider boundary, application code is untouched.
 *
 * Only the surface the server actually uses is implemented: `bucket().file()`,
 * `exists`, `getMetadata`, `setMetadata`, `createReadStream`, `download`, and
 * `getSignedUrl` — which mints the upload and download URLs the server hands to
 * clients, deterministic here so a suite can assert the exact string.
 */

import { Readable } from "stream";

interface StoredObject {
  data: Buffer;
  contentType: string;
  /** Custom metadata — where objectAcl.ts stores `custom:aclPolicy`. */
  metadata: Record<string, string>;
}

const objects = new Map<string, StoredObject>();

const key = (bucket: string, name: string) => `${bucket}/${name}`;

/** Storage origin every minted URL sits under, so no suite hard-codes a host. */
export const FAKE_STORAGE_ORIGIN = "https://storage.googleapis.com";

/**
 * The actions `server/objectStorage.ts` signs for, mapped from HTTP methods —
 * the same two it narrowed `SIGNING_ACTIONS` to, for the same reason: an action
 * no caller signs for is a promise nothing has ever verified.
 */
export type SignedUrlAction = "read" | "write";

export interface SignedUrlRequest {
  bucket: string;
  object: string;
  action: SignedUrlAction;
  /** Expiry the server asked for, as an ISO instant. */
  expiresAt: string;
}

const signedUrlRequests: SignedUrlRequest[] = [];

/** The exact URL this fake mints for `<bucket>/<object name>`. */
export function fakeSignedUrl(objectPath: string, action: SignedUrlAction = "write"): string {
  return `${FAKE_STORAGE_ORIGIN}/${objectPath}?fake-signature=${action}`;
}

/**
 * Matcher for a minted URL whose object name is only known by shape.
 * `objectPattern` is regex source, matched against `<bucket>/<object name>`.
 */
export function signedUrlPattern(
  objectPattern: string,
  action: SignedUrlAction = "write"
): RegExp {
  const prefix = FAKE_STORAGE_ORIGIN.replace(/[.]/g, "\\.");
  return new RegExp(`^${prefix}/${objectPattern}\\?fake-signature=${action}$`);
}

export class File {
  constructor(
    public readonly bucketName: string,
    public readonly name: string
  ) {}

  private get stored(): StoredObject | undefined {
    return objects.get(key(this.bucketName, this.name));
  }

  async exists(): Promise<[boolean]> {
    return [this.stored !== undefined];
  }

  async getMetadata(): Promise<[Record<string, unknown>]> {
    const stored = this.stored;
    if (!stored) throw new Error(`fake-gcs: object not found: ${this.name}`);
    return [
      {
        name: this.name,
        bucket: this.bucketName,
        contentType: stored.contentType,
        size: String(stored.data.length),
        metadata: { ...stored.metadata },
      },
    ];
  }

  async setMetadata(update: { metadata?: Record<string, string> }): Promise<void> {
    const stored = this.stored;
    if (!stored) throw new Error(`fake-gcs: object not found: ${this.name}`);
    stored.metadata = { ...stored.metadata, ...(update.metadata ?? {}) };
  }

  createReadStream(): Readable {
    const stored = this.stored;
    if (!stored) {
      const stream = new Readable({ read() {} });
      process.nextTick(() =>
        stream.destroy(new Error(`fake-gcs: object not found: ${this.name}`))
      );
      return stream;
    }
    return Readable.from([stored.data]);
  }

  async download(): Promise<[Buffer]> {
    const stored = this.stored;
    if (!stored) throw new Error(`fake-gcs: object not found: ${this.name}`);
    return [stored.data];
  }

  /**
   * Writes an object directly, which is how the server stores bytes it already
   * holds. It used to mint a signed URL and PUT to that instead — a round trip
   * out to storage and back for something already in memory — so this surface
   * had no stand-in until the storage port removed that detour.
   *
   * Existing custom metadata survives a write, matching the real client: `save`
   * replaces contents, and an ACL policy set afterwards is not erased by a later
   * overwrite of the same object.
   */
  async save(
    body: string | Buffer,
    options: { contentType?: string } = {}
  ): Promise<void> {
    const previous = this.stored;
    objects.set(key(this.bucketName, this.name), {
      data: Buffer.isBuffer(body) ? body : Buffer.from(body),
      contentType: options.contentType ?? previous?.contentType ?? "application/octet-stream",
      metadata: previous?.metadata ?? {},
    });
  }

  /**
   * Real V4 signing needs a service-account key and produces a URL nothing can
   * predict; this records what was asked for and returns a stable stand-in with
   * the same origin and path, which is the part the server's own code reads back.
   */
  async getSignedUrl(options: {
    version?: string;
    action: SignedUrlAction;
    expires: string | number | Date;
  }): Promise<[string]> {
    signedUrlRequests.push({
      bucket: this.bucketName,
      object: this.name,
      action: options.action,
      expiresAt: new Date(options.expires).toISOString(),
    });
    return [fakeSignedUrl(key(this.bucketName, this.name), options.action)];
  }
}

class Bucket {
  constructor(public readonly name: string) {}
  file(objectName: string): File {
    return new File(this.name, objectName);
  }
}

export class Storage {
  constructor(_options?: unknown) {}
  bucket(name: string): Bucket {
    return new Bucket(name);
  }
}

// ─── Test control surface ───

/** Seed an object so the server can find/stream it. `path` is `bucket/object/name`. */
export function putObject(
  path: string,
  body: string | Buffer,
  options: { contentType?: string; metadata?: Record<string, string> } = {}
): void {
  if (!path.includes("/")) {
    throw new Error(`fake-gcs: path must be "bucket/object": ${path}`);
  }
  objects.set(path, {
    data: Buffer.isBuffer(body) ? body : Buffer.from(body),
    contentType: options.contentType ?? "application/octet-stream",
    metadata: options.metadata ?? {},
  });
}

/** The custom metadata currently attached to an object (undefined when absent). */
export function objectMetadata(path: string): Record<string, string> | undefined {
  return objects.get(path)?.metadata;
}

/** Every URL the server signed, in call order. */
export function signedUrlCalls(): SignedUrlRequest[] {
  return signedUrlRequests;
}

export function resetGcs(): void {
  objects.clear();
  signedUrlRequests.length = 0;
}
