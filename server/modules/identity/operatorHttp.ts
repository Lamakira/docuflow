/**
 * The operator surface (#300, ADR-0015). Separate from `/api/admin/users*`.
 * Platform Staff only, and only with a verified second factor. Customer Users
 * are refused here even when `users.role` is `admin`.
 */

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { getUserId, isAuthenticated } from "../../auth";
import { bearerToken, identityProvider, platformIdentityProvider } from ".";
import { IdentityProviderError } from "./identityProvider";
import {
  BreakGlassReasonError,
  createSupportGrant,
  findPlatformStaffBySubject,
  GrantDurationError,
  listActiveSupportGrants,
  listPlatformStaff,
  NotWorkspaceOwnerError,
  openBreakGlass,
  OperatorAccessDeniedError,
  OwnerSecondFactorMissingError,
  PlatformStaffNotFoundError,
  readOperatorWorkspace,
  refuseOperatorWrite,
  revokeSupportGrant,
  setWorkspaceTwoFactor,
  SupportAccessReadOnlyError,
  SupportGrantNotFoundError,
  workspaceRequiresTwoFactor,
  WorkspaceNotFoundError,
} from "./operatorAccess";
import { requireAdministration } from "../../workspaceRole";

type Responder = { status: (code: number) => { json: (body: unknown) => void } };

const REFUSALS = [
  OperatorAccessDeniedError,
  SupportAccessReadOnlyError,
  BreakGlassReasonError,
  GrantDurationError,
  PlatformStaffNotFoundError,
  SupportGrantNotFoundError,
  WorkspaceNotFoundError,
  NotWorkspaceOwnerError,
  OwnerSecondFactorMissingError,
] as const;

function refuse(res: Responder, error: unknown): boolean {
  if (!REFUSALS.some((type) => error instanceof type)) return false;
  const refusal = error as Error & { statusCode: number };
  res.status(refusal.statusCode).json({ message: refusal.message });
  return true;
}

/**
 * Operator routes do not enter a Workspace. The staff token is the principal.
 * A dedicated Clerk instance, when configured, is the pool; otherwise the
 * token must carry the staff claim.
 */
export const requirePlatformStaff: RequestHandler = async (req, res, next) => {
  const token = bearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  let subjectId = (req as { sessionSubjectId?: string }).sessionSubjectId;
  let secondFactor = (req as { secondFactorVerified?: boolean }).secondFactorVerified === true;
  let staffToken = (req as { platformStaffSession?: boolean }).platformStaffSession === true;

  if (platformIdentityProvider) {
    try {
      const session = await platformIdentityProvider.verifySessionToken(token);
      subjectId = session.providerSubjectId;
      secondFactor = session.secondFactorVerified;
      staffToken = true;
    } catch (error) {
      if (error instanceof IdentityProviderError) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      throw error;
    }
  } else {
    // The customer provider already verified this bearer in `identitySession`.
    // Re-read it so a staff claim cannot be supplied without a real token.
    try {
      const session = await identityProvider.verifySessionToken(token);
      subjectId = session.providerSubjectId;
      secondFactor = session.secondFactorVerified;
      staffToken = session.platformStaff;
    } catch (error) {
      if (error instanceof IdentityProviderError) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      throw error;
    }
  }

  if (!staffToken || !subjectId) return res.status(403).json({ message: "Access denied" });
  if (!secondFactor) {
    return res.status(401).json({ message: "A second factor is required", code: "setup-mfa" });
  }

  const staff = await findPlatformStaffBySubject(subjectId);
  if (!staff) return res.status(403).json({ message: "Access denied" });
  (req as { platformStaffId?: string }).platformStaffId = staff.id;
  if (staff.linkedUserId) (req as { identitySessionUserId?: string }).identitySessionUserId = staff.linkedUserId;
  next();
};

function staffId(req: unknown): string | undefined {
  return (req as { platformStaffId?: string }).platformStaffId;
}

const grantBody = z.object({
  platformStaffId: z.string().min(1),
  hours: z.number().int().optional(),
});

const twoFactorBody = z.object({ required: z.boolean() });
const breakGlassBody = z.object({ reason: z.string() });

export function registerOperatorRoutes(app: Express): void {
  app.get("/api/operator/workspaces/:workspaceId", requirePlatformStaff, async (req, res) => {
    const id = staffId(req);
    if (!id) return res.status(401).json({ message: "Not authenticated" });
    try {
      res.json(await readOperatorWorkspace(id, req.params.workspaceId));
    } catch (error) {
      if (refuse(res, error)) return;
      throw error;
    }
  });

  app.post("/api/operator/workspaces/:workspaceId", requirePlatformStaff, async (req, res) => {
    const id = staffId(req);
    if (!id) return res.status(401).json({ message: "Not authenticated" });
    try {
      await refuseOperatorWrite(id, req.params.workspaceId);
    } catch (error) {
      if (refuse(res, error)) return;
      throw error;
    }
  });

  app.post("/api/operator/workspaces/:workspaceId/break-glass", requirePlatformStaff, async (req, res) => {
    const id = staffId(req);
    if (!id) return res.status(401).json({ message: "Not authenticated" });
    const parsed = breakGlassBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Break-glass access needs a written reason" });
    }
    try {
      const opened = await openBreakGlass(id, req.params.workspaceId, parsed.data.reason);
      res.status(201).json(opened);
    } catch (error) {
      if (refuse(res, error)) return;
      throw error;
    }
  });

  app.get("/api/workspace/support-access-grants", isAuthenticated, async (_req, res) => {
    res.json(await listActiveSupportGrants());
  });

  app.get("/api/workspace/two-factor", isAuthenticated, async (req, res) => {
    res.json({
      required: await workspaceRequiresTwoFactor(),
      secondFactorVerified: (req as { secondFactorVerified?: boolean }).secondFactorVerified === true,
    });
  });

  app.get("/api/admin/platform-staff", isAuthenticated, requireAdministration, async (_req, res) => {
    res.json(await listPlatformStaff());
  });

  app.post("/api/admin/support-access-grants", isAuthenticated, requireAdministration, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const parsed = grantBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
    try {
      const created = await createSupportGrant({
        platformStaffId: parsed.data.platformStaffId,
        createdByUserId: userId,
        hours: parsed.data.hours,
      });
      res.status(201).json(created);
    } catch (error) {
      if (refuse(res, error)) return;
      throw error;
    }
  });

  app.post(
    "/api/admin/support-access-grants/:id/revoke",
    isAuthenticated,
    requireAdministration,
    async (req, res) => {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      try {
        await revokeSupportGrant(req.params.id, userId);
        res.json({ revoked: true });
      } catch (error) {
        if (refuse(res, error)) return;
        throw error;
      }
    },
  );

  app.patch("/api/admin/two-factor", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const parsed = twoFactorBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
    try {
      const secondFactorVerified = (req as { secondFactorVerified?: boolean }).secondFactorVerified === true;
      res.json(await setWorkspaceTwoFactor(parsed.data.required, userId, secondFactorVerified));
    } catch (error) {
      if (refuse(res, error)) return;
      throw error;
    }
  });
}
