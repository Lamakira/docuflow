/**
 * Support Requests (#314). A Member sends one from the app; it belongs to the
 * Workspace they sent it from. Platform Staff answer it (emailed to the User),
 * keep internal notes, assign it and move its status.
 *
 * Every staff action is one Audit Event written in the request's Workspace,
 * naming the staff member. Payloads hold ids and values, never the message or
 * an answer's text.
 */

import { and, asc, eq } from "drizzle-orm";
import {
  auditEvents,
  notifications,
  platformStaff,
  supportRequestEntries,
  supportRequests,
  users,
  type SupportCategory,
  type SupportStatus,
} from "@shared/schema";
import { db } from "../../db";
import { sendSupportAnswerEmail, sendSupportStatusEmail } from "../../email";
import { forEachWorkspace, inWorkspace, runWithWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import { PlatformStaffNotFoundError } from "./operatorAccess";
import {
  findWorkspace,
  personName,
  staffDirectory,
  supportRequestRowsInContext,
  type PlatformSupportRequestRow,
} from "./backOfficeWorkspaces";

export class SupportRequestNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("Support Request was not found");
    this.name = "SupportRequestNotFoundError";
  }
}

/** The answer could not be emailed, so it was not kept. */
export class SupportAnswerEmailError extends Error {
  readonly statusCode = 502;
  constructor() {
    super("The answer could not be emailed to the User, so it was not saved");
    this.name = "SupportAnswerEmailError";
  }
}

export const STATUS_LABEL: Record<SupportStatus, string> = {
  open: "open",
  in_progress: "in progress",
  resolved: "resolved",
};

export type PlatformSupportRequestDetail = PlatformSupportRequestRow & {
  entries: Array<{
    id: string;
    kind: "answer" | "note";
    body: string;
    staff: { id: string; email: string | null } | null;
    createdAt: string;
    emailedAt: string | null;
  }>;
};

/** A Member's request. Runs in the Workspace the session is in. */
export async function createSupportRequest(
  userId: string,
  input: { category: SupportCategory; message: string }
): Promise<{ id: string; status: "open" }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supportRequests)
      .values(stampWorkspace({ userId, category: input.category, message: input.message }))
      .returning({ id: supportRequests.id });
    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: "user" as const,
        actorId: userId,
        action: "support_request.created",
        resourceType: "support_requests",
        resourceId: row.id,
        payload: { category: input.category },
      })
    );
    return { id: row.id, status: "open" as const };
  });
}

/** Support Requests live in a Workspace, so finding one walks the Workspaces. */
async function workspaceOfRequest(requestId: string): Promise<string> {
  const found = await forEachWorkspace(async () => {
    const [row] = await db
      .select({ workspaceId: supportRequests.workspaceId })
      .from(supportRequests)
      .where(and(inWorkspace(supportRequests), eq(supportRequests.id, requestId)))
      .limit(1);
    return row?.workspaceId ?? null;
  });
  const workspaceId = found.find((id): id is string => id != null);
  if (!workspaceId) throw new SupportRequestNotFoundError();
  return workspaceId;
}

async function detailInContext(workspaceId: string, requestId: string): Promise<PlatformSupportRequestDetail> {
  const staff = await staffDirectory();
  const workspace = await findWorkspace(workspaceId);
  const rows = await supportRequestRowsInContext(workspace, staff);
  const row = rows.find((candidate) => candidate.id === requestId);
  if (!row) throw new SupportRequestNotFoundError();
  const entries = await db
    .select()
    .from(supportRequestEntries)
    .where(and(inWorkspace(supportRequestEntries), eq(supportRequestEntries.supportRequestId, requestId)))
    .orderBy(asc(supportRequestEntries.createdAt));
  return {
    ...row,
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind === "answer" ? "answer" : "note",
      body: entry.body,
      staff: entry.platformStaffId
        ? { id: entry.platformStaffId, email: staff.get(entry.platformStaffId) ?? null }
        : null,
      createdAt: entry.createdAt.toISOString(),
      emailedAt: entry.emailedAt ? entry.emailedAt.toISOString() : null,
    })),
  };
}

export async function supportRequestDetail(requestId: string): Promise<PlatformSupportRequestDetail> {
  const workspaceId = await workspaceOfRequest(requestId);
  return runWithWorkspaceContext({ workspaceId }, () => detailInContext(workspaceId, requestId));
}

async function staffAudit(
  tx: Pick<typeof db, "insert">,
  staffId: string,
  action: string,
  requestId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await tx.insert(auditEvents).values(
    stampWorkspace({
      actorKind: "platform_staff" as const,
      actorId: staffId,
      action,
      resourceType: "support_requests",
      resourceId: requestId,
      payload,
    })
  );
}

/**
 * The answer is saved and mailed in one transaction: if Resend refuses, nothing
 * is kept, so the staff member never believes the User was told when they were not.
 */
export async function answerSupportRequest(
  staffId: string,
  requestId: string,
  body: string
): Promise<PlatformSupportRequestDetail> {
  const workspaceId = await workspaceOfRequest(requestId);
  return runWithWorkspaceContext({ workspaceId }, async () => {
    await db.transaction(async (tx) => {
      const [request] = await tx
        .select({ email: users.email, firstName: users.firstName, lastName: users.lastName })
        .from(supportRequests)
        .innerJoin(users, eq(users.id, supportRequests.userId))
        .where(and(inWorkspace(supportRequests), eq(supportRequests.id, requestId)))
        .limit(1);
      if (!request) throw new SupportRequestNotFoundError();
      const [entry] = await tx
        .insert(supportRequestEntries)
        .values(stampWorkspace({ supportRequestId: requestId, kind: "answer", body, platformStaffId: staffId }))
        .returning({ id: supportRequestEntries.id });
      const sent = await sendSupportAnswerEmail({
        toEmail: request.email,
        recipientName: personName(request),
        answer: body,
      });
      if (!sent.success) throw new SupportAnswerEmailError();
      await tx
        .update(supportRequestEntries)
        .set({ emailedAt: new Date() })
        .where(and(inWorkspace(supportRequestEntries), eq(supportRequestEntries.id, entry.id)));
      await staffAudit(tx, staffId, "support_request.answered", requestId, { entryId: entry.id });
    });
    return detailInContext(workspaceId, requestId);
  });
}

export async function noteSupportRequest(
  staffId: string,
  requestId: string,
  body: string
): Promise<PlatformSupportRequestDetail> {
  const workspaceId = await workspaceOfRequest(requestId);
  return runWithWorkspaceContext({ workspaceId }, async () => {
    await db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(supportRequestEntries)
        .values(stampWorkspace({ supportRequestId: requestId, kind: "note", body, platformStaffId: staffId }))
        .returning({ id: supportRequestEntries.id });
      await staffAudit(tx, staffId, "support_request.noted", requestId, { entryId: entry.id });
    });
    return detailInContext(workspaceId, requestId);
  });
}

/**
 * Status and assignment, one Audit Event per field that actually changed. A
 * status change tells the User with an in-app Notification and an email; neither
 * repeats the message.
 */
export async function updateSupportRequest(
  staffId: string,
  requestId: string,
  patch: { status?: SupportStatus; assignedStaffId?: string | null }
): Promise<PlatformSupportRequestDetail> {
  const workspaceId = await workspaceOfRequest(requestId);
  if (patch.assignedStaffId) {
    const [assignee] = await db
      .select({ id: platformStaff.id })
      .from(platformStaff)
      .where(eq(platformStaff.id, patch.assignedStaffId))
      .limit(1);
    if (!assignee) throw new PlatformStaffNotFoundError();
  }

  return runWithWorkspaceContext({ workspaceId }, async () => {
    const statusChange = await db.transaction(async (tx) => {
      const [request] = await tx
        .select({
          request: supportRequests,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(supportRequests)
        .innerJoin(users, eq(users.id, supportRequests.userId))
        .where(and(inWorkspace(supportRequests), eq(supportRequests.id, requestId)))
        .for("update", { of: supportRequests })
        .limit(1);
      if (!request) throw new SupportRequestNotFoundError();
      const current = request.request;

      const set: Partial<typeof supportRequests.$inferInsert> = {};
      const statusChanged = patch.status !== undefined && patch.status !== current.status;
      const assignmentChanged =
        patch.assignedStaffId !== undefined && patch.assignedStaffId !== current.assignedStaffId;
      if (statusChanged) set.status = patch.status;
      if (assignmentChanged) set.assignedStaffId = patch.assignedStaffId;
      if (!statusChanged && !assignmentChanged) return null;

      await tx
        .update(supportRequests)
        .set({ ...set, updatedAt: new Date() })
        .where(and(inWorkspace(supportRequests), eq(supportRequests.id, requestId)));

      if (statusChanged) {
        const next = patch.status as SupportStatus;
        await staffAudit(tx, staffId, "support_request.status_changed", requestId, {
          from: current.status,
          to: next,
        });
        await tx.insert(notifications).values({
          ...stampWorkspace({ type: "support_request_status" }),
          userId: current.userId,
          message: `Your Support Request is now ${STATUS_LABEL[next]}.`,
        });
      }
      if (assignmentChanged) {
        await staffAudit(tx, staffId, "support_request.assigned", requestId, {
          platformStaffId: patch.assignedStaffId ?? null,
        });
      }
      return statusChanged
        ? {
            email: request.email,
            name: personName(request),
            status: patch.status as SupportStatus,
          }
        : null;
    });

    // The notice is best effort: the status already changed and is audited.
    if (statusChange) {
      await sendSupportStatusEmail({
        toEmail: statusChange.email,
        recipientName: statusChange.name,
        statusLabel: STATUS_LABEL[statusChange.status],
      });
    }
    return detailInContext(workspaceId, requestId);
  });
}
