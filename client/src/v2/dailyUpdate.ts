/**
 * Daily Update destination (#190).
 * Submits through existing `/api/daily-updates` writes.
 * Do not animate field focus.
 */

import { dailyUpdateBlockageTypeOptions, dailyUpdateStatusOptions } from "@shared/schema";
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

export type DailyUpdatePageModel = {
  dateChip: string;
  subhead: string;
  kind: "empty" | "submitted" | "refusal";
  emptyCopy: string;
  refusal: string | null;
  submissions: DailyUpdateSubmissionRow[];
  canSubmit: boolean;
};

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
      emptyCopy: "",
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
    emptyCopy: empty
      ? canSubmit
        ? "No Daily Update submitted for today yet."
        : "No Projects to file a Daily Update against yet."
      : "",
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
      emptyCopy: string;
      groups: TeamDailyUpdateGroup[];
      members: Array<{ id: string; name: string }>;
    };

export function canViewTeamDailyUpdates(user: {
  role?: string | null;
  canViewDailyUpdates?: number | null;
} | null | undefined): boolean {
  return user?.role === "admin" || user?.canViewDailyUpdates === 1;
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
  const filteredAway = empty && input.updates.length > 0;
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
    emptyCopy: empty
      ? filteredAway
        ? "No Daily Updates match this filter."
        : "No Daily Updates in this range yet."
      : "",
    groups,
    members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
