/**
 * Desktop installer distribution endpoints.
 *
 * Public endpoints (no auth required):
 *   GET /api/downloads/desktop/latest?platform=windows|macos|linux
 *     → 302 redirect to GCS installer URL
 *     → with ?format=json → returns metadata object (no redirect)
 *
 *   GET /api/downloads/desktop/versions
 *     → JSON array of all published releases
 *
 * Internal endpoint (CI-only, DESKTOP_RELEASE_CI_TOKEN):
 *   POST /api/internal/desktop-releases
 *     → registers a new build artifact; marks it as latest for its platform
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { desktopReleases } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const VALID_PLATFORMS = ["windows", "macos", "linux"] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

function isCiAuthorized(req: Request): boolean {
  const token = process.env.DESKTOP_RELEASE_CI_TOKEN;
  if (!token) return false;
  const auth = req.headers.authorization;
  return auth === `Bearer ${token}`;
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
        .select()
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

    if (!version || !platform || !filename || !storageUrl) {
      return res.status(400).json({
        error: "Missing required fields: version, platform, filename, storageUrl",
      });
    }
    if (!VALID_PLATFORMS.includes(platform as Platform)) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    try {
      // Demote previous latest for this platform
      await db
        .update(desktopReleases)
        .set({ isLatest: false })
        .where(
          and(
            eq(desktopReleases.platform, platform),
            eq(desktopReleases.isLatest, true)
          )
        );

      // Insert new release and mark it as latest
      const [release] = await db
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

      return res.status(201).json(release);
    } catch (err) {
      console.error("[downloadRoutes] Error publishing release:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}
