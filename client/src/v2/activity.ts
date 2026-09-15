/**
 * Activity destination (#191), with the v1 capture gallery beside the
 * evidence register (#214).
 * Novelty: expanding a piece of Activity Evidence from its row
 * (spatial consistency). Do not animate: the evidence stream as captures
 * arrive; autoplay of captures; thumbnail layout shift; gallery filter applying.
 */

import { chromeRefusal } from "./chrome";
import { activityTabHref, ACTIVITY_TAB_IDS, type ActivityTabId } from "./presentation";
import {
  endOfDayLocal,
  startOfDayLocal,
  timePeriodLabel,
  timePeriodRange,
  TIME_PERIODS,
  type TimePeriod,
} from "./time";
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

export type ActivityRow = EvidenceProvenance & {
  id: string;
  expanded: boolean;
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
  /** The BFF caps this at 100; the gallery asks for one page of captures. */
  limit?: number | null;
  offset?: number | null;
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
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
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

/**
 * What a piece of Activity Evidence says about itself: when, who, and the
 * Project and Task it belongs to. The register row and the gallery tile are
 * two presentations of this one description, so it is derived in one place.
 */
export type EvidenceProvenance = {
  when: string;
  who: string;
  project: string;
  task: string;
  source: string;
  imageSrc: string;
};

type EvidenceLookup = {
  projectsById: Map<string, ActivityProjectInput>;
  entriesById: Map<string, ActivityEntryInput>;
  usersById: Map<string, ActivityPerson>;
};

function evidenceLookup(input: {
  projects: ActivityProjectInput[];
  entries: ActivityEntryInput[];
  users: ActivityPerson[];
}): EvidenceLookup {
  return {
    projectsById: new Map(input.projects.map((project) => [project.id, project])),
    entriesById: new Map(input.entries.map((entry) => [entry.id, entry])),
    usersById: new Map(input.users.map((user) => [user.id, user])),
  };
}

function evidenceProvenance(
  shot: ActivityEvidenceInput,
  lookup: EvidenceLookup,
  now: Date,
): EvidenceProvenance {
  const entry = lookup.entriesById.get(shot.timeEntryId);
  const user = lookup.usersById.get(shot.userId);
  return {
    when: formatWhen(shot.capturedAt, now),
    who: user ? memberName(user) : "Member",
    project: projectLabel(lookup.projectsById.get(shot.crmProjectId)),
    task: entry?.task?.name?.trim() || entry?.description?.trim() || "—",
    source: captureSource(shot.storageKey),
    imageSrc: `/api/time-tracking/screenshots/${shot.id}/image`,
  };
}

/** Evidence this User is allowed to inspect: their own, or all of it. */
function allowedEvidence<T extends ActivityEvidenceInput>(
  evidence: T[],
  opts: { canReview: boolean; currentUserId: string },
): T[] {
  return evidence.filter((shot) => {
    if (shot.deletedAt) return false;
    if (opts.canReview) return true;
    return shot.userId === opts.currentUserId;
  });
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

  const lookup = evidenceLookup(input);
  const visible = allowedEvidence(input.evidence, input);

  const rows = visible.map((shot) => ({
    id: shot.id,
    ...evidenceProvenance(shot, lookup, input.now),
    expanded: input.expandedId === shot.id,
  }));

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

/* ---------------------------------------------------------------------------
 * Activity Evidence gallery (#214) — the v1 screenshot gallery over the same
 * `/api/time-tracking/screenshots` contract: hour groups, the low-activity and
 * identical filters, and a batch download. Still no scores: a low-activity
 * capture is flagged as a fact about its Time Entry, never scored or ranked.
 * ------------------------------------------------------------------------ */

const ACTIVITY_TAB_LABEL: Record<ActivityTabId, string> = {
  register: "Evidence",
  gallery: "Gallery",
};

export type ActivityTab = { id: ActivityTabId; label: string; href: string; active: boolean };

/**
 * The date filters v1 offered over captures: the periods Time stats share,
 * plus one named day and an arbitrary span — the two ways a Member audits a
 * particular Workday rather than a rolling window.
 */
export const EVIDENCE_DATE_MODES = [...TIME_PERIODS, "day", "custom"] as const;

export type EvidenceDateMode = (typeof EVIDENCE_DATE_MODES)[number];

export function evidenceDateLabel(mode: EvidenceDateMode): string {
  if (mode === "day") return "A day";
  if (mode === "custom") return "Custom span";
  return timePeriodLabel(mode);
}

/** A calendar date the User typed, read in their own timezone, not UTC. */
function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const parsed = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function evidenceDateRange(
  mode: EvidenceDateMode,
  now: Date,
  typed: { day?: string | null; from?: string | null; to?: string | null },
): { startDate: Date | null; endDate: Date | null } {
  if (mode === "day") {
    const day = parseCalendarDate(typed.day);
    // A half-written date asks for nothing rather than guessing a boundary.
    if (!day) return { startDate: null, endDate: null };
    return { startDate: startOfDayLocal(day), endDate: endOfDayLocal(day) };
  }
  if (mode === "custom") {
    const from = parseCalendarDate(typed.from);
    const to = parseCalendarDate(typed.to);
    if (!from || !to) return { startDate: null, endDate: null };
    return { startDate: startOfDayLocal(from), endDate: endOfDayLocal(to) };
  }
  return timePeriodRange(mode as TimePeriod, now);
}

export function activityTabs(active: ActivityTabId): ActivityTab[] {
  return ACTIVITY_TAB_IDS.map((id) => ({
    id,
    label: ACTIVITY_TAB_LABEL[id],
    href: activityTabHref(id),
    active: id === active,
  }));
}

export type GalleryEvidenceInput = ActivityEvidenceInput & {
  contentHash?: string | null;
  entryDuration?: number | null;
  entryIdleTime?: number | null;
};

export type ActivityGalleryInput = {
  now: Date;
  currentUserId: string;
  canReview: boolean;
  lowActivityOnly: boolean;
  identicalOnly: boolean;
  selectedIds: string[];
  expandedId: string | null;
  /** Server paging over the capture set, so a long day is never silently cut. */
  page: number;
  pageSize: number;
  total: number;
  projects: ActivityProjectInput[];
  entries: ActivityEntryInput[];
  users: ActivityPerson[];
  evidence: GalleryEvidenceInput[];
};

export type GalleryTile = EvidenceProvenance & {
  id: string;
  fileName: string;
  selected: boolean;
  expanded: boolean;
  /**
   * Whether this capture's content repeats inside the shown set. It is a fact
   * about the image, not a judgement about the Member — which is why there is
   * no matching per-capture low-activity flag: that lens stays a filter.
   */
  identical: boolean;
};

export type GalleryGroup = {
  key: string;
  hourLabel: string;
  dateLabel: string;
  tiles: GalleryTile[];
};

export type GalleryPaging = {
  page: number;
  pageCount: number;
  label: string;
  hasPrevious: boolean;
  hasNext: boolean;
};

export type ActivityGalleryModel = {
  groups: GalleryGroup[];
  count: number;
  countCopy: string;
  identicalCount: number;
  selectedCount: number;
  canBatch: boolean;
  batchLabel: string;
  paging: GalleryPaging;
  empty: boolean;
  emptyCopy: string;
};

/** Idle over half of the Time Entry's tracked span, as v1 counted it. */
function isLowActivity(shot: GalleryEvidenceInput): boolean {
  const duration = shot.entryDuration ?? 0;
  const idle = shot.entryIdleTime ?? 0;
  const total = duration + idle;
  return total > 0 && idle / total > 0.5;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function evidenceFileName(capturedAt: Date | string | null): string {
  const value = parseDate(capturedAt);
  if (!value) return "activity-evidence.png";
  const day = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const clock = `${pad(value.getHours())}-${pad(value.getMinutes())}-${pad(value.getSeconds())}`;
  return `activity-evidence-${day}_${clock}.png`;
}

function dayStamp(value: Date): string {
  return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
}

export function composeActivityGallery(input: ActivityGalleryInput): ActivityGalleryModel {
  const lookup = evidenceLookup(input);
  const selected = new Set(input.selectedIds);
  const visible = allowedEvidence(input.evidence, input);

  // Identical means the same content hash shows up more than once in what the
  // current filters returned — the same window captured twice over.
  const hashCounts = new Map<string, number>();
  for (const shot of visible) {
    if (!shot.contentHash) continue;
    hashCounts.set(shot.contentHash, (hashCounts.get(shot.contentHash) ?? 0) + 1);
  }
  const identicalIds = new Set(
    visible
      .filter((shot) => shot.contentHash && (hashCounts.get(shot.contentHash) ?? 0) > 1)
      .map((shot) => shot.id),
  );

  const shown = visible
    .filter((shot) => {
      if (input.lowActivityOnly && !isLowActivity(shot)) return false;
      if (input.identicalOnly && !identicalIds.has(shot.id)) return false;
      return true;
    })
    // Inside an hour, captures read forward in time.
    .sort((a, b) => (parseDate(a.capturedAt)?.getTime() ?? 0) - (parseDate(b.capturedAt)?.getTime() ?? 0));

  const groups = new Map<string, GalleryGroup>();
  for (const shot of shown) {
    const captured = parseDate(shot.capturedAt);
    if (!captured) continue;
    const key = `${captured.getFullYear()}-${pad(captured.getMonth() + 1)}-${pad(captured.getDate())}_${pad(captured.getHours())}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        hourLabel: `${pad(captured.getHours())}:00`,
        dateLabel: dayStamp(captured),
        tiles: [],
      };
      groups.set(key, group);
    }
    group.tiles.push({
      id: shot.id,
      ...evidenceProvenance(shot, lookup, input.now),
      fileName: evidenceFileName(shot.capturedAt),
      selected: selected.has(shot.id),
      expanded: input.expandedId === shot.id,
      identical: identicalIds.has(shot.id),
    });
  }

  // Newest hour first.
  const ordered = [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));

  const count = shown.length;
  const selectedCount = shown.filter((shot) => selected.has(shot.id)).length;

  const pageSize = Math.max(1, input.pageSize);
  const total = Math.max(0, input.total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, input.page), pageCount);
  const firstOnPage = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(page * pageSize, total);

  return {
    groups: ordered,
    count,
    countCopy: count === 1 ? "1 capture" : `${count} captures`,
    identicalCount: identicalIds.size,
    selectedCount,
    canBatch: selectedCount > 0,
    batchLabel:
      selectedCount === 1 ? "Download 1 capture" : `Download ${selectedCount} captures`,
    paging: {
      page,
      pageCount,
      label:
        total === 0
          ? "No capture to page through"
          : `Showing ${firstOnPage}–${lastOnPage} of ${total} captures`,
      hasPrevious: page > 1,
      hasNext: page < pageCount,
    },
    empty: count === 0,
    emptyCopy: "No Activity Evidence in this Workspace for these filters.",
  };
}
