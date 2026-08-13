import { Response } from "express";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { config } from "./config";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
} from "./objectAcl";
import type { StoragePort, StoredObjectRef } from "./storagePort";
import { GcsStoragePort } from "./gcsStorage";
import { ReplitStoragePort } from "./replitStorage";

/**
 * The storage this deployment talks to, chosen once by what the environment
 * named. `server/config.ts` selects the provider by whether a credential was
 * supplied rather than by a switch — an environment that names a Google key
 * means it, and one that names none is on Replit App Storage (ADR-0023), whose
 * SDK authenticates itself.
 */
export const storagePort: StoragePort =
  config.objectStorage.provider === "gcs"
    ? new GcsStoragePort()
    : new ReplitStoragePort();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * Raised where the code path requires a URL the client can transfer against
 * directly and the configured provider cannot mint one. ADR-0016 assumed direct
 * signed transfers; App Storage has no signing, so on that provider these
 * callers must proxy through the server instead. Named here so the failure says
 * which provider and why rather than surfacing as a bare SDK error.
 */
export { SignedUrlsUnsupportedError } from "./storagePort";
export type { StoredObjectRef } from "./storagePort";

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    return config.objectStorage.publicSearchPaths;
  }

  getPrivateObjectDir(): string {
    return config.objectStorage.privateDir;
  }

  async searchPublicObject(filePath: string): Promise<StoredObjectRef | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const ref = parseObjectPath(`${searchPath}/${filePath}`);
      if (await storagePort.exists(ref)) {
        return ref;
      }
    }
    return null;
  }

  async downloadObject(ref: StoredObjectRef, res: Response, cacheTtlSec: number = 3600) {
    try {
      const metadata = await storagePort.getMetadata(ref);
      const aclPolicy = await storagePort.getAclPolicy(ref);
      const isPublic = aclPolicy?.visibility === "public";

      // `Content-Length` is only set when the provider reports a size: App
      // Storage does not, and a header asserting the wrong length is worse than
      // an absent one.
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        ...(metadata.size === undefined ? {} : { "Content-Length": String(metadata.size) }),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });

      const stream = storagePort.createReadStream(ref);

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  /** The whole object in memory, for callers that parse rather than stream it. */
  async readObjectBytes(ref: StoredObjectRef): Promise<Buffer> {
    return storagePort.readBytes(ref);
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    return uploadUrlFor(`${privateObjectDir}/uploads/${objectId}`);
  }

  async getPublicUploadURL(): Promise<string> {
    const publicDir = this.getPublicObjectSearchPaths()[0];
    const objectId = randomUUID();
    return uploadUrlFor(`${publicDir}/uploads/${objectId}`);
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObjectRef> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const ref = parseObjectPath(`${entityDir}${entityId}`);
    if (!(await storagePort.exists(ref))) {
      throw new ObjectNotFoundError();
    }
    return ref;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const ref = await this.getObjectEntityFile(normalizedPath);
    await storagePort.setAclPolicy(ref, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredObjectRef;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      aclPolicy: await storagePort.getAclPolicy(objectFile),
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

/**
 * Where a client should PUT one object's bytes.
 *
 * On a provider that can sign, that is storage itself and the bytes never touch
 * this process — ADR-0016's direct transfer. On one that cannot, it is this
 * server, which relays them. The caller cannot tell the difference: both are a
 * URL to PUT the file to, which is what keeps the browser uploader identical on
 * either provider.
 *
 * The relay URL carries a grant rather than a path, so a client cannot choose
 * where its bytes land. See `signUploadGrant`.
 */
async function uploadUrlFor(fullObjectPath: string): Promise<string> {
  const ref = parseObjectPath(fullObjectPath);
  if (storagePort.supportsSignedUrls) {
    return storagePort.signUrl({ ref, method: "PUT", ttlSec: UPLOAD_TTL_SEC });
  }
  return `/api/objects/upload/${signUploadGrant(ref, UPLOAD_TTL_SEC)}`;
}

const UPLOAD_TTL_SEC = 900;

/**
 * A short-lived, tamper-evident permission to write exactly one object.
 *
 * This stands in for what a signed URL gave us for free. The destination is
 * inside the grant and the grant is signed, so the relay endpoint never takes a
 * path from the request: a client that edits either half gets a rejected
 * signature rather than a write somewhere it chose. The desktop signing key is
 * reused because it is already required at boot, already rotatable, and already
 * the thing this server signs short-lived grants with.
 */
export function signUploadGrant(ref: StoredObjectRef, ttlSec: number): string {
  const payload = JSON.stringify({
    b: ref.bucketName,
    o: ref.objectName,
    exp: Date.now() + ttlSec * 1000,
  });
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${uploadGrantSignature(body)}`;
}

/** The ref a grant permits, or null if it is unsigned, altered, or expired. */
export function verifyUploadGrant(grant: string): StoredObjectRef | null {
  const [body, signature] = grant.split(".");
  if (!body || !signature) return null;

  const expected = uploadGrantSignature(body);
  // Both are hex of the same length, so a length mismatch is already a failure
  // and `timingSafeEqual` is safe to reach.
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const { b, o, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof exp !== "number" || Date.now() > exp) return null;
    if (typeof b !== "string" || typeof o !== "string") return null;
    return { bucketName: b, objectName: o };
  } catch {
    return null;
  }
}

function uploadGrantSignature(body: string): string {
  return createHmac("sha256", config.desktopTokens.current.secret)
    .update(body)
    .digest("hex");
}

export function parseObjectPath(path: string): StoredObjectRef {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  return {
    bucketName: pathParts[1],
    objectName: pathParts.slice(2).join("/"),
  };
}

/**
 * Mint a URL the holder can use directly against storage. Only the Google
 * provider can do this; on App Storage it raises `SignedUrlsUnsupportedError`.
 */
export async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT";
  ttlSec: number;
}): Promise<string> {
  return storagePort.signUrl({ ref: { bucketName, objectName }, method, ttlSec });
}
