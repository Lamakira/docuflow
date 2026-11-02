/**
 * Daily Update destination (#190).
 * Submits through existing `/api/daily-updates` writes.
 * Do not animate field focus.
 */

import { emptyKindOf, emptyModelOf, type EmptyModel } from "./emptyState";
import { dailyUpdateBlockageTypeOptions, dailyUpdateStatusOptions } from "@shared/schema";
import { canManageAdministration } from "./administration";
import { chromeRefusal } from "./chrome";
import { formatDateChip, formatWhen, memberName } from "./today";

export type DailyUpdateProject = {
  id: string;
  name: string;
};

export type DailyUpdateSubmissionInput = {
  id: string;
  crmProjectId: string;
  status: string;
  whatHappened?: string | null;
  whatWasDone?: string | null;
  nextSteps?: string | null;
  blockageType?: string | null;
  waitingOnClient?: boolean;
  crmProject?: { project?: { name?: string | null } | null } | null;
  createdAt?: Date | string | null;
  updateDate?: Date | string | null;
};

export type DailyUpdatePageInput = {
  now: Date;
  workspaceName: string;
  readOnly: boolean;
  projects: DailyUpdateProject[];
  submissions: DailyUpdateSubmissionInput[];
};

export type DailyUpdateSubmissionRow = {
  id: string;
  project: string;
  status: string;
  prose: string | null;
  nextPlans: string | null;
  blocker: string | null;
};

/** Where today's Daily Update stands, as labelled rows rather than one bare line. */
export type DailyUpdateToday = {
  submitted: boolean;
  copy: string;
  rows: Array<{ label: string; value: string }>;
  action: { label: string; href: string } | null;
};

export type DailyUpdatePageModel = {
  dateChip: string;
  subhead: string;
  kind: "empty" | "submitted" | "refusal";
  today: DailyUpdateToday;
  refusal: string | null;
  submissions: DailyUpdateSubmissionRow[];
  canSubmit: boolean;
};

const DAILY_UPDATE_DEFINITION =
  "A Daily Update is your one submission for this workday: progress grouped by Project, blockers and next plans.";

function latestClock(submissions: DailyUpdateSubmissionInput[], now: Date): string {
  const times = submissions
    .map((submission) => submission.createdAt ?? submission.updateDate ?? null)
    .map((value) => (value ? new Date(value) : null))
    .filter((value): value is Date => value !== null && !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return times[0] ? formatWhen(times[0], now) : "";
}

function composeToday(
  input: DailyUpdatePageInput,
  submissions: DailyUpdateSubmissionRow[],
  canSubmit: boolean,
): DailyUpdateToday {
  const submitted = submissions.length > 0;
  const clock = submitted ? latestClock(input.submissions, input.now) : "";
  const covered = Array.from(new Set(submissions.map((row) => row.project)));
  const next = input.readOnly
    ? ""
    : !canSubmit
      ? " There is no Project in this Workspace to report on yet."
      : submitted
        ? " Worked on another Project today? Add it below."
        : " Fill it in below, one Project at a time.";
  return {
    submitted,
    copy: `${DAILY_UPDATE_DEFINITION}${next}`,
    rows: [
      { label: "Workday", value: formatDateChip(input.now) },
      { label: "Status", value: submitted ? (clock ? `Submitted at ${clock}` : "Submitted") : "Not submitted yet" },
      { label: "Projects covered", value: covered.length > 0 ? covered.join(", ") : "None yet" },
    ],
    action: !input.readOnly && !canSubmit ? { label: "Open Projects", href: "/projects" } : null,
  };
}

function statusLabel(status: string): string {
  return dailyUpdateStatusOptions.find((option) => option.value === status)?.label ?? status;
}

function projectName(submission: DailyUpdateSubmissionInput, projects: DailyUpdateProject[]): string {
  return (
    submission.crmProject?.project?.name?.trim() ||
    projects.find((project) => project.id === submission.crmProjectId)?.name ||
    "Untitled Project"
  );
}

function blockerCopy(submission: DailyUpdateSubmissionInput): string | null {
  if (submission.waitingOnClient) return "Waiting on the Client.";
  if (!submission.blockageType) return null;
  return (
    dailyUpdateBlockageTypeOptions.find((option) => option.value === submission.blockageType)?.label ??
    submission.blockageType
  );
}

function submissionRows(
  submissions: DailyUpdateSubmissionInput[],
  projects: DailyUpdateProject[],
): DailyUpdateSubmissionRow[] {
  return submissions.map((submission) => {
    const prose = (submission.whatHappened || submission.whatWasDone || "").trim();
    const nextPlans = (submission.nextSteps || "").trim();
    return {
      id: submission.id,
      project: projectName(submission, projects),
      status: statusLabel(submission.status),
      prose: prose || null,
      nextPlans: nextPlans || null,
      blocker: blockerCopy(submission),
    };
  });
}

export function composeDailyUpdatePage(input: DailyUpdatePageInput): DailyUpdatePageModel {
  const submissions = submissionRows(input.submissions, input.projects);
  const empty = submissions.length === 0;
  const canSubmit = !input.readOnly && input.projects.length > 0;
  if (input.readOnly) {
    return {
      dateChip: formatDateChip(input.now),
      subhead: `Today's Daily Update in ${input.workspaceName}.`,
      kind: "refusal",
      today: composeToday(input, submissions, false),
      refusal: chromeRefusal({
        kind: "workspace-condition",
        workspaceName: input.workspaceName,
        condition: "Read-only",
      }),
      submissions,
      canSubmit: false,
    };
  }

  return {
    dateChip: formatDateChip(input.now),
    subhead: `Today's Daily Update in ${input.workspaceName}.`,
    kind: empty ? "empty" : "submitted",
    today: composeToday(input, submissions, canSubmit),
    refusal: null,
    submissions,
    canSubmit,
  };
}

export const VIEW_DAILY_UPDATES_CAPABILITY = "View Daily Updates";

export type TeamDailyUpdateMember = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

export type TeamDailyUpdateInput = {
  id: string;
  userId: string;
  status: string;
  updateDate: Date | string;
  whatHappened?: string | null;
  whatWasDone?: string | null;
  nextSteps?: string | null;
  blockageType?: string | null;
  waitingOnClient?: boolean;
  user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  crmProject?: { project?: { name?: string | null } | null } | null;
};

export type TeamDailyUpdatesKpis = {
  total: number;
  waitingOnClient: number;
  blocked: number;
  activeUsers: number;
};

export type TeamDailyUpdatesInput = {
  now: Date;
  workspaceName: string;
  ownerName: string | null;
  canView: boolean;
  kpis: TeamDailyUpdatesKpis | null;
  submittedToday: TeamDailyUpdateMember[];
  missingToday: TeamDailyUpdateMember[];
  updates: TeamDailyUpdateInput[];
  filterQuery: string;
  statusFilter: string;
  memberFilter: string;
  /** The Range filter in days (`1`, `7`, `14`, `30`); omitted reads as the widest. */
  rangeDays?: string;
};

export type TeamDailyUpdateRow = {
  id: string;
  when: string;
  project: string;
  status: string;
  prose: string | null;
  nextPlans: string | null;
  blocker: string | null;
};

export type TeamDailyUpdateGroup = {
  userId: string;
  name: string;
  updates: TeamDailyUpdateRow[];
};

export type TeamDailyUpdatesModel =
  | { kind: "refusal"; refusal: string; pagePrimary: "case-ink" }
  | {
      kind: "ready";
      dateChip: string;
      subhead: string;
      pagePrimary: "case-ink";
      kpis: Array<{ id: string; label: string; value: string }>;
      submitted: Array<{ id: string; name: string }>;
      missing: Array<{ id: string; name: string }>;
      submittedEmptyCopy: string;
      missingEmptyCopy: string;
      empty: boolean;
      /** `none`: nothing in the widest Range; `range`: nothing in a shorter one; `filtered`: a search, status or Member hides it (#325). */
      emptyState: EmptyModel | null;
      groups: TeamDailyUpdateGroup[];
      members: Array<{ id: string; name: string }>;
    };

export function canViewTeamDailyUpdates(input: {
  workspaceRole?: string | null;
  canViewDailyUpdates?: number | null;
} | null | undefined): boolean {
  return canManageAdministration(input?.workspaceRole ?? "") || input?.canViewDailyUpdates === 1;
}

export function remindDailyUpdatesPath(): string {
  return "/api/admin/daily-updates/remind";
}

export function adminDailyUpdateTodayStatusPath(): string {
  return "/api/admin/daily-updates/today-status";
}

function adminDailyUpdatesQuery(opts: { startDate: Date; endDate: Date }): string {
  return new URLSearchParams({
    startDate: opts.startDate.toISOString(),
    endDate: opts.endDate.toISOString(),
  }).toString();
}

export function adminDailyUpdatesPath(opts: { startDate: Date; endDate: Date }): string {
  return `/api/admin/daily-updates?${adminDailyUpdatesQuery(opts)}`;
}

export function adminDailyUpdateKpisPath(opts: { startDate: Date; endDate: Date }): string {
  return `/api/admin/daily-updates/kpis?${adminDailyUpdatesQuery(opts)}`;
}

export function dailyUpdateRemindRefusal(input: {
  workspaceName: string;
  ownerName?: string | null;
  readOnly?: boolean;
  errorMessage?: string;
}): string {
  if (input.readOnly || /read-only/i.test(input.errorMessage ?? "")) {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: "Read-only",
    });
  }
  if (
    !input.errorMessage ||
    /permission denied|not authorized|access denied|forbidden/i.test(input.errorMessage)
  ) {
    return chromeRefusal({
      kind: "capability",
      capability: VIEW_DAILY_UPDATES_CAPABILITY,
      ownerName: input.ownerName,
    });
  }
  return chromeRefusal({ kind: "generic", message: input.errorMessage });
}

function teamMemberChip(member: TeamDailyUpdateMember): { id: string; name: string } {
  return { id: member.id, name: memberName(member) };
}

function teamUpdateRow(update: TeamDailyUpdateInput, now: Date): TeamDailyUpdateRow {
  const submission: DailyUpdateSubmissionInput = {
    id: update.id,
    crmProjectId: "",
    status: update.status,
    whatHappened: update.whatHappened,
    whatWasDone: update.whatWasDone,
    nextSteps: update.nextSteps,
    blockageType: update.blockageType,
    waitingOnClient: update.waitingOnClient,
    crmProject: update.crmProject,
  };
  const prose = (update.whatHappened || update.whatWasDone || "").trim();
  const nextPlans = (update.nextSteps || "").trim();
  return {
    id: update.id,
    when: formatWhen(update.updateDate, now),
    project: projectName(submission, []),
    status: statusLabel(update.status),
    prose: prose || null,
    nextPlans: nextPlans || null,
    blocker: blockerCopy(submission),
  };
}

/** The Range options of Team Daily Updates, in days. */
const TEAM_RANGE_DAYS = [1, 7, 14, 30] as const;

/**
 * The filters a notification link carries (`?member=<id>&day=YYYY-MM-DD`): the
 * Member, and the narrowest Range that still reaches back to that day.
 */
export function teamDailyUpdatesLinkFilters(
  search: string,
  now: Date,
): { memberFilter: string; rangeDays: string } {
  const params = new URLSearchParams(search);
  const member = params.get("member");
  const day = params.get("day")?.split("-").map(Number);
  let rangeDays = "7";
  if (day && day.length === 3 && day.every((part) => Number.isFinite(part))) {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(day[0], day[1] - 1, day[2]);
    const ago = Math.round((startOfToday.getTime() - target.getTime()) / 86_400_000);
    rangeDays = String(TEAM_RANGE_DAYS.find((days) => days >= ago) ?? 30);
  }
  return { memberFilter: member || "all", rangeDays };
}

/** The Range (in days) one step wider than this one; `null` when it is already the widest. */
export function widerDailyUpdateRange(days: string): string | null {
  if (days === "1") return "7";
  if (days === "7") return "14";
  if (days === "14") return "30";
  return null;
}

export function composeTeamDailyUpdates(input: TeamDailyUpdatesInput): TeamDailyUpdatesModel {
  if (!input.canView) {
    return {
      kind: "refusal",
      refusal: chromeRefusal({
        kind: "capability",
        capability: VIEW_DAILY_UPDATES_CAPABILITY,
        ownerName: input.ownerName,
      }),
      pagePrimary: "case-ink",
    };
  }

  const needle = input.filterQuery.trim().toLowerCase();
  const filtered = input.updates.filter((update) => {
    if (input.statusFilter !== "all" && update.status !== input.statusFilter) return false;
    if (input.memberFilter !== "all" && update.userId !== input.memberFilter) return false;
    if (!needle) return true;
    const haystack = [
      memberName(update.user ?? {}),
      update.crmProject?.project?.name ?? "",
      update.whatHappened ?? "",
      update.whatWasDone ?? "",
      update.nextSteps ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });

  const ordered = [...filtered].sort(
    (a, b) => new Date(b.updateDate).getTime() - new Date(a.updateDate).getTime(),
  );
  const grouped = new Map<string, TeamDailyUpdateGroup>();
  for (const update of ordered) {
    const existing = grouped.get(update.userId);
    const row = teamUpdateRow(update, input.now);
    if (existing) {
      existing.updates.push(row);
      continue;
    }
    grouped.set(update.userId, {
      userId: update.userId,
      name: memberName(update.user ?? {}),
      updates: [row],
    });
  }
  const groups = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));

  const members = new Map<string, { id: string; name: string }>();
  for (const update of input.updates) {
    if (!members.has(update.userId)) {
      members.set(update.userId, { id: update.userId, name: memberName(update.user ?? {}) });
    }
  }

  const kpis = input.kpis ?? { total: 0, waitingOnClient: 0, blocked: 0, activeUsers: 0 };
  const empty = groups.length === 0;
  const shortRange = Boolean(input.rangeDays) && input.rangeDays !== "30";
  const wider = input.rangeDays ? widerDailyUpdateRange(input.rangeDays) : null;
  const facetsActive = Boolean(needle) || input.statusFilter !== "all" || input.memberFilter !== "all";
  const submitted = input.submittedToday.map(teamMemberChip);
  const missing = input.missingToday.map(teamMemberChip);

  return {
    kind: "ready",
    dateChip: formatDateChip(input.now),
    subhead: `Team Daily Updates in ${input.workspaceName}.`,
    pagePrimary: "case-ink",
    kpis: [
      { id: "total", label: "Total", value: String(kpis.total) },
      { id: "waiting", label: "Waiting on the Client", value: String(kpis.waitingOnClient) },
      { id: "blocked", label: "Blocked", value: String(kpis.blocked) },
      { id: "members", label: "Members", value: String(kpis.activeUsers) },
    ],
    submitted,
    missing,
    submittedEmptyCopy:
      submitted.length === 0 && missing.length === 0
        ? "No Members to review today."
        : submitted.length === 0
          ? "No one has submitted a Daily Update today yet."
          : "",
    missingEmptyCopy:
      submitted.length === 0 && missing.length === 0
        ? ""
        : missing.length === 0
          ? "Everyone has submitted today's Daily Update."
          : "",
    empty,
    // A short Range cannot claim nothing was ever submitted: rows may sit outside it.
    emptyState: emptyModelOf(
      emptyKindOf(empty, facetsActive, shortRange),
      "Daily Updates",
      {
        title: "No Daily Updates yet",
        copy: "A Daily Update is a Member's one submission for the workday. They appear here as your Members submit them.",
      },
      {
        window: input.rangeDays === "1" ? "today" : `in the last ${input.rangeDays} days`,
        widenLabel: wider ? `Show last ${wider} days` : null,
      },
    ),
    groups,
    members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
