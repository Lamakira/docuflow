/**
 * Work Schedule — owned by the Time module (#117, ADR-0008).
 * `org_settings` stays unowned (shared with Activity's Tracking Policy); this
 * engine reads and writes the workspace timezone list stored there.
 */

import { eq } from "drizzle-orm";
import { DEFAULT_ALLOWED_TIMEZONES, orgSettings } from "@shared/schema";
import { db } from "../../db";
import { requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";

export async function getAllowedTimezones(): Promise<string[]> {
  requireWorkspaceContext();
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, "default"));
  return row?.allowedTimezones ?? DEFAULT_ALLOWED_TIMEZONES;
}

export async function upsertAllowedTimezones(timezones: string[]): Promise<void> {
  requireWorkspaceContext();
  await db
    .insert(orgSettings)
    .values(stampWorkspace({ id: "default", allowedTimezones: timezones, updatedAt: new Date() }))
    .onConflictDoUpdate({
      target: orgSettings.id,
      set: { allowedTimezones: timezones, updatedAt: new Date() },
    });
}
