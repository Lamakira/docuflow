/**
 * Feature Entitlements on the server (#299, ADR-0027). The Plan decides which
 * areas a Workspace may use; the Workspace Role and Capabilities still decide
 * who may use them. A refusal names the Plan that would include the area.
 *
 * Two modes. `use` areas are the feature itself (Ask, analytics, exports,
 * activity capture) and are refused outright. `write` areas hold data (CRM,
 * Project management, Knowledge): reads stay open so data kept from a richer
 * Plan stays visible after a downgrade, and every change is refused.
 */

import {
  FEATURE_LABEL,
  PLAN_LABEL,
  minimumPlanFor,
  unlimitedScreenshotPlan,
  type Entitlements,
  type FeatureKey,
  type PlanKey,
} from "./planRegistry";
import { planStanding } from "./entitlements";

export type FeatureMode = "use" | "write";

export const PLAN_UPGRADE_REQUIRED = "plan_upgrade_required";

function sentenceStart(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export class PlanFeatureNotIncludedError extends Error {
  readonly statusCode = 403;
  readonly code = PLAN_UPGRADE_REQUIRED;
  readonly requiredPlan: PlanKey;

  constructor(
    readonly feature: FeatureKey | "screenshotProjects",
    readonly planKey: PlanKey,
    readonly mode: FeatureMode,
    capacity?: number
  ) {
    const requiredPlan =
      feature === "screenshotProjects" ? unlimitedScreenshotPlan() : minimumPlanFor(feature);
    const plan = PLAN_LABEL[planKey];
    const upgrade = PLAN_LABEL[requiredPlan];
    super(
      feature === "screenshotProjects"
        ? `The ${plan} Plan captures screenshots on ${capacity ?? 1} Project. Upgrade to ${upgrade} to capture them on every Project.`
        : mode === "write"
          ? `${sentenceStart(FEATURE_LABEL[feature])} are read-only on the ${plan} Plan. Upgrade to ${upgrade} to make changes.`
          : `The ${plan} Plan does not include ${FEATURE_LABEL[feature]}. Upgrade to ${upgrade} to use it.`
    );
    this.name = "PlanFeatureNotIncludedError";
    this.requiredPlan = requiredPlan;
  }

  body() {
    return {
      message: this.message,
      code: this.code,
      feature: this.feature,
      requiredPlan: this.requiredPlan,
    };
  }
}

type FeatureRoute = { feature: FeatureKey; mode: FeatureMode; path: RegExp };

/**
 * HTTP areas by feature. First match wins, so the payroll export sits ahead of
 * the analytics it lives under. Time tracking, Projects, People, Devices and
 * Daily Updates are in no Plan's way and are absent on purpose.
 */
const FEATURE_ROUTES: FeatureRoute[] = [
  { feature: "knowledge", mode: "use", path: /^\/api\/chat(\/|$)/ },
  {
    feature: "knowledge",
    mode: "write",
    path: /^\/api\/(documents|company-documents|company-document-folders|document-attachments|document-images|audio|transcripts|embeddings)(\/|$)/,
  },
  { feature: "knowledge", mode: "write", path: /^\/api\/projects\/[^/]+\/(documents|files)(\/|$)/ },
  { feature: "knowledge", mode: "write", path: /^\/api\/crm\/projects\/[^/]+\/documentation$/ },
  { feature: "crm", mode: "write", path: /^\/api\/crm\/(clients|contacts|tags)(\/|$)/ },
  { feature: "crm", mode: "write", path: /^\/api\/crm\/projects\/[^/]+\/(tags|lost)(\/|$)/ },
  { feature: "crm", mode: "write", path: /^\/api\/admin\/(fields|system-lists)(\/|$)/ },
  { feature: "projectManagement", mode: "write", path: /^\/api\/(tasks|reminders)(\/|$)/ },
  { feature: "projectManagement", mode: "write", path: /^\/api\/agent\/tasks$/ },
  {
    feature: "projectManagement",
    mode: "write",
    path: /^\/api\/crm\/projects\/[^/]+\/(notes|reminders|clone)(\/|$)/,
  },
  { feature: "payrollExports", mode: "use", path: /^\/api\/admin\/analytics\/export$/ },
  { feature: "advancedAnalytics", mode: "use", path: /^\/api\/admin\/analytics(\/|$)/ },
  { feature: "activityCapture", mode: "use", path: /^\/api\/agent\/events\/batch$/ },
  { feature: "crm", mode: "write", path: /^\/api\/v1\/clients(\/|$)/ },
];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function featureForRequest(
  method: string,
  path: string
): { feature: FeatureKey; mode: FeatureMode } | null {
  const route = FEATURE_ROUTES.find((candidate) => candidate.path.test(path));
  if (!route) return null;
  if (route.mode === "write" && !MUTATING.has(method.toUpperCase())) return null;
  return { feature: route.feature, mode: route.mode };
}

/** Refuses the request when the Workspace's Plan leaves its area out. */
export async function assertRequestEntitled(method: string, path: string): Promise<void> {
  const classified = featureForRequest(method, path);
  if (!classified) return;
  await assertFeature(classified.feature, classified.mode);
}

export async function assertFeature(feature: FeatureKey, mode: FeatureMode = "use"): Promise<void> {
  const { projection, entitlements } = await planStanding();
  if (!entitlements.features[feature]) {
    throw new PlanFeatureNotIncludedError(feature, projection.planKey, mode);
  }
}

export async function featureIncluded(feature: FeatureKey): Promise<boolean> {
  return (await planStanding()).entitlements.features[feature];
}

type ProjectWrite = {
  clientId?: unknown;
  status?: unknown;
  budgetedHours?: unknown;
  budgetedMinutes?: unknown;
  actualHours?: unknown;
  documentationEnabled?: unknown;
  isDocumentationOnly?: unknown;
  opportunityOwnerId?: unknown;
  source?: unknown;
  estimatedValueMinor?: unknown;
  estimatedValueCurrency?: unknown;
  lostReason?: unknown;
  lostReasonDetail?: unknown;
};

type ProjectRow = { [K in keyof ProjectWrite]?: unknown };

const CRM_FIELDS = [
  "opportunityOwnerId",
  "source",
  "estimatedValueMinor",
  "estimatedValueCurrency",
  "lostReason",
  "lostReasonDetail",
] as const;

function set(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "" && value !== 0 && value !== false;
}

function changes(value: unknown, current: unknown): boolean {
  if (value === undefined) return false;
  const normalized = typeof value === "boolean" ? (value ? 1 : 0) : value;
  return (normalized ?? null) !== (current ?? null) && set(value);
}

/**
 * A light Project (#299): Starter tracks time against a named Project. A
 * Client, an Opportunity, a budget, or documentation is the area that carries
 * it and answers for itself. Unchanged values on an update pass, so a Project
 * kept from a richer Plan can still be renamed.
 */
export function projectWriteFeature(
  entitlements: Pick<Entitlements, "features">,
  body: ProjectWrite,
  options: { opportunity: boolean; current?: ProjectRow }
): FeatureKey | null {
  const { features } = entitlements;
  const current = options.current;
  const writes = (fields: readonly (keyof ProjectWrite)[]) =>
    fields.some((field) => (current ? changes(body[field], current[field]) : set(body[field])));
  if (!features.crm && (options.opportunity || writes(["clientId", ...CRM_FIELDS]))) return "crm";
  if (!features.projectManagement && writes(["budgetedHours", "budgetedMinutes", "actualHours"])) {
    return "projectManagement";
  }
  if (!features.knowledge && writes(["documentationEnabled", "isDocumentationOnly"])) {
    return "knowledge";
  }
  return null;
}
