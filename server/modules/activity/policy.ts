/**
 * Tracking Policy — owned by the Activity module (#118, ADR-0008).
 * `org_settings` stays unowned (shared with Time's Work Schedule); this
 * engine reads and writes the screenshot/idle capture rules stored there.
 */

import { and, eq } from "drizzle-orm";
import {
  DEFAULT_SCREENSHOT_POLICY,
  orgSettings,
  type ScreenshotPolicy,
} from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import { planStanding } from "../billing/entitlements";
import { PlanFeatureNotIncludedError } from "../billing/featureGate";

/** Handshake-facing revision of Tracking Policy. v1 is the current capture rules. */
export const TRACKING_POLICY_VERSION = 1;

export async function getScreenshotPolicy(): Promise<ScreenshotPolicy> {
  requireWorkspaceContext();
  const [row] = await db
    .select()
    .from(orgSettings)
    .where(and(inWorkspace(orgSettings), eq(orgSettings.id, "default")));
  return { ...DEFAULT_SCREENSHOT_POLICY, ...(row?.screenshotPolicy ?? {}) };
}

/**
 * The Tracking Policy as a Device must apply it: the stored rules narrowed by
 * the Plan (#299). A Plan with a screenshot Project capacity captures only on
 * the chosen Projects; a Plan without activity capture sends no activity and
 * never pauses on idle.
 */
export type DeliveredTrackingPolicy = ScreenshotPolicy & {
  activityCaptureEnabled: boolean;
  screenshotProjectCapacity: number | null;
};

export async function deliveredTrackingPolicy(
  runningCrmProjectId?: string | null
): Promise<DeliveredTrackingPolicy> {
  const [policy, { entitlements }] = await Promise.all([getScreenshotPolicy(), planStanding()]);
  const capacity = entitlements.screenshotProjectCapacity;
  const screenshotProjectIds =
    capacity === null ? null : (policy.screenshotProjectIds ?? []).slice(0, capacity);
  const onChosenProject =
    screenshotProjectIds === null ||
    runningCrmProjectId === undefined ||
    (runningCrmProjectId !== null && screenshotProjectIds.includes(runningCrmProjectId));
  return {
    ...policy,
    screenshotsEnabled: policy.screenshotsEnabled && onChosenProject,
    screenshotProjectIds,
    activityCaptureEnabled: entitlements.features.activityCapture,
    screenshotProjectCapacity: capacity,
  };
}

/** Refuses a screenshot on a Project outside the Plan's screenshot capacity. */
export async function assertScreenshotProject(crmProjectId: string | null): Promise<void> {
  const [policy, { projection, entitlements }] = await Promise.all([
    getScreenshotPolicy(),
    planStanding(),
  ]);
  const capacity = entitlements.screenshotProjectCapacity;
  if (capacity === null) return;
  const chosen = (policy.screenshotProjectIds ?? []).slice(0, capacity);
  if (crmProjectId && chosen.includes(crmProjectId)) return;
  throw new PlanFeatureNotIncludedError("screenshotProjects", projection.planKey, "use", capacity);
}

/** Refuses a Tracking Policy that names more screenshot Projects than the Plan allows. */
export async function assertScreenshotProjectCapacity(ids: string[] | null | undefined): Promise<void> {
  const { projection, entitlements } = await planStanding();
  const capacity = entitlements.screenshotProjectCapacity;
  if (capacity === null || !ids || ids.length <= capacity) return;
  throw new PlanFeatureNotIncludedError("screenshotProjects", projection.planKey, "use", capacity);
}

export async function upsertScreenshotPolicy(policy: Partial<ScreenshotPolicy>): Promise<void> {
  const current = await getScreenshotPolicy();
  const merged: ScreenshotPolicy = { ...current, ...policy };
  await db
    .insert(orgSettings)
    .values(stampWorkspace({ id: "default", screenshotPolicy: merged, updatedAt: new Date() }))
    .onConflictDoUpdate({
      target: [orgSettings.workspaceId, orgSettings.id],
      set: { screenshotPolicy: merged, updatedAt: new Date() },
    });
}
