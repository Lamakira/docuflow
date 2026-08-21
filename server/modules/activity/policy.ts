/**
 * Tracking Policy — owned by the Activity module (#118, ADR-0008).
 * `org_settings` stays unowned (shared with Time's Work Schedule); this
 * engine reads and writes the screenshot/idle capture rules stored there.
 */

import { eq } from "drizzle-orm";
import {
  DEFAULT_SCREENSHOT_POLICY,
  orgSettings,
  type ScreenshotPolicy,
} from "@shared/schema";
import { db } from "../../db";
import { requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";

/** Handshake-facing revision of Tracking Policy. v1 is the current capture rules. */
export const TRACKING_POLICY_VERSION = 1;

export async function getScreenshotPolicy(): Promise<ScreenshotPolicy> {
  requireWorkspaceContext();
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, "default"));
  return { ...DEFAULT_SCREENSHOT_POLICY, ...(row?.screenshotPolicy ?? {}) };
}

export async function upsertScreenshotPolicy(policy: Partial<ScreenshotPolicy>): Promise<void> {
  const current = await getScreenshotPolicy();
  const merged: ScreenshotPolicy = { ...current, ...policy };
  await db
    .insert(orgSettings)
    .values(stampWorkspace({ id: "default", screenshotPolicy: merged, updatedAt: new Date() }))
    .onConflictDoUpdate({
      target: orgSettings.id,
      set: { screenshotPolicy: merged, updatedAt: new Date() },
    });
}
