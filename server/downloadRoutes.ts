/**
 * Desktop installer distribution endpoints.
 *
 * Installers live in this environment's own bucket under
 * `<public dir>/installers/<version>/<filename>`. Bytes never cross the server:
 * downloads redirect to a signed GET, publishing PUTs to a signed URL. This is
 * what keeps 65-95 MB installers clear of Autoscale's 32 MiB request/response cap.
 *
 * Public endpoints (no auth required):
 *   GET /downloads/availability
 *     → { windows: bool, macos: bool, linux: bool } — a platform is available
 *       when its latest row is in our own bucket AND the object exists there
 *
 *   GET /downloads/:platform
 *     → 302 to a 15-min signed GET URL for the latest installer
 *     → 404 JSON when nothing is published for that platform (or the row points
 *       outside this environment's bucket)
 *
 *   GET /api/downloads/desktop/latest?platform=windows|macos|linux
 *     → 302 to /downloads/:platform (the raw object is private)
 *     → with ?format=json → returns metadata object (no redirect)
 *
 *   GET /api/downloads/desktop/versions
 *     → JSON array of all published releases, newest first
 *
 * Internal endpoints (guarded by DESKTOP_RELEASE_CI_TOKEN):
 *   POST /api/internal/desktop-releases/upload-url
 *     → { platform, version, filename, fileSize, sha256 } → { uploadUrl, storageUrl, expiresAt }
 *       uploadUrl is a signed PUT (15 min); the client PUTs the file straight to storage.
 *
 *   POST /api/internal/desktop-releases
 *     → registers the release and marks it latest for its platform, once the
 *       storageUrl is in our own bucket and the object exists.
 *
 * Per-platform independence:
 *   Each platform (windows / macos / linux) has exactly one is_latest=true row
 *   at any time. Publishing Windows does not affect macOS or Linux rows.
 */

import { type Express, type Request, type Response } from "express";
import { db } from "./db";
import { desktopReleases } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { config, desktopReleaseCiToken } from "./config";
import { signObjectURL, parseObjectPath, storagePort, type StoredObjectRef } from "./objectStorage";

const VALID_PLATFORMS = ["windows", "macos", "linux"] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

// Semver-ish: allow "0.1.6", "1.0.0-beta.1", "2.0.0-rc.3"
const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
// Reasonable filename: printable ASCII, no path traversal
const FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

const STORAGE_URL_PREFIX = "https://storage.googleapis.com/";
const SIGNED_URL_TTL_SEC = 900; // 15 minutes

function isCiAuthorized(req: Request): boolean {
  const token = desktopReleaseCiToken();
  if (!token) return false;
  const auth = req.headers.authorization;
  return typeof auth === "string" && auth === `Bearer ${token}`;
}

/** Buckets this environment owns: the private dir's and every public search path's. */
function ownBucketNames(): Set<string> {
  const names = new Set<string>();
  for (const dir of [config.objectStorage.privateDir, ...config.objectStorage.publicSearchPaths]) {
    if (!dir) continue;
    try {
      names.add(parseObjectPath(dir).bucketName);
    } catch {
      // A malformed entry owns nothing.
    }
  }
  return names;
}

/**
 * The storage ref behind a stored `https://storage.googleapis.com/<bucket>/<object>`
 * URL, or null when the URL is not that form or names a bucket this environment
 * does not own. ADR-0018: no production URL of another environment is followed,
 * so a foreign bucket is treated exactly like a missing release.
 */
function ownBucketRef(storageUrl: string | null | undefined): StoredObjectRef | null {
  if (!storageUrl?.startsWith(STORAGE_URL_PREFIX)) return null;
  let parts: string[];
  try {
    parts = new URL(storageUrl).pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.length < 2) return null;
  const [bucketName, ...rest] = parts;
  if (!ownBucketNames().has(bucketName)) return null;
  return { bucketName, objectName: rest.join("/") };
}

/** The installers directory inside the first public search path, as a bucket + prefix. */
function installersPrefix(): { bucketName: string; prefix: string } | null {
  const [first] = config.objectStorage.publicSearchPaths;
  if (!first) return null;
  const { bucketName, objectName } = parseObjectPath(first);
  const base = objectName.replace(/\/+$/, "");
  return { bucketName, prefix: base ? `${base}/installers` : "installers" };
}

/** Shared validation of the fields every release route takes; returns an error message or null. */
function releaseFieldError(version: string, platform: string, filename: string): string | null {
  if (!VALID_PLATFORMS.includes(platform as Platform)) return "Invalid platform";
  if (!VERSION_RE.test(version)) return "Invalid version format (expected semver)";
  if (!FILENAME_RE.test(filename)) return "Invalid filename";
  return null;
}

export function registerDownloadRoutes(app: Express): void {

  // ── Public: per-platform availability ────────────────────────────────────
  // Returns { windows: bool, macos: bool, linux: bool }.
  // A platform is "available" when its is_latest row is in our own bucket AND
  // the object is actually there.
  app.get("/downloads/availability", async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          platform: desktopReleases.platform,
          storageUrl: desktopReleases.storageUrl,
        })
        .from(desktopReleases)
        .where(eq(desktopReleases.isLatest, true));

      const result: Record<string, boolean> = { windows: false, macos: false, linux: false };
      for (const row of rows) {
        if (!(row.platform in result)) continue;
        const ref = ownBucketRef(row.storageUrl);
        result[row.platform] = ref !== null && (await storagePort.exists(ref));
      }
      return res.json(result);
    } catch (err) {
      console.error("[downloadRoutes] Error checking availability:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Public: serve installer file ──────────────────────────────────────────
  // Looks up the current latest row, signs a 15-min GET for its object and
  // redirects there, so the download goes straight from storage.
  for (const platform of VALID_PLATFORMS) {
    app.get(`/downloads/${platform}`, async (_req: Request, res: Response) => {
      try {
        const [release] = await db
          .select({
            filename: desktopReleases.filename,
            storageUrl: desktopReleases.storageUrl,
          })
          .from(desktopReleases)
          .where(
            and(
              eq(desktopReleases.platform, platform),
              eq(desktopReleases.isLatest, true)
            )
          )
          .limit(1);

        // ADR-0018: no production URL of another environment is followed. A row
        // outside our own bucket answers exactly like no release at all.
        const ref = release ? ownBucketRef(release.storageUrl) : null;
        if (!release || !ref) {
          return res.status(404).json({
            error: `No release published yet for platform: ${platform}`,
          });
        }

        try {
          const signedUrl = await signObjectURL({
            bucketName: ref.bucketName,
            objectName: ref.objectName,
            method: "GET",
            ttlSec: SIGNED_URL_TTL_SEC,
          });
          return res.redirect(302, signedUrl);
        } catch (signErr) {
          console.error(`[downloadRoutes] Failed to sign download URL for ${platform}:`, signErr);
          return res.status(500).json({ error: "Failed to generate download URL" });
        }
      } catch (err) {
        console.error(`[downloadRoutes] Error serving ${platform}:`, err);
        return res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  // ── Public: latest installer metadata / redirect ──────────────────────────
  app.get("/api/downloads/desktop/latest", async (req: Request, res: Response) => {
    const platform = req.query.platform as string;
    if (!VALID_PLATFORMS.includes(platform as Platform)) {
      return res.status(400).json({
        error: "platform must be one of: windows, macos, linux",
      });
    }

    try {
      const [release] = await db
        .select()
        .from(desktopReleases)
        .where(
          and(
            eq(desktopReleases.platform, platform),
            eq(desktopReleases.isLatest, true)
          )
        )
        .limit(1);

      if (!release) {
        return res.status(404).json({
          error: `No release found for platform: ${platform}`,
        });
      }

      if (req.query.format === "json") {
        return res.json({
          version: release.version,
          platform: release.platform,
          filename: release.filename,
          // The stored object is private; the signed route is the only way to it.
          url: `/downloads/${platform}`,
          fileSize: release.fileSize,
          sha256: release.sha256,
          publishedAt: release.publishedAt,
        });
      }

      // The raw object is private: go through the signed route.
      return res.redirect(302, `/downloads/${platform}`);
    } catch (err) {
      console.error("[downloadRoutes] Error fetching latest release:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Public: full version history ──────────────────────────────────────────
  app.get("/api/downloads/desktop/versions", async (_req: Request, res: Response) => {
    try {
      const releases = await db
        .select({
          id: desktopReleases.id,
          version: desktopReleases.version,
          platform: desktopReleases.platform,
          filename: desktopReleases.filename,
          fileSize: desktopReleases.fileSize,
          sha256: desktopReleases.sha256,
          isLatest: desktopReleases.isLatest,
          publishedAt: desktopReleases.publishedAt,
          // storageUrl intentionally omitted — not needed client-side
        })
        .from(desktopReleases)
        .orderBy(desc(desktopReleases.publishedAt));
      return res.json(releases);
    } catch (err) {
      console.error("[downloadRoutes] Error fetching release list:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Internal: signed upload URL ───────────────────────────────────────────
  // The publisher PUTs the installer straight to storage with the returned
  // URL, then registers it through the metadata route below.
  app.post("/api/internal/desktop-releases/upload-url", async (req: Request, res: Response) => {
    if (!isCiAuthorized(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { version, platform, filename, fileSize, sha256 } = (req.body ?? {}) as {
      version?: string;
      platform?: string;
      filename?: string;
      fileSize?: number;
      sha256?: string;
    };

    if (!version || !platform || !filename || fileSize === undefined || !sha256) {
      return res.status(400).json({
        error: "Missing required fields: version, platform, filename, fileSize, sha256",
      });
    }
    const fieldError = releaseFieldError(version, platform, filename);
    if (fieldError) {
      return res.status(400).json({ error: fieldError });
    }
    if (!Number.isInteger(fileSize) || fileSize <= 0) {
      return res.status(400).json({ error: "Invalid fileSize — must be a positive integer" });
    }
    if (!SHA256_RE.test(sha256)) {
      return res.status(400).json({ error: "Invalid sha256 — must be 64-char lowercase hex" });
    }

    if (!storagePort.supportsSignedUrls) {
      return res.status(503).json({
        error: "This environment's storage provider cannot sign upload URLs, so installers cannot be published to it",
      });
    }
    const target = installersPrefix();
    if (!target) {
      return res.status(503).json({ error: "No public object path is configured for installers" });
    }

    try {
      const objectName = `${target.prefix}/${version}/${filename}`;
      const uploadUrl = await signObjectURL({
        bucketName: target.bucketName,
        objectName,
        method: "PUT",
        ttlSec: SIGNED_URL_TTL_SEC,
      });
      return res.json({
        uploadUrl,
        storageUrl: `${STORAGE_URL_PREFIX}${target.bucketName}/${objectName}`,
        expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SEC * 1000).toISOString(),
      });
    } catch (err) {
      console.error("[downloadRoutes] Error minting upload URL:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Internal: metadata registration ───────────────────────────────────────
  // Marks the release latest only once its object is in our bucket.
  app.post("/api/internal/desktop-releases", async (req: Request, res: Response) => {
    if (!isCiAuthorized(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { version, platform, filename, storageUrl, fileSize, sha256 } = req.body as {
      version?: string;
      platform?: string;
      filename?: string;
      storageUrl?: string;
      fileSize?: number;
      sha256?: string;
    };

    if (!version || !platform || !filename || !storageUrl) {
      return res.status(400).json({
        error: "Missing required fields: version, platform, filename, storageUrl",
      });
    }
    const fieldError = releaseFieldError(version, platform, filename);
    if (fieldError) {
      return res.status(400).json({ error: fieldError });
    }
    if (!storageUrl.startsWith(STORAGE_URL_PREFIX)) {
      return res.status(400).json({
        error: `storageUrl must be a ${STORAGE_URL_PREFIX}<bucket>/<object> URL`,
      });
    }
    const ref = ownBucketRef(storageUrl);
    if (!ref) {
      return res.status(422).json({
        error: "storageUrl names a bucket that is not this environment's own",
      });
    }

    try {
      if (!(await storagePort.exists(ref))) {
        return res.status(409).json({
          error: "The installer object does not exist in storage yet — PUT it to the upload-url first",
        });
      }

      const release = await db.transaction(async (tx) => {
        await tx
          .update(desktopReleases)
          .set({ isLatest: false })
          .where(
            and(
              eq(desktopReleases.platform, platform),
              eq(desktopReleases.isLatest, true)
            )
          );

        const [inserted] = await tx
          .insert(desktopReleases)
          .values({
            version,
            platform,
            filename,
            storageUrl,
            fileSize: fileSize ?? null,
            sha256: sha256 ?? null,
            isLatest: true,
          })
          .returning();

        return inserted;
      });

      console.log(`[downloadRoutes] Registered ${platform} v${version}: ${filename}`);
      return res.status(201).json(release);
    } catch (err) {
      console.error("[downloadRoutes] Error publishing release:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}
