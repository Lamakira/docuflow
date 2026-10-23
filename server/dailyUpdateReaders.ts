/**
 * Readers of a new Daily Update (#341). When a Member submits one, every reader
 * of the Workspace gets an in-app notification — no email. A reader is whoever
 * `canViewDailyUpdates` lets into the dashboard: an Owner or Administrator, or
 * a Member granted `can_view_daily_updates`. At most one notification per
 * author, reader and Workspace day, so a Member filing five Projects does not
 * flood the inbox. The caller awaits this inside the request's Workspace context.
 */

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { memberships, users, workspaceRoles } from "@shared/schema";
import { db } from "./db";
import { getWorkspaceTimeZone } from "./modules/time";
import { startOfWorkday, workdayAt } from "./dailyUpdateNudge";
import { storage } from "./storage";
import { requireWorkspaceContext } from "./workspaceContext";

export const DAILY_UPDATE_SUBMITTED_NOTIFICATION = "daily_update_submitted";

/** Active Members who may read the dashboard, the author excluded. */
export async function dailyUpdateReaderIds(authorId: string): Promise<string[]> {
  const { workspaceId } = requireWorkspaceContext();
  const rows = await db
    .select({ id: users.id })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        isNull(memberships.archivedAt),
        eq(users.isArchived, false),
        or(inArray(workspaceRoles.slug, ["owner", "administrator"]), eq(users.canViewDailyUpdates, 1)),
      ),
    );
  return rows.map((row) => row.id).filter((id) => id !== authorId);
}

export async function notifyDailyUpdateReaders(update: {
  userId: string;
  crmProjectId: string;
}): Promise<number> {
  const readers = await dailyUpdateReaderIds(update.userId);
  if (readers.length === 0) return 0;

  const [author, crmProject, timeZone] = await Promise.all([
    storage.getUser(update.userId),
    storage.getCrmProject(update.crmProjectId),
    getWorkspaceTimeZone(),
  ]);
  const authorName = author?.firstName || author?.email || "A Member";
  const projectName = crmProject?.project?.name || "a Project";
  const message = `${authorName} submitted a Daily Update for ${projectName}`;
  const since = startOfWorkday(workdayAt(new Date(), timeZone).workday, timeZone);

  let sent = 0;
  for (const readerId of readers) {
    if (await storage.hasRecentNotification(readerId, DAILY_UPDATE_SUBMITTED_NOTIFICATION, since, update.userId)) {
      continue;
    }
    await storage.createNotification({
      userId: readerId,
      type: DAILY_UPDATE_SUBMITTED_NOTIFICATION,
      fromUserId: update.userId,
      crmProjectId: update.crmProjectId,
      message,
    });
    sent += 1;
  }
  return sent;
}
