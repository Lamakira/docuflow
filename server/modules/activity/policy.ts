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
import { simultaneousTimersLaunched } from "../../simultaneousTimersLaunch";

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

/**
 * Whether a Member of the current Workspace may add a Timer beside a running
 * one (ADR-0031): the option is on, the launch has passed, and the Plan has
 * Tasks (Starter has one Project and no Tasks, so it never runs two).
 */
export async function simultaneousTimersAllowed(): Promise<boolean> {
  if (!simultaneousTimersLaunched()) return false;
  const [policy, { entitlements }] = await Promise.all([getScreenshotPolicy(), planStanding()]);
  return simultaneousTimersOn(policy, entitlements.features.projectManagement);
}

function simultaneousTimersOn(policy: ScreenshotPolicy, projectManagement: boolean): boolean {
  return policy.simultaneousTimersEnabled && projectManagement && simultaneousTimersLaunched();
}

export class SimultaneousTimersNotLaunchedError extends Error {
  readonly statusCode = 409;
  readonly code = "simultaneous_timers_not_launched";
  constructor() {
    super("Simultaneous Timers are not available yet. They open once every desktop agent can be updated.");
    this.name = "SimultaneousTimersNotLaunchedError";
  }
}

/** Refuses turning the option on before the launch, or on a Plan without Tasks. Turning it off is always allowed. */
export async function assertSimultaneousTimersAvailable(): Promise<void> {
  if (!simultaneousTimersLaunched()) throw new SimultaneousTimersNotLaunchedError();
  const { projection, entitlements } = await planStanding();
  if (!entitlements.features.projectManagement) {
    throw new PlanFeatureNotIncludedError("projectManagement", projection.planKey, "use");
  }
}

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
    simultaneousTimersEnabled: simultaneousTimersOn(policy, entitlements.features.projectManagement),
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

export class CaptureIntervalOrderError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Min capture interval cannot exceed max");
    this.name = "CaptureIntervalOrderError";
  }
}

type Executor = Pick<typeof db, "select" | "insert">;

/**
 * Merges a partial policy into the stored one. Pass the transaction to save it
 * with other settings at once (F108): the stored row is then locked while it
 * is merged. The interval pair is checked on the merged policy, and only when
 * the change touches it, so a pair already out of order does not refuse every
 * other save.
 */
export async function upsertScreenshotPolicy(
  policy: Partial<ScreenshotPolicy>,
  executor: Executor = db,
): Promise<void> {
  requireWorkspaceContext();
  const [row] = await executor
    .select({ screenshotPolicy: orgSettings.screenshotPolicy })
    .from(orgSettings)
    .where(and(inWorkspace(orgSettings), eq(orgSettings.id, "default")))
    .for("update");
  const merged: ScreenshotPolicy = { ...DEFAULT_SCREENSHOT_POLICY, ...(row?.screenshotPolicy ?? {}), ...policy };
  const touchesInterval = policy.captureIntervalMinMin !== undefined || policy.captureIntervalMaxMin !== undefined;
  if (touchesInterval && merged.captureIntervalMinMin > merged.captureIntervalMaxMin) {
    throw new CaptureIntervalOrderError();
  }
  await executor
    .insert(orgSettings)
    .values(stampWorkspace({ id: "default", screenshotPolicy: merged, updatedAt: new Date() }))
    .onConflictDoUpdate({
      target: [orgSettings.workspaceId, orgSettings.id],
      set: { screenshotPolicy: merged, updatedAt: new Date() },
    });
}
