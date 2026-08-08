/**
 * Agent routes — Desktop Agent pairing, auth, and ingestion endpoints.
 *
 * Separated from main routes.ts for clean architectural boundary.
 * Phase 2 D2
 */

import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";
// sharp is optional — loaded lazily so the server starts even if libvips is unavailable
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharpLib: ((input: Buffer) => any) | null = null;
(async () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sharpLib = ((await import("sharp" as any)) as any).default;
  } catch {
    console.warn("[agentRoutes] sharp not available — screenshot compression disabled, raw PNG will be stored");
  }
})();
import { storage } from "./storage";
import type { CrmProjectWithDetails } from "@shared/schema";
import { isAuthenticated, getUserId, verifyPassword } from "./auth";
import { config } from "./config";
import { issueAccessToken, verifyAccessToken } from "./desktopTokens";
import { logInfo, logError, logTimeEvent } from "./logger";
import { parseObjectPath, signObjectURL } from "./objectStorage";
import { isTasksEnabled } from "./migrationFlags";

// ─── Constants ───

const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEVICE_TOKEN_LENGTH = 48; // bytes -> 96 hex chars

// ─── Helpers ───

function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 for readability
  let code = "";
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function generateToken(lengthBytes: number): string {
  return randomBytes(lengthBytes).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Whether `userId` may act on a CRM project: a membership row, or ownership of
 * the underlying project.
 *
 * The three agent routes that guard on this — task list, task create, timer
 * start — must agree, so they ask here rather than each spelling the predicate
 * out. **#31 owns the policy this encodes, and it is an open question**:
 * `GET /api/agent/projects` lists everything the user can *see*, which is wider
 * than this, so the picker can offer a project whose tasks this then refuses
 * with a 403. Whichever way #31 resolves — tighten the list, loosen this guard,
 * or show-and-mark — it is this function that moves, and the characterization
 * suites in `tests/characterization/agent-workspace.test.ts` and
 * `agent-timer.test.ts` freeze the current answer deliberately (#21).
 *
 * `members` is optional on `CrmProjectWithDetails` even though
 * `storage.getCrmProject` always populates it, so absent members deny here
 * rather than throw. That is the conservative reading and not a decision about
 * #31; it is the only reading that typechecks.
 */
function canActOnCrmProject(crmProject: CrmProjectWithDetails, userId: string): boolean {
  return (
    crmProject.members?.some((m) => m.userId === userId) === true ||
    crmProject.project?.ownerId === userId
  );
}

// ─── Agent auth middleware ───

interface AgentAuthRequest extends Request {
  agentDeviceId?: string;
  agentUserId?: string;
}

async function isAgentAuthenticated(req: AgentAuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  const claims = verifyAccessToken(token);

  if (!claims) {
    res.status(401).json({ message: "Invalid access token" });
    return;
  }

  if (Math.floor(Date.now() / 1000) > claims.expiresAt) {
    res.status(401).json({ message: "Access token expired" });
    return;
  }

  // Verify device is not revoked. JWT signature alone cannot detect revocation
  // since a valid token can live up to 1h after an admin revokes the device.
  // Checking here applies uniformly to all agent routes, not just heartbeat.
  try {
    const device = await storage.getDevice(claims.deviceId);
    if (!device || device.revokedAt) {
      res.status(403).json({ code: "device_revoked", message: "Device has been revoked" });
      return;
    }
  } catch {
    res.status(500).json({ message: "Authentication check failed" });
    return;
  }

  req.agentDeviceId = claims.deviceId;
  req.agentUserId = claims.userId;
  next();
}

// ─── Validation schemas ───

const deviceMetaSchema = z.object({
  deviceName: z.string().min(1).max(255),
  os: z.string().max(100).optional(),
  clientVersion: z.string().max(50).optional(),
});

const pairingCompleteSchema = z.object({
  pairingCode: z.string().length(PAIRING_CODE_LENGTH),
  deviceMeta: deviceMetaSchema,
});

const agentLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceMeta: deviceMetaSchema,
});

const refreshSchema = z.object({
  deviceId: z.string().uuid(),
  deviceToken: z.string().min(1),
});

const revokeSchema = z.object({
  deviceId: z.string().uuid(),
});

const heartbeatSchema = z.object({
  deviceId: z.string().uuid(),
  timeEntryId: z.string().uuid().nullable().optional(),
  timestamp: z.string(),
  activeApp: z.string().optional(),
  activeWindow: z.string().optional(),
  clientType: z.string(),
  clientVersion: z.string(),
});

const activityEventSchema = z.object({
  type: z.enum(["input_activity", "active_window", "idle_start", "idle_end"]),
  timestamp: z.string(),
  data: z.record(z.unknown()).optional().default({}),
});

const eventsBatchSchema = z.object({
  deviceId: z.string().uuid(),
  batchId: z.string().uuid(),
  clientType: z.string(),
  clientVersion: z.string(),
  events: z.array(activityEventSchema).min(1).max(100),
});

const presignSchema = z.object({
  deviceId: z.string().uuid(),
  timeEntryId: z.string().uuid(),
  capturedAt: z.string(),
  clientType: z.string(),
  clientVersion: z.string(),
  keyboardActivityPercent: z.number().int().min(0).max(100).nullish(),
  mouseActivityPercent: z.number().int().min(0).max(100).nullish(),
  keyboardCount: z.number().int().min(0).nullish(),
  mouseCount: z.number().int().min(0).nullish(),
});

const confirmSchema = z.object({
  screenshotId: z.string().uuid(),
  deviceId: z.string().uuid(),
});

// ─── Route registration ───

export function registerAgentRoutes(app: Express): void {

  /**
   * Ping endpoint — confirms agent routes are loaded and email/password auth is available.
   * Desktop app calls this before login to distinguish "server down" from "wrong server version".
   * No auth required.
   */
  app.get("/api/agent/ping", (_req, res) => {
    res.json({ ok: true, server: "DocuFlow", agentAuth: "email-password-v1" });
  });

  // ═══════════════════════════════════════
  // PAIRING
  // ═══════════════════════════════════════

  /**
   * DEPRECATED (S4): pairing code flow has been removed.
   * Desktop agents now authenticate via POST /api/agent/auth/login (email + password).
   * These endpoints return 410 Gone to surface clear errors to old agent versions.
   */
  app.post("/api/agent/pairing/start", (_req, res) => {
    res.status(410).json({
      message: "Pairing codes have been removed. Use the desktop app and sign in with your DocuFlow email and password.",
    });
  });

  app.post("/api/agent/pairing/complete", (_req, res) => {
    res.status(410).json({
      message: "Pairing codes have been removed. Use the desktop app and sign in with your DocuFlow email and password.",
    });
  });

  // ═══════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════

  /**
   * Agent: login with DocuFlow email + password.
   * Creates (or registers) a device for this machine and returns credentials.
   * Replaces the pairing code flow as of S4.
   */
  app.post("/api/agent/auth/login", async (req, res) => {
    try {
      const body = agentLoginSchema.parse(req.body);

      const user = await storage.getUserByEmail(body.email);
      if (!user) {
        // No id to name: the address that was tried is the payload ADR-0016
        // keeps out of telemetry, and the reason is what a failed login is
        // looked at for. `logInfo` would drop it anyway (#26).
        logInfo("agent.auth.login.failed", { reason: "user_not_found" });
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const valid = await verifyPassword(body.password, user.password);
      if (!valid) {
        logInfo("agent.auth.login.failed", { userId: user.id, reason: "bad_password" });
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Create a new device for this login
      const deviceToken = generateToken(DEVICE_TOKEN_LENGTH);
      const deviceTokenHash = hashToken(deviceToken);

      const device = await storage.createDevice({
        userId: user.id,
        name: body.deviceMeta.deviceName,
        os: body.deviceMeta.os ?? null,
        clientVersion: body.deviceMeta.clientVersion ?? null,
        deviceTokenHash,
        lastSeenAt: new Date(),
      });

      const { accessToken, expiresAt } = issueAccessToken(device.id, user.id);

      logInfo("agent.auth.login.success", { userId: user.id, deviceId: device.id });
      res.json({
        deviceId: device.id,
        deviceToken,
        accessToken,
        expiresAt: expiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      logError("agent.auth.login.failed", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  /** Agent: refresh access token using device token */
  app.post("/api/agent/auth/refresh", async (req, res) => {
    try {
      const body = refreshSchema.parse(req.body);
      const tokenHash = hashToken(body.deviceToken);

      const device = await storage.getDeviceByTokenHash(body.deviceId, tokenHash);
      if (!device) {
        return res.status(401).json({ message: "Invalid device credentials" });
      }
      if (device.revokedAt) {
        return res.status(401).json({ code: "device_revoked", message: "Device has been revoked" });
      }

      // Update lastSeenAt
      await storage.updateDeviceLastSeen(device.id);

      const { accessToken, expiresAt } = issueAccessToken(device.id, device.userId);

      logInfo("agent.auth.refresh", { deviceId: device.id });
      res.json({ accessToken, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      logError("agent.auth.refresh.failed", error);
      res.status(500).json({ message: "Failed to refresh token" });
    }
  });

  /** Web: revoke a device */
  app.post("/api/agent/device/revoke", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const body = revokeSchema.parse(req.body);

      const device = await storage.getDevice(body.deviceId);
      if (!device || device.userId !== userId) {
        return res.status(404).json({ message: "Device not found" });
      }

      await storage.revokeDevice(body.deviceId);

      logInfo("agent.device.revoke", { deviceId: body.deviceId, userId });
      res.json({ ok: true });
    } catch (error) {
      logError("agent.device.revoke.failed", error);
      res.status(500).json({ message: "Failed to revoke device" });
    }
  });

  /** Web: revoke all tokens for a logical machine (identified by name+os) */
  app.post("/api/agent/devices/revoke-machine", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const { name, os } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ message: "name is required" });
      }
      await storage.revokeDevicesByMachine(userId, name, os ?? null);
      // The machine's name is whatever its owner called it, so it stays out of
      // the record (#26, ADR-0016); the user and the platform are what identify
      // which fleet member lost its tokens.
      logInfo("agent.device.revoke-machine", { userId, os });
      res.json({ ok: true });
    } catch (error) {
      logError("agent.device.revoke-machine.failed", error);
      res.status(500).json({ message: "Failed to revoke machine devices" });
    }
  });

  /** Web: list user's devices */
  app.get("/api/agent/devices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const devicesList = await storage.getUserDevices(userId);
      res.json({ data: devicesList });
    } catch (error) {
      logError("agent.devices.list.failed", error);
      res.status(500).json({ message: "Failed to list devices" });
    }
  });

  // ═══════════════════════════════════════
  // INGESTION
  // ═══════════════════════════════════════

  /** Agent: heartbeat */
  app.post("/api/agent/heartbeat", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const body = heartbeatSchema.parse(req.body);

      // Check device revocation before doing anything else.
      // isAgentAuthenticated only verifies JWT signature + expiry — it does NOT hit the DB.
      // A valid JWT can survive up to 1h after an admin revokes the device.
      // Returning 403 here makes the desktop detect revocation within one heartbeat cycle (≤30s)
      // instead of waiting for JWT expiry. ApiClient handles 403 → onRevoke() → clearSession.
      const device = await storage.getDevice(body.deviceId);
      if (!device || device.revokedAt) {
        return res.status(403).json({ code: "device_revoked", message: "Device has been revoked" });
      }

      // Update device lastSeenAt
      await storage.updateDeviceLastSeen(body.deviceId);

      // If there's an active time entry, accumulate duration + update lastActivityAt.
      // This is critical: without accumulating duration here, the web UI resets the
      // elapsed counter to near-0 on every heartbeat (because it computes
      // duration + (now - lastActivityAt) and lastActivityAt just jumped forward).
      if (body.timeEntryId) {
        const hbEntry = await storage.getTimeEntry(body.timeEntryId);
        if (hbEntry && hbEntry.status === "running" && hbEntry.lastActivityAt) {
          const now = new Date(body.timestamp);
          const elapsed = Math.floor(
            (now.getTime() - new Date(hbEntry.lastActivityAt).getTime()) / 1000
          );
          await storage.updateTimeEntry(body.timeEntryId, {
            lastActivityAt: now,
            duration: (hbEntry.duration || 0) + Math.max(0, elapsed),
          });
        }
        // Non-running entries (paused/stopped): do NOT update lastActivityAt.
        // Updating it would corrupt the elapsed calculation at resume time.
      }

      // Get server-authoritative timer state for desktop resync (enriched with names
      // so the desktop can hydrate project/task display without a separate request)
      const serverActive = await storage.getActiveTimeEntry(req.agentUserId!);
      let timerSync = null;
      if (serverActive && serverActive.status !== "stopped") {
        let projectName: string | null = null;
        let taskName: string | null = null;
        try {
          const crmProject = await storage.getCrmProject(serverActive.crmProjectId);
          projectName = (crmProject as any)?.project?.name ?? null;
        } catch { /* non-fatal */ }
        if (serverActive.taskId) {
          try {
            const task = await storage.getTask(serverActive.taskId);
            taskName = task?.name ?? null;
          } catch { /* non-fatal */ }
        }
        timerSync = {
          entryId: serverActive.id,
          status: serverActive.status,
          duration: serverActive.duration ?? 0,
          taskId: serverActive.taskId ?? null,
          lastActivityAt: serverActive.lastActivityAt ?? null,
          projectName,
          taskName,
          startTime: new Date(serverActive.startTime).toISOString(),
        };
      }

      // Fetch org screenshot policy to push to desktop agent
      const screenshotPolicy = await storage.getScreenshotPolicy();

      logInfo("agent.heartbeat", {
        deviceId: body.deviceId,
        timeEntryId: body.timeEntryId ?? null,
        clientType: body.clientType,
        clientVersion: body.clientVersion,
        timerSyncStatus: timerSync?.status ?? "none",
      });

      res.json({ ok: true, serverTime: new Date().toISOString(), timerSync, screenshotPolicy });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      logError("agent.heartbeat.failed", error);
      res.status(500).json({ message: "Failed to process heartbeat" });
    }
  });

  /** Agent: batch events (idempotent) */
  app.post("/api/agent/events/batch", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const body = eventsBatchSchema.parse(req.body);

      // Idempotency check
      const isDuplicate = await storage.isAgentBatchProcessed(body.batchId);
      if (isDuplicate) {
        return res.json({ ok: true, accepted: 0, duplicate: true });
      }

      // Get active time entry for this user (best-effort association)
      const activeEntry = await storage.getActiveTimeEntry(req.agentUserId!);
      const timeEntryId = activeEntry?.id ?? null;

      // Store events
      await storage.createAgentActivityEvents(
        body.events.map((event) => ({
          deviceId: body.deviceId,
          userId: req.agentUserId!,
          timeEntryId,
          batchId: body.batchId,
          eventType: event.type,
          timestamp: new Date(event.timestamp),
          data: event.data,
        }))
      );

      // Mark batch as processed
      await storage.markAgentBatchProcessed(body.batchId, body.deviceId, body.events.length);

      // Update device lastSeenAt
      await storage.updateDeviceLastSeen(body.deviceId);

      logInfo("agent.events.batch", {
        deviceId: body.deviceId,
        batchId: body.batchId,
        eventCount: body.events.length,
        clientType: body.clientType,
      });

      res.json({ ok: true, accepted: body.events.length });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      logError("agent.events.batch.failed", error);
      res.status(500).json({ message: "Failed to process events batch" });
    }
  });

  /** Agent: presign screenshot upload URL */
  app.post("/api/agent/screenshots/presign", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const body = presignSchema.parse(req.body);

      // Fetch time entry to get crmProjectId
      const timeEntry = await storage.getTimeEntry(body.timeEntryId);
      if (!timeEntry) {
        return res.status(404).json({ message: "Time entry not found" });
      }

      // Guard: reject screenshot if entry is not actively running
      if (timeEntry.status !== "running") {
        logInfo("agent.screenshots.presign.rejected", {
          reason: "entry_not_running",
          entryStatus: timeEntry.status,
          timeEntryId: body.timeEntryId,
          deviceId: body.deviceId,
        });
        return res.status(409).json({
          message: `Screenshot rejected: time entry is ${timeEntry.status}, not running`,
          entryStatus: timeEntry.status,
        });
      }

      // Guard: verify the requesting device is not revoked
      const presignDevice = await storage.getDevice(req.agentDeviceId!);
      if (!presignDevice || presignDevice.revokedAt) {
        return res.status(403).json({ code: "device_revoked", message: "Device has been revoked" });
      }

      // Create a screenshot record with pending status
      const screenshot = await storage.createTimeEntryScreenshot({
        timeEntryId: body.timeEntryId,
        userId: req.agentUserId!,
        crmProjectId: timeEntry.crmProjectId,
        storageKey: `pending-${Date.now()}`, // Replaced on upload
        capturedAt: new Date(body.capturedAt),
        keyboardActivityPercent: body.keyboardActivityPercent ?? null,
        mouseActivityPercent: body.mouseActivityPercent ?? null,
        keyboardCount: body.keyboardCount ?? null,
        mouseCount: body.mouseCount ?? null,
      });

      // Upload URL points to our server endpoint (server-side relay to GCS)
      const uploadURL = `/api/agent/screenshots/upload/${screenshot.id}`;

      logInfo("agent.screenshots.presign", {
        screenshotId: screenshot.id,
        timeEntryId: body.timeEntryId,
        deviceId: body.deviceId,
        clientType: body.clientType,
      });

      res.json({
        screenshotId: screenshot.id,
        uploadURL,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      logError("agent.screenshots.presign.failed", error);
      res.status(500).json({ message: "Failed to presign screenshot" });
    }
  });

  /** Agent: upload screenshot binary (server-side relay to GCS) */
  app.put(
    "/api/agent/screenshots/upload/:id",
    isAgentAuthenticated as any,
    express.raw({ type: ["image/png", "application/octet-stream"], limit: "6mb" }),
    async (req: AgentAuthRequest, res) => {
      try {
        const { id } = req.params;
        const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

        // Validate Content-Type
        const contentType = req.headers["content-type"] || "";
        if (!contentType.startsWith("image/png") && !contentType.startsWith("application/octet-stream")) {
          return res.status(415).json({ message: "Content-Type must be image/png" });
        }

        const rawBuffer: Buffer = req.body;
        if (!rawBuffer || rawBuffer.length === 0) {
          return res.status(400).json({ message: "Empty body" });
        }
        if (rawBuffer.length > MAX_SIZE) {
          return res.status(413).json({ message: `Screenshot exceeds 5 MB limit (${(rawBuffer.length / 1024 / 1024).toFixed(1)} MB)` });
        }

        // Verify PNG magic bytes (89 50 4E 47)
        if (
          rawBuffer[0] !== 0x89 ||
          rawBuffer[1] !== 0x50 ||
          rawBuffer[2] !== 0x4e ||
          rawBuffer[3] !== 0x47
        ) {
          return res.status(415).json({ message: "Not a valid PNG file" });
        }

        // Verify screenshot record exists and belongs to this user
        const screenshot = await storage.getTimeEntryScreenshotById(id);
        if (!screenshot) {
          return res.status(404).json({ message: "Screenshot record not found" });
        }
        if (screenshot.userId !== req.agentUserId) {
          return res.status(403).json({ message: "Forbidden" });
        }

        // Compress: resize to max 1920px wide + WebP 75% (falls back to raw PNG if sharp unavailable)
        let imageBuffer: Buffer;
        let imageExt: string;
        let imageMime: string;

        if (sharpLib) {
          imageBuffer = await (sharpLib as any)(rawBuffer)
            .resize({ width: 1920, withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer();
          imageExt = "webp";
          imageMime = "image/webp";
          logInfo("agent.screenshots.compress", {
            screenshotId: id,
            originalBytes: rawBuffer.length,
            compressedBytes: imageBuffer.length,
            ratio: `${Math.round((1 - imageBuffer.length / rawBuffer.length) * 100)}%`,
          });
        } else {
          imageBuffer = rawBuffer;
          imageExt = "png";
          imageMime = "image/png";
          logInfo("agent.screenshots.compress.skipped", { screenshotId: id, reason: "sharp unavailable" });
        }

        // Upload to Object Storage via a signed URL this process PUTs to itself:
        // the agent sends bytes here, the server compresses and relays them.
        const privateDir = config.objectStorage.privateDir;
        const objectSubPath = `agent-screenshots/${id}.${imageExt}`;
        const fullObjectPath = `${privateDir}/${objectSubPath}`;
        const { bucketName, objectName } = parseObjectPath(fullObjectPath);

        const signedPutUrl = await signObjectURL({
          bucketName,
          objectName,
          method: "PUT",
          ttlSec: 300,
        });

        const uploadRes = await fetch(signedPutUrl, {
          method: "PUT",
          headers: { "Content-Type": imageMime },
          body: imageBuffer,
        });
        if (!uploadRes.ok) {
          throw new Error(`Object storage upload failed: ${uploadRes.status}`);
        }

        // DB storageKey uses /objects/ prefix so getObjectEntityFile() can resolve it
        const storageKey = `/objects/${objectSubPath}`;
        const contentHash = createHash("sha256").update(rawBuffer).digest("hex");
        await storage.updateTimeEntryScreenshot(id, { storageKey, contentHash });

        logInfo("agent.screenshots.upload", {
          screenshotId: id,
          sizeBytes: imageBuffer.length,
          userId: req.agentUserId,
        });

        res.json({ ok: true });
      } catch (error: any) {
        logError("agent.screenshots.upload.failed", error);
        res.status(500).json({ message: `Upload failed: ${error.message}` });
      }
    }
  );

  /** Agent: confirm screenshot upload complete */
  app.post("/api/agent/screenshots/confirm", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const body = confirmSchema.parse(req.body);

      // Verify the screenshot was actually uploaded (storageKey no longer starts with "pending-")
      const screenshot = await storage.getTimeEntryScreenshotById(body.screenshotId);
      if (!screenshot) {
        return res.status(404).json({ message: "Screenshot not found" });
      }
      if (screenshot.storageKey.startsWith("pending-")) {
        return res.status(409).json({ message: "Screenshot upload not yet received" });
      }

      logInfo("agent.screenshots.confirm", {
        screenshotId: body.screenshotId,
        deviceId: body.deviceId,
        userId: req.agentUserId,
      });

      res.json({ ok: true });
    } catch (error) {
      logError("agent.screenshots.confirm.failed", error);
      res.status(500).json({ message: "Failed to confirm screenshot" });
    }
  });

  // ═══════════════════════════════════════
  // TIMER CONTROL (Agent-authenticated)
  // ═══════════════════════════════════════

  /** Helper: check device is valid and not revoked.
   *  Always uses the device ID from the verified JWT (req.agentDeviceId) —
   *  the body's deviceId is intentionally ignored to prevent a caller from
   *  passing a different device ID to bypass revocation of their own device.
   */
  async function requireActiveDevice(req: AgentAuthRequest, res: Response): Promise<boolean> {
    const deviceId = req.agentDeviceId;
    if (!deviceId) {
      res.status(401).json({ message: "Device identity missing from token" });
      return false;
    }
    const device = await storage.getDevice(deviceId);
    if (!device) {
      res.status(404).json({ message: "Device not found" });
      return false;
    }
    if (device.revokedAt) {
      res.status(403).json({ code: "device_revoked", message: "Device has been revoked" });
      return false;
    }
    return true;
  }

  /** Agent: get active time entry (enriched with project and task names) */
  app.get("/api/agent/timer/active", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const userId = req.agentUserId!;
      const entry = await storage.getActiveTimeEntry(userId);
      if (!entry) return res.json(null);

      let projectName: string | null = null;
      let taskName: string | null = null;
      try {
        const crmProject = await storage.getCrmProject(entry.crmProjectId);
        projectName = (crmProject as any)?.project?.name ?? null;
      } catch { /* non-fatal */ }
      if (entry.taskId) {
        try {
          const task = await storage.getTask(entry.taskId);
          taskName = task?.name ?? null;
        } catch { /* non-fatal */ }
      }

      res.json({ ...entry, projectName, taskName });
    } catch (error) {
      logError("agent.timer.active.failed", error);
      res.status(500).json({ message: "Failed to fetch active entry" });
    }
  });

  /** Agent: total seconds worked today (stopped entries only — client adds live elapsed for running entry).
   *  Client passes ?start=ISO&end=ISO using local midnight so the window matches the user's clock. */
  app.get("/api/agent/worked-today", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const userId = req.agentUserId!;
      // Prefer client-supplied local-day window; fall back to server UTC day
      const startDate = req.query.start ? new Date(req.query.start as string) : (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
      const endDate   = req.query.end   ? new Date(req.query.end   as string) : (() => { const d = new Date(); d.setHours(23,59,59,999); return d; })();
      const stats = await storage.getTimeStats({ userId, startDate, endDate });
      res.json({ total: stats.totalDuration });
    } catch (error) {
      logError("agent.worked-today.failed", error);
      res.status(500).json({ message: "Failed to fetch worked today" });
    }
  });

  /**
   * Agent: today's time breakdown grouped by (project, task).
   * Returns stopped-entry totals only; the client overlays the active entry's live elapsed.
   * Same day-window logic as /api/agent/worked-today (client-supplied local midnight).
   */
  app.get("/api/agent/today-breakdown", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const userId = req.agentUserId!;
      const startDate = req.query.start ? new Date(req.query.start as string) : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
      const endDate   = req.query.end   ? new Date(req.query.end   as string) : (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })();

      const entries = await storage.getTimeEntries({
        userId,
        endDate,
        endDateGte: startDate,
        status: "stopped",
      });

      // Clamp cross-midnight entries proportionally (same as getTimeStats)
      const clamp = (e: { startTime: Date | string; endTime: Date | string | null; duration: number | null }): number => {
        if (!e.endTime) return e.duration || 0;
        const eStart = new Date(e.startTime).getTime();
        const wStart = startDate.getTime();
        if (eStart >= wStart) return e.duration || 0;
        const eEnd = new Date(e.endTime).getTime();
        const totalMs = eEnd - eStart;
        if (totalMs <= 0) return 0;
        const inWindowMs = Math.min(eEnd, endDate.getTime()) - wStart;
        if (inWindowMs <= 0) return 0;
        return Math.round((e.duration || 0) * inWindowMs / totalMs);
      };

      // Batch-fetch task names for all unique taskIds
      const taskIds = [...new Set(entries.map(e => e.taskId).filter(Boolean) as string[])];
      const taskNames = new Map<string, string>();
      await Promise.all(taskIds.map(async (id) => {
        const t = await storage.getTask(id);
        if (t) taskNames.set(id, t.name);
      }));

      // Group by (crmProjectId, taskId)
      type Row = { projectName: string; taskId: string | null; taskName: string | null; stoppedSeconds: number };
      const map = new Map<string, Row>();
      for (const entry of entries) {
        const key = `${entry.crmProjectId}::${entry.taskId ?? ""}`;
        const projectName = (entry as any).crmProject?.project?.name || "Unknown Project";
        const taskName = entry.taskId ? (taskNames.get(entry.taskId) ?? null) : null;
        const existing = map.get(key) ?? { projectName, taskId: entry.taskId ?? null, taskName, stoppedSeconds: 0 };
        existing.stoppedSeconds += clamp(entry);
        map.set(key, existing);
      }

      res.json({ rows: Array.from(map.values()) });
    } catch (error) {
      logError("agent.today-breakdown.failed", error);
      res.status(500).json({ message: "Failed to fetch today breakdown" });
    }
  });

  /** Agent: list tasks for a CRM project (for timer start dropdown) */
  app.get("/api/agent/tasks", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    if (!isTasksEnabled()) return res.json({ data: [] });
    try {
      const userId = req.agentUserId!;
      const { crmProjectId } = req.query as { crmProjectId?: string };
      if (!crmProjectId) return res.status(400).json({ message: "crmProjectId is required" });
      const crmProject = await storage.getCrmProject(crmProjectId);
      if (!crmProject) return res.status(404).json({ message: "Project not found" });
      const isMember = canActOnCrmProject(crmProject, userId);
      if (!isMember) return res.status(403).json({ message: "Access denied" });
      const taskList = await storage.getTasks({ crmProjectId });
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const taskIds = taskList.map((t) => t.id).filter(Boolean) as string[];
      const durations = await storage.getTasksDurationToday(userId, taskIds, startOfDay, endOfDay);
      res.json({ data: taskList.map((t) => ({ id: t.id, name: t.name, status: t.status, durationToday: durations[t.id] ?? 0 })) });
    } catch (error) {
      logError("agent.tasks.list.failed", error);
      res.status(500).json({ message: "Failed to list tasks" });
    }
  });

  /** Agent: create a task under a CRM project (mirrors web POST /api/tasks, Bearer auth). */
  app.post("/api/agent/tasks", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    if (!isTasksEnabled()) {
      return res.status(503).json({ message: "Tasks feature not available yet — migration pending" });
    }
    try {
      const userId = req.agentUserId!;
      const { crmProjectId, name, description } = req.body as {
        crmProjectId?: string;
        name?: string;
        description?: string;
      };
      if (!crmProjectId || !name?.trim()) {
        return res.status(400).json({ message: "crmProjectId and name are required" });
      }
      const crmProject = await storage.getCrmProject(crmProjectId);
      if (!crmProject) return res.status(404).json({ message: "Project not found" });
      const isMember = canActOnCrmProject(crmProject, userId);
      if (!isMember) return res.status(403).json({ message: "Access denied" });
      const task = await storage.createTask({
        crmProjectId,
        name: name.trim(),
        description: description?.trim() || null,
        status: "open",
      });
      logInfo("agent.tasks.create", { taskId: task.id, crmProjectId, userId });
      res.status(201).json({ id: task.id, name: task.name, status: task.status, crmProjectId: task.crmProjectId });
    } catch (error: any) {
      logError("agent.tasks.create.failed", error);
      const detail = error?.message ?? "Unknown error";
      res.status(500).json({ message: `Failed to create task: ${detail}` });
    }
  });

  /** Agent: timer / task policy flags (tasks table present). */
  app.get("/api/agent/capabilities", isAgentAuthenticated as any, async (_req: AgentAuthRequest, res) => {
    res.json({ requiresTask: isTasksEnabled() });
  });

  /** Agent: list CRM projects (for timer start dropdown) */
  app.get("/api/agent/projects", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const userId = req.agentUserId!;
      const result = await storage.getCrmProjects(userId, { pageSize: 100 });
      // Return simplified list for agent UI
      const projects = result.data.map((p: any) => ({
        id: p.id,
        name: p.project?.name || p.name || "Untitled",
        status: p.status,
      }));
      res.json({ data: projects });
    } catch (error) {
      logError("agent.projects.list.failed", error);
      res.status(500).json({ message: "Failed to list projects" });
    }
  });

  /** Agent: create a new CRM project */
  app.post("/api/agent/projects", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      const userId = req.agentUserId!;
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Project name is required" });
      }
      const { crmProject } = await storage.createCrmProjectWithBase(
        { name: name.trim(), description: null, icon: null, ownerId: userId },
      );
      res.status(201).json({
        id: crmProject.id,
        name: name.trim(),
        status: crmProject.status ?? "active",
      });
    } catch (error: any) {
      logError("agent.projects.create.failed", error);
      const detail = error?.message ?? "Unknown error";
      res.status(500).json({ message: `Failed to create project: ${detail}` });
    }
  });

  /** Agent: start timer */
  app.post("/api/agent/timer/start", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      if (!(await requireActiveDevice(req, res))) return;

      const userId = req.agentUserId!;
      const { crmProjectId, description, deviceId, clientCommandId } = req.body;
      // Strip taskId if migration 002 hasn't been applied yet
      const taskId = isTasksEnabled() ? (req.body.taskId || null) : null;

      if (!crmProjectId) {
        return res.status(400).json({ message: "crmProjectId is required" });
      }

      // Verify user is a member of the project
      const crmProject = await storage.getCrmProject(crmProjectId);
      if (!crmProject) {
        return res.status(404).json({ message: "Project not found" });
      }
      const isMember = canActOnCrmProject(crmProject, userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (isTasksEnabled() && !taskId) {
        return res.status(400).json({ message: "taskId is required" });
      }

      if (isTasksEnabled() && taskId) {
        const task = await storage.getTask(taskId);
        if (!task || task.crmProjectId !== crmProjectId) {
          return res.status(400).json({ message: "Invalid task for this project" });
        }
        if (task.status === "archived") {
          return res.status(400).json({ message: "Cannot start timer on an archived task" });
        }
      }

      // Idempotency: if we've already processed this command, return the existing entry
      if (clientCommandId) {
        const existing = await storage.getTimeEntryByClientCommandId(clientCommandId);
        if (existing) {
          logInfo("agent.timer.start.idempotent", { userId, clientCommandId, entryId: existing.id });
          return res.json({ ...existing, taskAccumulatedToday: 0 });
        }
      }

      // Auto-stop any existing active entry
      const activeEntry = await storage.getActiveTimeEntry(userId);
      if (activeEntry) {
        const now = new Date();
        let finalDuration = activeEntry.duration || 0;
        if (activeEntry.status === "running" && activeEntry.lastActivityAt) {
          const elapsedSeconds = Math.floor((now.getTime() - new Date(activeEntry.lastActivityAt).getTime()) / 1000);
          finalDuration += elapsedSeconds;
        }
        await storage.updateTimeEntry(activeEntry.id, {
          status: "stopped",
          endTime: now,
          duration: finalDuration,
        });
      }

      const entry = await storage.createTimeEntry({
        userId,
        crmProjectId,
        taskId: taskId || null,
        description: description || null,
        startTime: new Date(),
        status: "running",
        lastActivityAt: new Date(),
        duration: 0,
        idleTime: 0,
        ...(clientCommandId ? { clientCommandId } : {}),
      });

      logTimeEvent("start", entry.id, userId, { crmProjectId, taskId: taskId || null, deviceId, clientType: "desktop" });
      logInfo("agent.timer.start", { userId, deviceId, entryId: entry.id, crmProjectId });

      // Return accumulated duration for this task today so the client can resume display from the right offset
      let taskAccumulatedToday = 0;
      if (taskId) {
        const now2 = new Date();
        const startOfDay = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate(), 0, 0, 0, 0);
        const endOfDay   = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate(), 23, 59, 59, 999);
        taskAccumulatedToday = await storage.getTaskDurationToday(userId, taskId, startOfDay, endOfDay);
      }
      res.json({ ...entry, taskAccumulatedToday });
    } catch (error) {
      logError("agent.timer.start.failed", error);
      res.status(500).json({ message: "Failed to start timer" });
    }
  });

  /** Agent: pause timer */
  app.post("/api/agent/timer/:id/pause", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      if (!(await requireActiveDevice(req, res))) return;

      const userId = req.agentUserId!;
      const entry = await storage.getTimeEntry(req.params.id);

      if (!entry) return res.status(404).json({ message: "Time entry not found" });
      if (entry.userId !== userId) return res.status(403).json({ message: "Not authorized" });
      if (entry.status !== "running") return res.status(400).json({ message: "Entry is not running" });

      const now = new Date();
      const lastActivity = entry.lastActivityAt || entry.startTime;
      const elapsedSeconds = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / 1000);

      const updated = await storage.updateTimeEntry(entry.id, {
        status: "paused",
        duration: (entry.duration || 0) + elapsedSeconds,
        lastActivityAt: now,
      });

      logTimeEvent("pause", entry.id, userId);
      logInfo("agent.timer.pause", { userId, deviceId: req.agentDeviceId, entryId: entry.id });
      res.json(updated);
    } catch (error) {
      logError("agent.timer.pause.failed", error);
      res.status(500).json({ message: "Failed to pause timer" });
    }
  });

  /** Agent: resume timer */
  app.post("/api/agent/timer/:id/resume", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      if (!(await requireActiveDevice(req, res))) return;

      const userId = req.agentUserId!;
      const entry = await storage.getTimeEntry(req.params.id);

      if (!entry) return res.status(404).json({ message: "Time entry not found" });
      if (entry.userId !== userId) return res.status(403).json({ message: "Not authorized" });
      if (entry.status !== "paused") return res.status(400).json({ message: "Entry is not paused" });

      const now = new Date();
      const updated = await storage.updateTimeEntry(entry.id, {
        status: "running",
        lastActivityAt: now,
      });

      logTimeEvent("resume", entry.id, userId);
      logInfo("agent.timer.resume", { userId, deviceId: req.agentDeviceId, entryId: entry.id });
      res.json(updated);
    } catch (error) {
      logError("agent.timer.resume.failed", error);
      res.status(500).json({ message: "Failed to resume timer" });
    }
  });

  /** Agent: stop timer */
  app.post("/api/agent/timer/:id/stop", isAgentAuthenticated as any, async (req: AgentAuthRequest, res) => {
    try {
      if (!(await requireActiveDevice(req, res))) return;

      const userId = req.agentUserId!;
      const entry = await storage.getTimeEntry(req.params.id);

      if (!entry) return res.status(404).json({ message: "Time entry not found" });
      if (entry.userId !== userId) return res.status(403).json({ message: "Not authorized" });
      if (entry.status === "stopped") return res.status(400).json({ message: "Entry is already stopped" });

      const now = new Date();
      let finalDuration = entry.duration || 0;
      if (entry.status === "running" && entry.lastActivityAt) {
        const elapsedSeconds = Math.floor((now.getTime() - new Date(entry.lastActivityAt).getTime()) / 1000);
        finalDuration += elapsedSeconds;
      }

      const updated = await storage.updateTimeEntry(entry.id, {
        status: "stopped",
        endTime: now,
        duration: finalDuration,
      });

      logTimeEvent("stop", entry.id, userId, { finalDuration });
      logInfo("agent.timer.stop", { userId, deviceId: req.agentDeviceId, entryId: entry.id, finalDuration });
      res.json(updated);
    } catch (error) {
      logError("agent.timer.stop.failed", error);
      res.status(500).json({ message: "Failed to stop timer" });
    }
  });
}
