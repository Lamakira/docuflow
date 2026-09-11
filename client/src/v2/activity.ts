/**
 * Activity destination (#191).
 * Novelty: expanding a piece of Activity Evidence from its row
 * (spatial consistency). Do not animate: the evidence stream as captures
 * arrive; autoplay of captures.
 */

import { chromeRefusal } from "./chrome";
import { memberName } from "./today";
import type { ScreenshotPolicy } from "@shared/schema";

export const REVIEW_ACTIVITY_EVIDENCE_CAPABILITY = "Review Activity Evidence";

export type ActivityEvidenceInput = {
  id: string;
  capturedAt: Date | string | null;
  userId: string;
  crmProjectId: string;
  timeEntryId: string;
  storageKey: string;
  deletedAt?: Date | string | null;
};

export type ActivityProjectInput = {
  id: string;
  project?: { name?: string | null } | null;
  client?: { name?: string | null } | null;
};

export type ActivityEntryInput = {
  id: string;
  taskId?: string | null;
  task?: { name?: string | null } | null;
  description?: string | null;
};

export type ActivityPerson = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type ActivityInput = {
  now: Date;
  workspaceName: string;
  currentUserId: string;
  canReview: boolean;
  ownerName: string | null;
  requestedUserId: string | null;
  expandedId: string | null;
  policy: ScreenshotPolicy | null;
  projects: ActivityProjectInput[];
  entries: ActivityEntryInput[];
  users: ActivityPerson[];
  evidence: ActivityEvidenceInput[];
};

export type ActivityPolicyLine = {
  label: string;
  value: string;
};

export type ActivityRow = {
  id: string;
  when: string;
  who: string;
  project: string;
  task: string;
  source: string;
  expanded: boolean;
  imageSrc: string;
};

export type ActivityModel = {
  subhead: string;
  empty: boolean;
  emptyCopy: string;
  refusal: string | null;
  policyLines: ActivityPolicyLine[];
  policyFootnote: string;
  rows: ActivityRow[];
  pagePrimary: "case-ink";
};

export type ActivityEvidenceFilter = {
  startDate?: Date | null;
  endDate?: Date | null;
  crmProjectId?: string | null;
  userId?: string | null;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatClock(value: Date): string {
  return `${value.getHours().toString().padStart(2, "0")}:${value.getMinutes().toString().padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatWhen(capturedAt: Date | string | null, now: Date): string {
  const value = parseDate(capturedAt);
  if (!value) return "";
  if (sameDay(value, now)) return formatClock(value);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(value, yesterday)) return "YDA";
  return `${value.getDate()} ${MONTHS[value.getMonth()]}`;
}

function projectLabel(project: ActivityProjectInput | undefined): string {
  const projectName = project?.project?.name?.trim() || "Untitled Project";
  const clientName = project?.client?.name?.trim();
  return clientName ? `${clientName} · ${projectName}` : projectName;
}

function captureSource(storageKey: string): string {
  return storageKey.includes("agent-screenshots") ? "Desktop Device" : "Web session";
}

export function activityEvidencePath(filters: ActivityEvidenceFilter = {}): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate.toISOString());
  if (filters.endDate) params.set("endDate", filters.endDate.toISOString());
  if (filters.crmProjectId) params.set("crmProjectId", filters.crmProjectId);
  if (filters.userId) params.set("userId", filters.userId);
  const query = params.toString();
  return query ? `/api/time-tracking/screenshots?${query}` : "/api/time-tracking/screenshots";
}

export function trackingPolicyPath(): string {
  return "/api/time-tracking/tracking-policy";
}

export function composeTrackingPolicy(policy: ScreenshotPolicy | null): ActivityPolicyLine[] {
  if (!policy) {
    return [{ label: "TRACKING POLICY", value: "Not loaded." }];
  }
  const capture = policy.screenshotsEnabled
    ? `Every ${policy.captureIntervalMinMin}–${policy.captureIntervalMaxMin} min`
    : "Off";
  const hours = policy.activeHoursEnabled
    ? `${policy.activeHoursStart}–${policy.activeHoursEnd}`
    : "Any hours";
  const idle = policy.idlePromptEnabled
    ? `Prompt after ${policy.idleTimeoutMinutes} min`
    : "No idle prompt";
  return [
    { label: "CAPTURE", value: capture },
    { label: "HOURS", value: hours },
    { label: "IDLE", value: idle },
  ];
}

export function composeActivity(input: ActivityInput): ActivityModel {
  const refusal =
    !input.canReview && input.requestedUserId && input.requestedUserId !== input.currentUserId
      ? chromeRefusal({
          kind: "capability",
          capability: REVIEW_ACTIVITY_EVIDENCE_CAPABILITY,
          ownerName: input.ownerName,
        })
      : null;

  const projectsById = new Map(input.projects.map((project) => [project.id, project]));
  const entriesById = new Map(input.entries.map((entry) => [entry.id, entry]));
  const usersById = new Map(input.users.map((user) => [user.id, user]));

  const visible = input.evidence.filter((shot) => {
    if (shot.deletedAt) return false;
    if (input.canReview) return true;
    return shot.userId === input.currentUserId;
  });

  const rows = visible.map((shot) => {
    const entry = entriesById.get(shot.timeEntryId);
    const user = usersById.get(shot.userId);
    return {
      id: shot.id,
      when: formatWhen(shot.capturedAt, input.now),
      who: user ? memberName(user) : "Member",
      project: projectLabel(projectsById.get(shot.crmProjectId)),
      task: entry?.task?.name?.trim() || entry?.description?.trim() || "—",
      source: captureSource(shot.storageKey),
      expanded: input.expandedId === shot.id,
      imageSrc: `/api/time-tracking/screenshots/${shot.id}/image`,
    };
  });

  const empty = rows.length === 0;
  return {
    subhead: `Activity Evidence in ${input.workspaceName}.`,
    empty,
    emptyCopy: empty ? "No Activity Evidence in this Workspace for these filters." : "",
    refusal,
    policyLines: composeTrackingPolicy(input.policy),
    policyFootnote: input.canReview
      ? "You can inspect Activity Evidence allowed in this Workspace."
      : "You can inspect your own Activity Evidence. Capture follows the Tracking Policy applied to you.",
    rows,
    pagePrimary: "case-ink",
  };
}
