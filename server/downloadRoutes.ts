/**
 * Desktop installer distribution endpoints.
 *
 * Public endpoints (no auth required):
 *   GET /api/downloads/desktop/latest?platform=windows|macos|linux
 *     → 302 redirect to GCS installer URL (permanent, stable URL)
 *     → with ?format=json → returns metadata object (no redirect)
 *
 *   GET /api/downloads/desktop/versions
 *     → JSON array of all published releases, newest first
 *
 * Internal endpoint (CI-only, guarded by DESKTOP_RELEASE_CI_TOKEN):
 *   POST /api/internal/desktop-releases
 *     → registers a new build artifact; atomically marks it as latest for its platform
 *
 * Architecture:
 *   CI (GitHub Actions) builds artifacts → uploads to GCS public bucket →
 *   calls POST /api/internal/desktop-releases → backend stores metadata →
 *   users hit GET /api/downloads/desktop/latest?platform=X → 302 to GCS URL
 *
 *   The GCS URL never changes once written. The backend URL is stable forever.
 *   Repo stays private; users never see GitHub.
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { desktopReleases } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const VALID_PLATFORMS = ["windows", "macos", "linux"] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

// Semver-ish: allow "0.1.6", "1.0.0-beta.1", "2.0.0-rc.3"
const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
// Reasonable filename: printable ASCII, no path traversal
const FILENAME_RE = /^[a-zA-Z0-9._\-]+$/;

function isCiAuthorized(req: Request): boolean {
  const token = process.env.DESKTOP_RELEASE_CI_TOKEN;
  if (!token) return false;
  const auth = req.headers.authorization;
  return typeof auth === "string" && auth === `Bearer ${token}`;
}

export function registerDownloadRoutes(app: Express): void {

  // ── Public: latest installer per platform ─────────────────────────────────
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

      // Permanent redirect — browsers and download managers follow it
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
          // storageUrl intentionally omitted — not needed client-side and changes over time
        })
        .from(desktopReleases)
        .orderBy(desc(desktopReleases.publishedAt));
      return res.json(releases);
    } catch (err) {
      console.error("[downloadRoutes] Error fetching release list:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Internal: CI publishes a new artifact ─────────────────────────────────
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

    // Validate required fields
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
    // storageUrl must be a GCS HTTPS URL — no arbitrary redirect targets
    if (!/^https:\/\/storage\.googleapis\.com\//.test(storageUrl)) {
      return res.status(400).json({ error: "storageUrl must be a GCS HTTPS URL" });
    }

    try {
      // Atomic: demote previous latest + insert new one in one transaction.
      // If the server crashes between the two writes, we end up with either the
      // old latest still set OR the new row present but not yet latest — both
      // recoverable states. Without the transaction, a crash could leave no
      // latest for the platform.
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

      console.log(`[downloadRoutes] Published ${platform} v${version}: ${filename}`);
      return res.status(201).json(release);
    } catch (err) {
      console.error("[downloadRoutes] Error publishing release:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}
