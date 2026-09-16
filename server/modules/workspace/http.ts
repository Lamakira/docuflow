import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isAuthenticated, isIdentified, getUserId } from "../../auth";
import {
  contextFromUser,
  runWithWorkspaceContext,
  ArchivedMembershipError,
  NoActiveMembershipError,
} from "../../workspaceContext";
import {
  AccountDeletionPendingError,
  NoAccountDeletionError,
  OwnedWorkspaceRemainsError,
  accountDeletionState,
  cancelAccountDeletion,
  requestAccountDeletion,
} from "./accountDeletion";
import {
  WorkspaceConfirmationError,
  WorkspaceHasMembersError,
  WorkspaceNameError,
  WorkspaceNotOwnedError,
  WorkspaceSuccessorError,
  createWorkspace,
  deleteWorkspace,
  transferWorkspaceOwnership,
} from "./firstWorkspace";
import {
  canManageWebhookEndpoints,
  createWebhookEndpoint,
  disableWebhookEndpoint,
  enableWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookEndpoints,
  rotateWebhookEndpointSecret,
  UnknownWebhookEventTypeError,
  WebhookEndpointNotFoundError,
} from "./webhookEndpoints";
import {
  InvalidActiveWorkspaceError,
  listMemberships,
  listWorkspaceMemberships,
  setActiveWorkspace,
} from "./activeWorkspace";
import {
  InvitationAlreadyAcceptedError,
  InvitationAlreadyPendingError,
  InvitationDuplicateMembershipError,
  InvitationEmailMismatchError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRoleError,
  InvitationRevokedError,
  InvitationUnauthorizedError,
  MembershipNotFoundError,
  acceptInvitation,
  canManageInvitations,
  listInvitationsForUser,
  listWorkspaceInvitations,
  revokeInvitation,
  sendInvitation,
  updateMembershipProfile,
} from "./invitations";
import { SeatExhaustedError } from "../billing/writeClassification";

const createBody = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.string()).min(1),
});

function notFound(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown) {
  if (error instanceof WebhookEndpointNotFoundError) {
    res.status(404).json({ message: error.message });
    return true;
  }
  return false;
}

/**
 * Web BFF for Webhook Endpoints. Session cookies only. Owner or Administrator
 * Workspace Role. `{ message }` errors, matching today's `/api/*`.
 */
export function registerWebhookEndpointRoutes(app: Express): void {
  const requireManager: RequestHandler = async (_req, res, next) => {
    if (!(await canManageWebhookEndpoints())) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };

  app.post("/api/webhook-endpoints", isAuthenticated, requireManager, async (req, res) => {
    try {
      const body = createBody.parse(req.body);
      const created = await createWebhookEndpoint(body);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid request" });
      }
      if (error instanceof UnknownWebhookEventTypeError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }
  });

  app.get("/api/webhook-endpoints", isAuthenticated, requireManager, async (_req, res) => {
    res.json(await listWebhookEndpoints());
  });

  app.get("/api/webhook-endpoints/:id", isAuthenticated, requireManager, async (req, res) => {
    try {
      res.json(await getWebhookEndpoint(req.params.id));
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });

  app.post("/api/webhook-endpoints/:id/disable", isAuthenticated, requireManager, async (req, res) => {
    try {
      await disableWebhookEndpoint(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });

  app.post("/api/webhook-endpoints/:id/enable", isAuthenticated, requireManager, async (req, res) => {
    try {
      await enableWebhookEndpoint(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });

  app.post("/api/webhook-endpoints/:id/rotate", isAuthenticated, requireManager, async (req, res) => {
    try {
      res.json(await rotateWebhookEndpointSecret(req.params.id));
    } catch (error) {
      if (!notFound(res, error)) throw error;
    }
  });
}

/**
 * User-global Membership list and Active Workspace preference (#183).
 * Session cookies only. Errors stay `{ message }`.
 */
export function registerActiveWorkspaceRoutes(app: Express): void {
  // Identity-session only: a User with no Membership cannot enter a Workspace,
  // and "you belong nowhere yet" is the answer Flow 1 and Flow 2 both need.
  app.get("/api/memberships", isIdentified, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const ctx = await contextFromUser(userId);
      return res.json(await runWithWorkspaceContext(ctx, () => listMemberships(userId)));
    } catch (error) {
      if (error instanceof NoActiveMembershipError || error instanceof ArchivedMembershipError) {
        return res.json({ activeWorkspaceId: null, preferredWorkspaceId: null, memberships: [] });
      }
      throw error;
    }
  });

  app.get("/api/workspace/memberships", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    res.json(await listWorkspaceMemberships(userId, req.query.includeArchived === "true"));
  });

  app.put("/api/memberships/active", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const parsed = z.object({ workspaceId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }
    try {
      res.json(await setActiveWorkspace(userId, parsed.data.workspaceId));
    } catch (error) {
      if (error instanceof InvalidActiveWorkspaceError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      throw error;
    }
  });
}

const sendBody = z.object({
  email: z.string().email(),
  workspaceRole: z.string().min(1),
});

const profileBody = z.object({
  hoursPerDay: z.number().int().min(1).max(24).optional(),
  canViewDailyUpdates: z.union([z.literal(0), z.literal(1)]).optional(),
});

function invitationError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown): boolean {
  if (
    error instanceof InvitationNotFoundError ||
    error instanceof InvitationRoleError ||
    error instanceof InvitationDuplicateMembershipError ||
    error instanceof InvitationAlreadyPendingError ||
    error instanceof InvitationRevokedError ||
    error instanceof InvitationExpiredError ||
    error instanceof InvitationAlreadyAcceptedError ||
    error instanceof InvitationEmailMismatchError ||
    error instanceof InvitationUnauthorizedError ||
    error instanceof MembershipNotFoundError ||
    error instanceof SeatExhaustedError
  ) {
    res.status(error.statusCode).json({ message: error.message });
    return true;
  }
  return false;
}

/**
 * Invitation BFF (#211). Session cookies. Send/revoke: Owner or Administrator.
 * Accept is identity-session only — an invitee may have no Membership yet.
 * Errors stay `{ message }`.
 */
export function registerInvitationRoutes(app: Express): void {
  const requireManager: RequestHandler = async (_req, res, next) => {
    if (!(await canManageInvitations())) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };

  app.get("/api/workspace/invitations", isAuthenticated, async (_req, res) => {
    res.json(await listWorkspaceInvitations());
  });

  app.get("/api/invitations", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    res.json(await listInvitationsForUser(userId));
  });

  app.post("/api/workspace/invitations", isAuthenticated, requireManager, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const parsed = sendBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }
    try {
      const created = await sendInvitation(userId, parsed.data);
      res.status(201).json(created);
    } catch (error) {
      if (!invitationError(res, error)) throw error;
    }
  });

  app.post("/api/workspace/invitations/:id/revoke", isAuthenticated, requireManager, async (req, res) => {
    try {
      res.json(await revokeInvitation(req.params.id));
    } catch (error) {
      if (!invitationError(res, error)) throw error;
    }
  });

  app.patch("/api/workspace/memberships/:id", isAuthenticated, requireManager, async (req, res) => {
    const parsed = profileBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }
    try {
      res.json(await updateMembershipProfile(req.params.id, parsed.data));
    } catch (error) {
      if (!invitationError(res, error)) throw error;
    }
  });

  app.post("/api/invitations/accept", async (req, res) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }
    try {
      res.json(await acceptInvitation({ token: parsed.data.token, authorization: req.headers.authorization }));
    } catch (error) {
      if (!invitationError(res, error)) throw error;
    }
  });
}

function lifecycleError(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  error: unknown,
): boolean {
  if (
    error instanceof WorkspaceNameError ||
    error instanceof WorkspaceNotOwnedError ||
    error instanceof WorkspaceSuccessorError ||
    error instanceof WorkspaceHasMembersError ||
    error instanceof WorkspaceConfirmationError ||
    error instanceof OwnedWorkspaceRemainsError ||
    error instanceof AccountDeletionPendingError ||
    error instanceof NoAccountDeletionError
  ) {
    res.status(error.statusCode).json({ message: error.message });
    return true;
  }
  return false;
}

/**
 * Workspace lifecycle BFF (#217, Flows 1 and 10). Identity session only, not
 * `isAuthenticated`: a User creating their first Workspace holds no Membership
 * to enter, and one deleting their account may hold none either. Authorization
 * is still DocuFlow's — each route below checks the Owner Membership itself.
 * Errors stay `{ message }`.
 */
export function registerWorkspaceLifecycleRoutes(app: Express): void {
  app.post("/api/workspaces", isIdentified, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      res.status(201).json(await createWorkspace(userId, { name: req.body?.name }));
    } catch (error) {
      if (!lifecycleError(res, error)) throw error;
    }
  });

  app.post("/api/workspaces/:id/owner", isIdentified, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }
    try {
      res.json(await transferWorkspaceOwnership(userId, req.params.id, parsed.data.userId));
    } catch (error) {
      if (!lifecycleError(res, error)) throw error;
    }
  });

  app.delete("/api/workspaces/:id", isIdentified, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      res.json(await deleteWorkspace(userId, req.params.id, { confirmName: req.body?.confirmName }));
    } catch (error) {
      if (!lifecycleError(res, error)) throw error;
    }
  });

  app.get("/api/account/deletion", isIdentified, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    res.json(await accountDeletionState(userId));
  });

  app.post("/api/account/deletion", isIdentified, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      res.status(201).json(await requestAccountDeletion(userId));
    } catch (error) {
      if (!lifecycleError(res, error)) throw error;
    }
  });

  app.delete("/api/account/deletion", isIdentified, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      res.json(await cancelAccountDeletion(userId));
    } catch (error) {
      if (!lifecycleError(res, error)) throw error;
    }
  });
}
