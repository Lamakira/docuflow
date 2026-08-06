/**
 * In-memory stand-in for `@google-cloud/storage` (ADR-0018: fakes only).
 *
 * `vitest.config.ts` aliases the package to this module, so `server/objectStorage.ts`
 * and `server/objectAcl.ts` get these classes instead of the real SDK — the stub sits
 * at the provider boundary, application code is untouched.
 *
 * Only the surface the server actually uses is implemented: `bucket().file()`,
 * `exists`, `getMetadata`, `setMetadata`, `createReadStream`, and `download`.
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

export function resetGcs(): void {
  objects.clear();
}
