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
import { and, eq } from "drizzle-orm";
import { companyDocuments, files, objectUploadSlots, timeEntryScreenshots } from "@shared/schema";
import { db } from "./db";
import { currentWorkspaceContext, inWorkspace, requireWorkspaceContext } from "./workspaceContext";

/**
 * Types a browser may render inline on this origin: none of them can run a
 * script. `image/svg+xml` and anything HTML-like are left out on purpose.
 */
const INLINE_SAFE_TYPE =
  /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|text\/plain|audio\/[\w.+-]+|video\/[\w.+-]+)$/;

/** One `type/subtype`, nothing else: no list, no second value a browser could pick instead. */
const MIME_ESSENCE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/**
 * The headers a stored object is served with, kept from running as a page of
 * this app (#329). The content type is the uploader's word, and since a
 * browser-loaded GET carries the session cookie, an HTML or SVG upload opened
 * by link would otherwise run with the viewer's session on the app's own
 * origin.
 *
 * Only the parsed essence is sent, never the stored value: a browser reading
 * `application/pdf,text/html` takes the last type, so judging the first one and
 * echoing the rest would let the page through. A value that is not exactly one
 * type becomes `application/octet-stream`. Anything outside the inline-safe list
 * is forced to download and sandboxed should a browser render it anyway; the
 * safe types are sandboxed too, except PDF, whose built-in viewers refuse to
 * load in a sandboxed document, so it is only kept from being framed elsewhere.
 */
export function storedContentHeaders(
  storedType: string | undefined,
  disposition: string | number | string[] | undefined,
): Record<string, string> {
  const [rawEssence, ...params] = (storedType ?? "").split(";");
  const essence = rawEssence.trim().toLowerCase();
  const type = MIME_ESSENCE.test(essence) ? essence : "application/octet-stream";
  // The one parameter worth keeping, and only in a shape that cannot carry another type.
  const charset = params
    .map((param) => /^\s*charset=([a-z0-9._:-]+)\s*$/i.exec(param)?.[1])
    .find(Boolean);
  if (INLINE_SAFE_TYPE.test(type)) {
    return {
      "Content-Type": charset && type === "text/plain" ? `${type}; charset=${charset}` : type,
      "Content-Security-Policy":
        type === "application/pdf"
          ? "frame-ancestors 'self'"
          : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    };
  }
  const current = typeof disposition === "string" ? disposition : "";
  return {
    "Content-Type": type,
    "Content-Disposition": current.startsWith("attachment")
      ? current
      : current.replace(/^inline/, "attachment") || "attachment",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}

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
        ...storedContentHeaders(metadata.contentType, res.getHeader("Content-Disposition")),
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

  /**
   * Where to PUT a new private object, alongside the canonical `/objects/…`
   * path it will be readable at. The path is returned explicitly because it can
   * no longer be derived from the URL: on a provider without signed URLs the
   * URL is a relative relay endpoint carrying an opaque grant, not the object's
   * address (ADR-0023). Callers persist `objectPath` and never parse the URL.
   */
  async getObjectEntityUpload(): Promise<{ uploadURL: string; objectPath: string }> {
    const privateObjectDir = this.getPrivateObjectDir();
    const key = newWorkspaceFileKey();
    return {
      uploadURL: await uploadUrlFor(`${privateObjectDir}/${key}`),
      objectPath: `/objects/${key}`,
    };
  }

  /**
   * Where to PUT a new public object, alongside the `/public-objects/…` path it
   * will be served from. Same contract as `getObjectEntityUpload`: the path is
   * explicit because the URL may be a relay endpoint rather than the object's
   * address.
   */
  async getPublicUpload(): Promise<{ uploadURL: string; publicPath: string }> {
    const publicDir = this.getPublicObjectSearchPaths()[0];
    const key = newWorkspaceFileKey();
    return {
      uploadURL: await uploadUrlFor(`${publicDir}/${key}`),
      publicPath: `/public-objects/${key}`,
    };
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObjectRef> {
    const ref = objectRefFromEntityPath(objectPath);
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

    assertObjectInActiveWorkspace(normalizedPath);
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
 * A new File object's key (ADR-0012): immutable, ID-only, and prefixed by the
 * Active Workspace. The database row stays the key authority, so legacy
 * `uploads/<uuid>` keys keep resolving until the R2 move copies them (#59).
 */
function newWorkspaceFileKey(): string {
  const { workspaceId } = requireWorkspaceContext();
  return `ws/${workspaceId}/files/${randomUUID()}/${randomUUID()}`;
}

/** The Workspace an ADR-0012 key belongs to, or null for a legacy key. */
export function objectPathWorkspaceId(objectPath: string): string | null {
  const match = /^\/(?:objects|public-objects)\/ws\/([^/]+)\//.exec(objectPath);
  return match ? match[1] : null;
}

/**
 * Knowing another Workspace's key is not authority to attach its object here.
 * Legacy keys carry no Workspace and pass; their rows remain the only guard.
 */
export function assertObjectInActiveWorkspace(objectPath: string): void {
  const owner = objectPathWorkspaceId(objectPath);
  if (owner !== null && owner !== currentWorkspaceContext()?.workspaceId) {
    throw new ObjectNotFoundError();
  }
}

/** An agent screenshot's key (ADR-0012), under the Workspace that owns its row. */
export function workspaceScreenshotKey(workspaceId: string, screenshotId: string, ext: string): string {
  return `ws/${workspaceId}/agent-screenshots/${screenshotId}.${ext}`;
}

/**
 * Whether the Active Workspace owns a private object. A prefixed key says so
 * itself; a legacy key belongs where a row in this Workspace references it.
 */
export async function isObjectInActiveWorkspace(objectPath: string): Promise<boolean> {
  const ctx = currentWorkspaceContext();
  if (!ctx) return false;
  const owner = objectPathWorkspaceId(objectPath);
  if (owner !== null) return owner === ctx.workspaceId;
  const referenced = await Promise.all([
    db.select({ id: files.id }).from(files)
      .where(and(inWorkspace(files), eq(files.storagePath, objectPath))).limit(1),
    db.select({ id: companyDocuments.id }).from(companyDocuments)
      .where(and(inWorkspace(companyDocuments), eq(companyDocuments.storagePath, objectPath))).limit(1),
    db.select({ id: objectUploadSlots.id }).from(objectUploadSlots)
      .where(and(inWorkspace(objectUploadSlots), eq(objectUploadSlots.objectPath, objectPath))).limit(1),
    db.select({ id: timeEntryScreenshots.id }).from(timeEntryScreenshots)
      .where(and(inWorkspace(timeEntryScreenshots), eq(timeEntryScreenshots.storageKey, objectPath))).limit(1),
  ]);
  return referenced.some((rows) => rows.length > 0);
}

/**
 * Database-row object path (`/objects/…`) to a storage ref. Does not check
 * that the object exists — purge and finalize verification each do that
 * themselves.
 */
export function objectRefFromEntityPath(objectPath: string): StoredObjectRef {
  if (!objectPath.startsWith("/objects/")) {
    throw new ObjectNotFoundError();
  }
  const parts = objectPath.slice(1).split("/");
  if (parts.length < 2) {
    throw new ObjectNotFoundError();
  }
  const entityId = parts.slice(1).join("/");
  let entityDir = config.objectStorage.privateDir;
  if (!entityDir.endsWith("/")) {
    entityDir = `${entityDir}/`;
  }
  return parseObjectPath(`${entityDir}${entityId}`);
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
