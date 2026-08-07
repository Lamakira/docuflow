/**
 * Desktop installer distribution endpoints.
 *
 * Public endpoints (no auth required):
 *   GET /downloads/availability
 *     → { windows: bool, macos: bool, linux: bool } — DB-backed, per-platform
 *
 *   GET /downloads/:platform
 *     → if storageUrl is gs:// → generates a 15-min signed GCS GET URL → 302 redirect
 *       (download goes directly from GCS, bypasses Replit's 50 MB proxy limit)
 *     → otherwise streams installer file from installers/ directory
 *     → 404 JSON if not yet published for that platform
 *
 *   GET /api/downloads/desktop/latest?platform=windows|macos|linux
 *     → 302 redirect to storageUrl (GCS or /downloads/:platform)
 *     → with ?format=json → returns metadata object (no redirect)
 *
 *   GET /api/downloads/desktop/versions
 *     → JSON array of all published releases, newest first
 *
 * Internal endpoints (guarded by DESKTOP_RELEASE_CI_TOKEN):
 *   POST /api/internal/desktop-releases/upload
 *     → binary upload (manual/local workflow, no GCS):
 *       writes file to installers/ + atomically registers as latest for its platform
 *       NOTE: blocked by Replit's reverse proxy for files > ~50 MB; prefer upload-chunk.
 *
 *   POST /api/internal/desktop-releases/upload-chunk
 *     → chunked binary upload — bypasses Replit's proxy body-size limit.
 *       Send the file in ≤ 20 MB slices; server reassembles, verifies SHA256,
 *       writes installers/<filename>, and registers the DB row on the final chunk.
 *       Required headers on every chunk:
 *         Authorization, X-Upload-Id, X-Chunk-Index, X-Total-Chunks,
 *         X-Version, X-Platform, X-Filename, X-File-Size, X-SHA256
 *       Returns 200 for intermediate chunks, 201 + release JSON for the last.
 *
 *   POST /api/internal/desktop-releases
 *     → metadata-only registration (CI/GCS workflow):
 *       no file upload; storageUrl must be a GCS HTTPS URL or /downloads/:platform
 *
 * Per-platform independence:
 *   Each platform (windows / macos / linux) has exactly one is_latest=true row
 *   at any time. Publishing Windows does not affect macOS or Linux rows.
 *   Platforms with no row (or missing file) are returned as unavailable.
 */

import express, { type Express, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { db } from "./db";
import { desktopReleases } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { desktopReleaseCiToken } from "./config";
import { signObjectURL, parseObjectPath } from "./objectStorage";

const VALID_PLATFORMS = ["windows", "macos", "linux"] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

// Semver-ish: allow "0.1.6", "1.0.0-beta.1", "2.0.0-rc.3"
const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
// Reasonable filename: printable ASCII, no path traversal
const FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

// Files live in <cwd>/installers/ — not committed, in .gitignore.
const installersDir = path.resolve(process.cwd(), "installers");

function isCiAuthorized(req: Request): boolean {
  const token = desktopReleaseCiToken();
  if (!token) return false;
  const auth = req.headers.authorization;
  return typeof auth === "string" && auth === `Bearer ${token}`;
}

export function registerDownloadRoutes(app: Express): void {

  // ── Public: per-platform availability ────────────────────────────────────
  // Returns { windows: bool, macos: bool, linux: bool }.
  // A platform is "available" when the DB has an is_latest row AND either:
  //   a) storageUrl is a GCS HTTPS URL (file lives in Object Storage — always reachable), or
  //   b) storageUrl is a local /downloads/:platform path AND the file exists on disk.
  app.get("/downloads/availability", async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          platform: desktopReleases.platform,
          filename: desktopReleases.filename,
          storageUrl: desktopReleases.storageUrl,
        })
        .from(desktopReleases)
        .where(eq(desktopReleases.isLatest, true));

      const result: Record<string, boolean> = { windows: false, macos: false, linux: false };
      for (const row of rows) {
        if (!(row.platform in result)) continue;
        if (row.storageUrl?.startsWith("https://storage.googleapis.com/")) {
          // File is in GCS — always reachable (no disk check needed).
          result[row.platform] = true;
        } else {
          result[row.platform] = fs.existsSync(path.join(installersDir, row.filename));
        }
      }
      return res.json(result);
    } catch (err) {
      console.error("[downloadRoutes] Error checking availability:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Public: serve installer file ──────────────────────────────────────────
  // Looks up the current latest filename from DB, then streams the file.
  // The filename in the Content-Disposition header is the original artifact
  // name (e.g. DocuFlow-Agent-0.1.6-windows-setup.exe) — not a stable name —
  // so the user always knows which version they downloaded.
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

        if (!release) {
          return res.status(404).json({
            error: `No release published yet for platform: ${platform}`,
          });
        }

        // GCS object (storageUrl = https://storage.googleapis.com/BUCKET/OBJECT)
        // → generate a short-lived signed GET URL and redirect the browser there.
        // Download goes directly from GCS, bypassing Replit's ~50 MB proxy limit.
        if (release.storageUrl?.startsWith("https://storage.googleapis.com/")) {
          try {
            const url = new URL(release.storageUrl);
            const pathParts = url.pathname.split("/").filter(Boolean);
            const bucketName = pathParts[0];
            const objectName = pathParts.slice(1).join("/");
            const signedUrl = await signObjectURL({
              bucketName,
              objectName,
              method: "GET",
              ttlSec: 900, // 15 minutes — enough for any download
            });
            return res.redirect(302, signedUrl);
          } catch (signErr) {
            console.error(`[downloadRoutes] Failed to sign GCS URL for ${platform}:`, signErr);
            return res.status(500).json({ error: "Failed to generate download URL" });
          }
        }

        // Fallback: stream from local installers/ directory.
        // Only works for files ≤ ~50 MB through Replit's reverse proxy.
        const filePath = path.join(installersDir, release.filename);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({
            error: "Installer file is registered but missing from disk",
            filename: release.filename,
          });
        }

        return res.download(filePath, release.filename);
      } catch (err) {
        console.error(`[downloadRoutes] Error serving ${platform}:`, err);
        return res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  // ── Public: latest installer metadata / redirect (GCS workflow) ───────────
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
          url: release.storageUrl,
          fileSize: release.fileSize,
          sha256: release.sha256,
          publishedAt: release.publishedAt,
        });
      }

      return res.redirect(302, release.storageUrl);
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

  // ── Internal: manual upload (local workflow, no GCS) ─────────────────────
  // Accepts the raw binary in the request body.
  // Required headers:
  //   Authorization: Bearer <DESKTOP_RELEASE_CI_TOKEN>
  //   Content-Type: application/octet-stream
  //   X-Version:  0.1.6
  //   X-Platform: windows
  //   X-Filename: DocuFlow-Agent-0.1.6-windows-setup.exe
  //   X-SHA256:   <hex> (optional — server verifies if provided)
  //
  // The server writes the file to installers/<X-Filename>, then atomically
  // registers it as is_latest for its platform in desktop_releases.
  // The old latest file is deleted from disk (non-fatal if it fails).
  app.post(
    "/api/internal/desktop-releases/upload",
    express.raw({ type: "application/octet-stream", limit: "200mb" }),
    async (req: Request, res: Response) => {
      if (!isCiAuthorized(req)) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const version  = (req.headers["x-version"]  as string | undefined)?.trim();
      const platform = (req.headers["x-platform"] as string | undefined)?.trim();
      const filename = (req.headers["x-filename"] as string | undefined)?.trim();
      const clientSha256 = (req.headers["x-sha256"] as string | undefined)?.trim().toLowerCase();

      if (!version || !platform || !filename) {
        return res.status(400).json({
          error: "Missing required headers: X-Version, X-Platform, X-Filename",
        });
      }
      if (!VALID_PLATFORMS.includes(platform as Platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }
      if (!VERSION_RE.test(version)) {
        return res.status(400).json({ error: "Invalid version format (semver expected, e.g. 0.1.6)" });
      }
      if (!FILENAME_RE.test(filename)) {
        return res.status(400).json({ error: "Invalid filename — use only letters, digits, dots, dashes, underscores" });
      }

      const fileBuffer = req.body as Buffer;
      if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        return res.status(400).json({ error: "Empty or missing file body" });
      }

      // SHA256 — computed server-side; optionally verified against client value
      const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
      if (clientSha256 && clientSha256 !== sha256) {
        return res.status(400).json({
          error: "SHA256 mismatch — file may be corrupted in transit",
          serverComputed: sha256,
          clientProvided: clientSha256,
        });
      }
      const fileSize = fileBuffer.length;

      try {
        // Find old latest (to clean up old file after commit)
        const [oldRelease] = await db
          .select({ filename: desktopReleases.filename })
          .from(desktopReleases)
          .where(
            and(
              eq(desktopReleases.platform, platform),
              eq(desktopReleases.isLatest, true)
            )
          )
          .limit(1);

        // Write new file to disk
        fs.mkdirSync(installersDir, { recursive: true });
        const destPath = path.join(installersDir, filename);
        fs.writeFileSync(destPath, fileBuffer);

        // DB: atomically demote old → insert new
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
              storageUrl: `/downloads/${platform}`, // stable app-domain URL
              fileSize,
              sha256,
              isLatest: true,
            })
            .returning();

          return inserted;
        });

        // Delete old file — non-fatal; just orphaned if it fails
        if (oldRelease && oldRelease.filename !== filename) {
          const oldPath = path.join(installersDir, oldRelease.filename);
          try {
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          } catch (cleanupErr) {
            console.warn("[downloadRoutes] Could not delete old installer:", cleanupErr);
          }
        }

        console.log(
          `[downloadRoutes] Uploaded ${platform} v${version}: ${filename}` +
          ` (${(fileSize / 1024 / 1024).toFixed(1)} MB, sha256=${sha256.slice(0, 12)}...)`
        );

        return res.status(201).json({
          version: release.version,
          platform: release.platform,
          filename: release.filename,
          fileSize: release.fileSize,
          sha256: release.sha256,
          storageUrl: release.storageUrl,
          publishedAt: release.publishedAt,
        });
      } catch (err) {
        console.error("[downloadRoutes] Error uploading release:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ── Internal: chunked upload (local Windows workflow) ────────────────────
  // Splits the installer into ≤ 20 MB slices to stay under Replit's proxy
  // body-size limit. Each chunk is stored in installers/.tmp/<uploadId>/.
  // When the final chunk arrives the server reassembles the file, verifies
  // the SHA256, writes it to installers/<filename>, and atomically registers
  // the release in the DB — exactly like the single-shot upload endpoint.
  //
  // Required headers on every request:
  //   Authorization: Bearer <DESKTOP_RELEASE_CI_TOKEN>
  //   Content-Type:  application/octet-stream
  //   X-Upload-Id:   <uuid>            — shared across all chunks
  //   X-Chunk-Index: <0-based integer> — this chunk's position
  //   X-Total-Chunks:<integer>         — total number of chunks
  //   X-Version:     <semver>
  //   X-Platform:    windows|macos|linux
  //   X-Filename:    <artifact filename>
  //   X-File-Size:   <total bytes>
  //   X-SHA256:      <hex>             — SHA256 of the complete file
  app.post(
    "/api/internal/desktop-releases/upload-chunk",
    express.raw({ type: "application/octet-stream", limit: "25mb" }),
    async (req: Request, res: Response) => {
      if (!isCiAuthorized(req)) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const uploadId    = (req.headers["x-upload-id"]    as string | undefined)?.trim();
      const chunkIndex  = parseInt((req.headers["x-chunk-index"]   as string) ?? "", 10);
      const totalChunks = parseInt((req.headers["x-total-chunks"]  as string) ?? "", 10);
      const version     = (req.headers["x-version"]   as string | undefined)?.trim();
      const platform    = (req.headers["x-platform"]  as string | undefined)?.trim();
      const filename    = (req.headers["x-filename"]  as string | undefined)?.trim();
      const fileSize    = parseInt((req.headers["x-file-size"]    as string) ?? "0", 10);
      const sha256      = (req.headers["x-sha256"]    as string | undefined)?.trim().toLowerCase();

      if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks) || !version || !platform || !filename || !sha256) {
        return res.status(400).json({
          error: "Missing required headers: X-Upload-Id, X-Chunk-Index, X-Total-Chunks, X-Version, X-Platform, X-Filename, X-File-Size, X-SHA256",
        });
      }
      if (!VALID_PLATFORMS.includes(platform as Platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }
      if (!VERSION_RE.test(version)) {
        return res.status(400).json({ error: "Invalid version format (semver expected)" });
      }
      if (!FILENAME_RE.test(filename)) {
        return res.status(400).json({ error: "Invalid filename" });
      }
      if (!/^[a-f0-9]{64}$/.test(sha256)) {
        return res.status(400).json({ error: "Invalid X-SHA256 — must be 64-char hex" });
      }
      if (chunkIndex < 0 || chunkIndex >= totalChunks) {
        return res.status(400).json({ error: "X-Chunk-Index out of range" });
      }

      const chunk = req.body as Buffer;
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
        return res.status(400).json({ error: "Empty chunk body" });
      }

      // Sanitize uploadId to prevent path traversal
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(uploadId)) {
        return res.status(400).json({ error: "Invalid X-Upload-Id format" });
      }

      const tmpDir = path.join(installersDir, ".tmp", uploadId);

      try {
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, `chunk-${chunkIndex}`), chunk);
      } catch (err) {
        console.error("[downloadRoutes] Failed to write chunk:", err);
        return res.status(500).json({ error: "Failed to store chunk" });
      }

      // Not the last chunk — acknowledge and wait for the rest
      if (chunkIndex < totalChunks - 1) {
        return res.json({ received: chunkIndex + 1, total: totalChunks, status: "partial" });
      }

      // ── Last chunk received — reassemble ─────────────────────────────────
      try {
        fs.mkdirSync(installersDir, { recursive: true });
        const destPath = path.join(installersDir, filename);

        // Concatenate chunks in order
        const parts: Buffer[] = [];
        for (let i = 0; i < totalChunks; i++) {
          const chunkPath = path.join(tmpDir, `chunk-${i}`);
          if (!fs.existsSync(chunkPath)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            return res.status(400).json({ error: `Missing chunk ${i} during reassembly` });
          }
          parts.push(fs.readFileSync(chunkPath));
        }
        const assembled = Buffer.concat(parts);

        // Verify integrity
        const actualSha256 = createHash("sha256").update(assembled).digest("hex");
        if (actualSha256 !== sha256) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return res.status(400).json({
            error: "SHA256 mismatch after reassembly — upload may be corrupted",
            expected: sha256,
            actual: actualSha256,
          });
        }

        fs.writeFileSync(destPath, assembled);
        fs.rmSync(tmpDir, { recursive: true, force: true });

        // Find old latest for cleanup
        const [oldRelease] = await db
          .select({ filename: desktopReleases.filename })
          .from(desktopReleases)
          .where(and(eq(desktopReleases.platform, platform), eq(desktopReleases.isLatest, true)))
          .limit(1);

        // Atomically demote old → insert new
        const release = await db.transaction(async (tx) => {
          await tx
            .update(desktopReleases)
            .set({ isLatest: false })
            .where(and(eq(desktopReleases.platform, platform), eq(desktopReleases.isLatest, true)));

          const [inserted] = await tx
            .insert(desktopReleases)
            .values({
              version,
              platform,
              filename,
              storageUrl: `/downloads/${platform}`,
              fileSize: fileSize || assembled.length,
              sha256: actualSha256,
              isLatest: true,
            })
            .returning();

          return inserted;
        });

        // Delete old installer from disk — non-fatal
        if (oldRelease && oldRelease.filename !== filename) {
          const oldPath = path.join(installersDir, oldRelease.filename);
          try {
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          } catch (cleanupErr) {
            console.warn("[downloadRoutes] Could not delete old installer:", cleanupErr);
          }
        }

        console.log(
          `[downloadRoutes] Chunked upload complete: ${platform} v${version} — ${filename}` +
          ` (${(assembled.length / 1024 / 1024).toFixed(1)} MB in ${totalChunks} chunks, sha256=${actualSha256.slice(0, 12)}...)`
        );

        return res.status(201).json({
          version: release.version,
          platform: release.platform,
          filename: release.filename,
          fileSize: release.fileSize,
          sha256: release.sha256,
          storageUrl: release.storageUrl,
          publishedAt: release.publishedAt,
        });
      } catch (err) {
        console.error("[downloadRoutes] Error during chunk reassembly:", err);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        return res.status(500).json({ error: "Internal server error during reassembly" });
      }
    }
  );

  // ── Internal: metadata-only registration (CI/GCS workflow) ───────────────
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
    if (!VALID_PLATFORMS.includes(platform as Platform)) {
      return res.status(400).json({ error: "Invalid platform" });
    }
    if (!VERSION_RE.test(version)) {
      return res.status(400).json({ error: "Invalid version format (expected semver)" });
    }
    if (!FILENAME_RE.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const isGcsUrl = /^https:\/\/storage\.googleapis\.com\//.test(storageUrl);
    const isLocalUrl = /^\/downloads\/(windows|macos|linux)$/.test(storageUrl);
    if (!isGcsUrl && !isLocalUrl) {
      return res.status(400).json({
        error: "storageUrl must be a GCS HTTPS URL or a local /downloads/:platform path",
      });
    }

    try {
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
