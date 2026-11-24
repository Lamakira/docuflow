/**
 * Activity destination (#191), with the v1 capture gallery beside the
 * evidence register (#214).
 * Novelty: expanding a piece of Activity Evidence from its row
 * (spatial consistency). Do not animate: the evidence stream as captures
 * arrive; autoplay of captures; thumbnail layout shift; gallery filter applying.
 */

import { chromeRefusal } from "./chrome";
import { emptyKindOf, emptyModelOf, type EmptyModel } from "./emptyState";
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
import {
  DEFAULT_LOW_ACTIVITY_THRESHOLD_PERCENT,
  hasActivityData,
  isLowActivityCapture,
} from "@shared/activityEvidence";
import { MONTHS, dateToDay, dayToDate, formatFullDate } from "./dates";
import { composePaging, DEFAULT_REGISTER_PAGE_SIZE, readPage, readPageSize, writePaging } from "./paging";

export const REVIEW_ACTIVITY_EVIDENCE_CAPABILITY = "Review Activity Evidence";

export type ActivityPerson = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
};

/** One row of GET /api/time-tracking/screenshots: the names come with the capture. */
export type ActivityEvidenceInput = {
  id: string;
  capturedAt: Date | string | null;
  userId: string;
  crmProjectId: string;
  timeEntryId: string;
  source: "device" | "web";
  user: ActivityPerson | null;
  projectName: string | null;
  clientName: string | null;
  taskName: string | null;
  keyboardActivityPercent?: number | null;
  mouseActivityPercent?: number | null;
  keyboardCount?: number | null;
  mouseCount?: number | null;
  similarToPrevious?: boolean;
  entryDuration?: number | null;
  entryIdleTime?: number | null;
};

export type ActivityInput = {
  now: Date;
  currentUserId: string;
  canReview: boolean;
  ownerName: string | null;
  requestedUserId: string | null;
  expandedId: string | null;
  policy: ScreenshotPolicy | null;
  evidence: ActivityEvidenceInput[];
  /** Whether a Project, Member, Low activity or Similar filter narrows the stream (the date range is not one). */
  facetsActive?: boolean;
  /** Whether the reader may see any Activity Evidence in any period; `null` while unknown. */
  everRecorded?: boolean | null;
  /** The date range being read; "today" when absent. */
  range?: EvidenceDateMode;
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
  empty: boolean;
  /** `filtered`: a Project or Member filter hides it; `range`: nothing for the date range (#325). */
  emptyState: EmptyModel | null;
  refusal: string | null;
  policyLines: ActivityPolicyLine[];
  /** Said to Members only; an Owner or Administrator reads everything, so there is nothing to explain. */
  policyFootnote: string | null;
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
  /** Only captures whose minute was low activity, judged by the server over the whole period. */
  lowActivity?: boolean;
  /** Only captures Similar to the previous one, judged by the server over the whole period. */
  similar?: boolean;
};

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

/** Always with the time, so two captures of a past day can be told apart (F78). */
function formatWhen(capturedAt: Date | string | null, now: Date): string {
  const value = parseDate(capturedAt);
  if (!value) return "";
  const clock = formatClock(value);
  if (sameDay(value, now)) return clock;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(value, yesterday)) return `Yesterday, ${clock}`;
  const date = `${value.getDate()} ${MONTHS[value.getMonth()]}`;
  return value.getFullYear() === now.getFullYear() ? `${date}, ${clock}` : `${date} ${value.getFullYear()}, ${clock}`;
}

function projectLabel(shot: Pick<ActivityEvidenceInput, "projectName" | "clientName">): string {
  const projectName = shot.projectName?.trim() || "Untitled Project";
  const clientName = shot.clientName?.trim();
  return clientName ? `${clientName} · ${projectName}` : projectName;
}

function captureSource(source: ActivityEvidenceInput["source"]): string {
  return source === "device" ? "Desktop Device" : "Web session";
}

export function activityEvidencePath(filters: ActivityEvidenceFilter = {}): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate.toISOString());
  if (filters.endDate) params.set("endDate", filters.endDate.toISOString());
  if (filters.crmProjectId) params.set("crmProjectId", filters.crmProjectId);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  if (filters.lowActivity) params.set("lowActivity", "1");
  if (filters.similar) params.set("similar", "1");
  const query = params.toString();
  return query ? `/api/time-tracking/screenshots?${query}` : "/api/time-tracking/screenshots";
}

export function trackingPolicyPath(): string {
  return "/api/time-tracking/tracking-policy";
}

export function composeTrackingPolicy(policy: ScreenshotPolicy | null): ActivityPolicyLine[] {
  if (!policy) {
    return [{ label: "Tracking policy", value: "Not loaded." }];
  }
  const capture = policy.screenshotsEnabled
    ? `Every ${policy.captureIntervalMinMin}-${policy.captureIntervalMaxMin} min`
    : "Off";
  const hours = policy.activeHoursEnabled
    ? `${policy.activeHoursStart}-${policy.activeHoursEnd}, computer clock`
    : "Any hours";
  const idle = policy.idlePromptEnabled
    ? `Pause after ${policy.idleTimeoutMinutes} min, asked first`
    : `Pause after ${policy.idleTimeoutMinutes} min, without asking`;
  return [
    { label: "Capture", value: capture },
    { label: "Hours", value: hours },
    { label: "Idle", value: idle },
    {
      label: "Low activity",
      value: `Below ${policy.lowActivityThresholdPercent ?? DEFAULT_LOW_ACTIVITY_THRESHOLD_PERCENT} % keyboard and mouse`,
    },
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

function evidenceProvenance(shot: ActivityEvidenceInput, now: Date): EvidenceProvenance {
  return {
    when: formatWhen(shot.capturedAt, now),
    who: shot.user ? memberName(shot.user) : "Member",
    project: projectLabel(shot),
    task: shot.taskName?.trim() || "-",
    source: captureSource(shot.source),
    imageSrc: `/api/time-tracking/screenshots/${shot.id}/image`,
  };
}

/** Evidence this User is allowed to inspect: their own, or all of it. */
function allowedEvidence<T extends ActivityEvidenceInput>(
  evidence: T[],
  opts: { canReview: boolean; currentUserId: string },
): T[] {
  return evidence.filter((shot) => opts.canReview || shot.userId === opts.currentUserId);
}

/**
 * Activity Evidence is a stream over a date range: it invites first use only
 * once the reader is known to see none in any period.
 */
function evidenceEmptyState(
  empty: boolean,
  filtered: boolean,
  everRecorded: boolean | null = null,
  range: EvidenceDateMode = "today",
): EmptyModel | null {
  const wider = widerEvidenceRange(range);
  return emptyModelOf(
    emptyKindOf(empty, filtered, range !== "all", everRecorded),
    "Activity Evidence",
    {
      title: "No Activity Evidence yet",
      copy: "Activity Evidence is captured by the desktop agent while a Member's Timer runs, following the Tracking Policy above.",
    },
    {
      window: EVIDENCE_RANGE_WINDOW[range],
      widenLabel: wider ? `Show ${evidenceDateLabel(wider).toLowerCase()}` : null,
    },
  );
}

/** The Range one step wider than this one; `null` when it is already All time. */
export function widerEvidenceRange(mode: EvidenceDateMode): EvidenceDateMode | null {
  switch (mode) {
    case "today":
      return "week";
    case "week":
      return "month";
    case "month":
      return "30d";
    case "30d":
    case "day":
    case "custom":
      return "all";
    default:
      return null;
  }
}

/** How the empty title names the period, after "No Activity Evidence". */
const EVIDENCE_RANGE_WINDOW: Record<EvidenceDateMode, string> = {
  today: "today",
  week: "this week",
  month: "this month",
  "30d": "in the last 30 days",
  day: "on this day",
  custom: "in these dates",
  all: "in this Workspace",
};

export function composeActivity(input: ActivityInput): ActivityModel {
  const refusal =
    !input.canReview && input.requestedUserId && input.requestedUserId !== input.currentUserId
      ? chromeRefusal({
          kind: "capability",
          capability: REVIEW_ACTIVITY_EVIDENCE_CAPABILITY,
          ownerName: input.ownerName,
        })
      : null;

  const visible = allowedEvidence(input.evidence, input);

  const rows = visible.map((shot) => ({
    id: shot.id,
    ...evidenceProvenance(shot, input.now),
    expanded: input.expandedId === shot.id,
  }));

  const empty = rows.length === 0;
  return {
    empty,
    emptyState: evidenceEmptyState(empty, Boolean(input.facetsActive), input.everRecorded ?? null, input.range),
    refusal,
    policyLines: composeTrackingPolicy(input.policy),
    policyFootnote: input.canReview
      ? null
      : "You can inspect your own Activity Evidence. Capture follows the Tracking Policy applied to you.",
    rows,
    pagePrimary: "case-ink",
  };
}

/* ---------------------------------------------------------------------------
 * Activity Evidence gallery (#214) — the v1 screenshot gallery over the same
 * `/api/time-tracking/screenshots` contract: hour groups, the Low activity and
 * Similar filters, and a batch download. Still no scores and no ranking of
 * people: the keyboard and mouse share of the minute before a capture, whether
 * it is low activity and whether it is Similar to the previous capture are
 * facts about that capture. The server applies both lenses over the whole
 * period (#341), so the model never re-filters a page.
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

/** Why a day or span cannot be asked yet; `null` when the range can be read. */
export function evidenceRangeProblem(
  mode: EvidenceDateMode,
  typed: { day?: string | null; from?: string | null; to?: string | null },
): string | null {
  if (mode === "day") return typed.day ? null : "Choose a day.";
  if (mode !== "custom") return null;
  if (!typed.from || !typed.to) return "Choose both dates.";
  return typed.to < typed.from ? "The end date is before the start date." : null;
}

/* ---------------------------------------------------------------------------
 * The filters, in the address (F77). Defaults are left out; an unknown value
 * reads as its default. Old links carry `crmProjectId` and mean All time.
 * ------------------------------------------------------------------------ */

export type ActivityFilters = {
  range: EvidenceDateMode;
  day: string;
  from: string;
  to: string;
  project: string;
  member: string;
  low: boolean;
  similar: boolean;
  archived: boolean;
  page: number;
  pageSize: number;
};

export const ACTIVITY_FILTERS_DEFAULT: ActivityFilters = {
  range: "today",
  day: "",
  from: "",
  to: "",
  project: "all",
  member: "all",
  low: false,
  similar: false,
  archived: false,
  page: 1,
  pageSize: DEFAULT_REGISTER_PAGE_SIZE,
};

function readDay(params: URLSearchParams, name: string): string {
  const value = params.get(name) ?? "";
  const date = dayToDate(value);
  // 2026-13-40 would roll over into a real date; only a day that reads back as itself counts.
  return date && dateToDay(date) === value ? value : "";
}

export function readActivityFilters(search: string): ActivityFilters {
  const params = new URLSearchParams(search);
  const legacyProject = params.get("crmProjectId")?.trim() || "";
  const asked = params.get("range") ?? "";
  const range = (EVIDENCE_DATE_MODES as readonly string[]).includes(asked)
    ? (asked as EvidenceDateMode)
    : legacyProject
      ? "all"
      : ACTIVITY_FILTERS_DEFAULT.range;
  return {
    range,
    day: readDay(params, "day"),
    from: readDay(params, "from"),
    to: readDay(params, "to"),
    project: params.get("project")?.trim() || legacyProject || "all",
    member: params.get("member")?.trim() || "all",
    low: params.get("low") === "1",
    similar: params.get("similar") === "1",
    archived: params.get("archived") === "1",
    page: readPage(params),
    pageSize: readPageSize(params),
  };
}

export function writeActivityFilters(search: string, filters: ActivityFilters): string {
  const params = new URLSearchParams(search);
  params.delete("crmProjectId");
  const set = (name: string, value: string, fallback: string) => {
    if (value !== fallback) params.set(name, value);
    else params.delete(name);
  };
  set("range", filters.range, ACTIVITY_FILTERS_DEFAULT.range);
  set("day", filters.range === "day" ? filters.day : "", "");
  set("from", filters.range === "custom" ? filters.from : "", "");
  set("to", filters.range === "custom" ? filters.to : "", "");
  set("project", filters.project, "all");
  set("member", filters.member, "all");
  for (const name of ["low", "similar", "archived"] as const) {
    if (filters[name]) params.set(name, "1");
    else params.delete(name);
  }
  writePaging(params, filters.page, filters.pageSize);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Whether a Project, Member, Low activity, Similar or archived filter is set (the range is not one). */
export function hasActivityFacets(filters: ActivityFilters): boolean {
  return (
    filters.project !== "all" || filters.member !== "all" || filters.low || filters.similar || filters.archived
  );
}

/** Clear filters keeps the range and goes back to the first page. */
export function clearActivityFacets(filters: ActivityFilters): ActivityFilters {
  return { ...filters, project: "all", member: "all", low: false, similar: false, archived: false, page: 1 };
}

/** The foot of both tabs: the registers' pager, with a hyphen in its range. */
export function activityPaging(input: { page: number; pageSize: number; total: number }) {
  const paging = composePaging({ ...input, noun: { one: "capture", many: "captures" } });
  return { ...paging, label: paging.label.replace("\u2013", "-") };
}

/** What a batch download says when some captures failed; `null` when all of them came. */
export function batchFailureCopy(failed: number, total: number): string | null {
  return failed > 0 ? `${failed} of ${total} captures could not be downloaded` : null;
}

/** "107 captures", "1 capture": the whole set, not the page. */
export function captureCountCopy(total: number): string {
  return total === 1 ? "1 capture" : `${total} captures`;
}

export function activityTabs(active: ActivityTabId): ActivityTab[] {
  return ACTIVITY_TAB_IDS.map((id) => ({
    id,
    label: ACTIVITY_TAB_LABEL[id],
    href: activityTabHref(id),
    active: id === active,
  }));
}

export type GalleryEvidenceInput = ActivityEvidenceInput;

/** Removing a capture is an Administration act: whoever may review Activity Evidence may delete it. */
export function canDeleteCapture(input: { canReview: boolean }): boolean {
  return input.canReview;
}

export function screenshotPath(id: string): string {
  return `/api/time-tracking/screenshots/${encodeURIComponent(id)}`;
}

export type ActivityGalleryInput = {
  now: Date;
  currentUserId: string;
  canReview: boolean;
  lowActivityOnly: boolean;
  similarOnly: boolean;
  /** The Workspace's threshold, as the server judged with it. */
  lowActivityThresholdPercent?: number;
  /** Capture counts over the period before the two lenses apply. */
  counts?: { lowActivity: number; similar: number };
  selectedIds: string[];
  expandedId: string | null;
  /** The whole capture set, and how many captures come before this page. */
  total: number;
  offset: number;
  evidence: GalleryEvidenceInput[];
  /** Whether a Project, Member, Low activity or Similar filter narrows the gallery (the date range is not one). */
  facetsActive?: boolean;
  /** Whether the reader may see any Activity Evidence in any period; `null` while unknown. */
  everRecorded?: boolean | null;
  /** The date range being read; "today" when absent. */
  range?: EvidenceDateMode;
};

export type GalleryTile = EvidenceProvenance & {
  id: string;
  fileName: string;
  selected: boolean;
  expanded: boolean;
  /** The minute before the capture: a fact about it, not a score about the Member. */
  activity: TileActivity;
  /** Whether the screen looks the same as the previous capture. */
  similar: boolean;
  similarCopy: string;
};

export type TileActivity = {
  hasData: boolean;
  keyboardPercent: number | null;
  mousePercent: number | null;
  low: boolean;
  label: string;
};

export const SIMILAR_COPY = "Similar to the previous capture";
export const LOW_ACTIVITY_COPY = "Low activity";

export type GalleryGroup = {
  key: string;
  hourLabel: string;
  dateLabel: string;
  tiles: GalleryTile[];
};

/** The capture open in the full-screen viewer, with its neighbours in display order. */
export type GalleryViewer = {
  tile: GalleryTile;
  position: string;
  previousId: string | null;
  nextId: string | null;
};

export type ActivityGalleryModel = {
  groups: GalleryGroup[];
  /** Captures on this page. */
  count: number;
  /** The whole set, with its word. */
  countCopy: string;
  lowActivityCount: number;
  similarCount: number;
  selectedCount: number;
  canBatch: boolean;
  canDelete: boolean;
  batchLabel: string;
  viewer: GalleryViewer | null;
  empty: boolean;
  emptyState: EmptyModel | null;
};

function tileActivity(shot: GalleryEvidenceInput, thresholdPercent: number): TileActivity {
  const hasData = hasActivityData(shot);
  const keyboardPercent = hasData ? (shot.keyboardActivityPercent ?? null) : null;
  const mousePercent = hasData ? (shot.mouseActivityPercent ?? null) : null;
  return {
    hasData,
    keyboardPercent,
    mousePercent,
    low: isLowActivityCapture(shot, thresholdPercent),
    label: hasData ? `Keyboard ${keyboardPercent} % · Mouse ${mousePercent} %` : "No activity data",
  };
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

/** Where Previous or Next goes: a capture on this page, or the first or last of a neighbouring page. */
export type ViewerStep = { openId: string } | { page: number; pick: "first" | "last" } | null;

export function stepViewer(
  viewer: Pick<GalleryViewer, "previousId" | "nextId">,
  direction: "previous" | "next",
  paging: { page: number; pageCount: number },
): ViewerStep {
  const id = direction === "next" ? viewer.nextId : viewer.previousId;
  if (id) return { openId: id };
  if (direction === "next") return paging.page < paging.pageCount ? { page: paging.page + 1, pick: "first" } : null;
  return paging.page > 1 ? { page: paging.page - 1, pick: "last" } : null;
}

/** The capture a page turn lands on, in display order (newest hour first). */
export function pickCapture(groups: GalleryGroup[], pick: "first" | "last"): string | null {
  const ids = groups.flatMap((group) => group.tiles.map((tile) => tile.id));
  return (pick === "first" ? ids[0] : ids[ids.length - 1]) ?? null;
}

export function composeActivityGallery(input: ActivityGalleryInput): ActivityGalleryModel {
  const selected = new Set(input.selectedIds);
  const visible = allowedEvidence(input.evidence, input);
  const filtered = Boolean(input.facetsActive) || input.lowActivityOnly || input.similarOnly;
  const threshold = input.lowActivityThresholdPercent ?? DEFAULT_LOW_ACTIVITY_THRESHOLD_PERCENT;

  const shown = [...visible]
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
        dateLabel: formatFullDate(captured),
        tiles: [],
      };
      groups.set(key, group);
    }
    group.tiles.push({
      id: shot.id,
      ...evidenceProvenance(shot, input.now),
      fileName: evidenceFileName(shot.capturedAt),
      selected: selected.has(shot.id),
      expanded: input.expandedId === shot.id,
      activity: tileActivity(shot, threshold),
      similar: Boolean(shot.similarToPrevious),
      similarCopy: SIMILAR_COPY,
    });
  }

  // Newest hour first.
  const ordered = [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));

  const displayOrder = ordered.flatMap((group) => group.tiles);
  const viewerIndex = input.expandedId
    ? displayOrder.findIndex((tile) => tile.id === input.expandedId)
    : -1;
  const total = Math.max(0, input.total);
  const viewer: GalleryViewer | null =
    viewerIndex < 0
      ? null
      : {
          tile: displayOrder[viewerIndex],
          position: `${Math.max(0, input.offset) + viewerIndex + 1} of ${total}`,
          previousId: displayOrder[viewerIndex - 1]?.id ?? null,
          nextId: displayOrder[viewerIndex + 1]?.id ?? null,
        };

  const count = shown.length;
  const selectedCount = shown.filter((shot) => selected.has(shot.id)).length;

  return {
    groups: ordered,
    count,
    countCopy: captureCountCopy(total),
    lowActivityCount: input.counts?.lowActivity ?? 0,
    similarCount: input.counts?.similar ?? 0,
    selectedCount,
    canBatch: selectedCount > 0,
    canDelete: canDeleteCapture({ canReview: input.canReview }),
    batchLabel:
      selectedCount === 1 ? "Download 1 capture" : `Download ${selectedCount} captures`,
    viewer,
    empty: count === 0,
    emptyState: evidenceEmptyState(count === 0, filtered, input.everRecorded ?? null, input.range),
  };
}
