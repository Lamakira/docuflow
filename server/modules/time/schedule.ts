/**
 * Work Schedule — owned by the Time module (#117, ADR-0008).
 * `org_settings` stays unowned (shared with Activity's Tracking Policy); this
 * engine reads and writes the workspace timezone list stored there, and the
 * Workspace time zone the Workday is counted in (#341).
 */

import { and, eq } from "drizzle-orm";
import { DEFAULT_ALLOWED_TIMEZONES, DEFAULT_WORKSPACE_TIME_ZONE, orgSettings } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";

export async function getAllowedTimezones(): Promise<string[]> {
  requireWorkspaceContext();
  const [row] = await db
    .select()
    .from(orgSettings)
    .where(and(inWorkspace(orgSettings), eq(orgSettings.id, "default")));
  return row?.allowedTimezones ?? DEFAULT_ALLOWED_TIMEZONES;
}

export async function upsertAllowedTimezones(timezones: string[]): Promise<void> {
  requireWorkspaceContext();
  await db
    .insert(orgSettings)
    .values(stampWorkspace({ id: "default", allowedTimezones: timezones, updatedAt: new Date() }))
    .onConflictDoUpdate({
      target: [orgSettings.workspaceId, orgSettings.id],
      set: { allowedTimezones: timezones, updatedAt: new Date() },
    });
}

/** The Workspace time zone (#341). A Workspace that never saved settings reads the default. */
export async function getWorkspaceTimeZone(): Promise<string> {
  requireWorkspaceContext();
  const [row] = await db
    .select({ timeZone: orgSettings.timeZone })
    .from(orgSettings)
    .where(and(inWorkspace(orgSettings), eq(orgSettings.id, "default")));
  return row?.timeZone ?? DEFAULT_WORKSPACE_TIME_ZONE;
}

/** Callers validate the name first (`isIanaTimeZone`). */
export async function upsertWorkspaceTimeZone(timeZone: string): Promise<void> {
  requireWorkspaceContext();
  await db
    .insert(orgSettings)
    .values(stampWorkspace({ id: "default", timeZone, updatedAt: new Date() }))
    .onConflictDoUpdate({
      target: [orgSettings.workspaceId, orgSettings.id],
      set: { timeZone, updatedAt: new Date() },
    });
}
