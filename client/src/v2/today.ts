export type TodayProject = {
  id: string;
  projectStatus: string;
  projectType: string | null;
  budgetedHours: number | null;
  actualHours: number | null;
  project?: { id: string; name: string } | null;
  client?: { name: string } | null;
  assignee?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
};

export type TodayNotification = {
  id: string;
  type: string;
  message: string | null;
  isRead: number;
  createdAt: Date | string | null;
  crmProjectId?: string | null;
};

export type TodayDocument = {
  id: string;
  title: string;
  updatedAt: Date | string | null;
  projectId: string;
};

export type TodayUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  isArchived?: boolean;
};

export type TodayInput = {
  now: Date;
  currentUserId: string;
  projects: TodayProject[];
  notifications: TodayNotification[];
  recentDocuments: TodayDocument[];
  users: TodayUser[];
  todaySecondsByUser: Array<{ userId: string; totalDuration: number }>;
  monthSecondsByProject: Array<{ crmProjectId: string; totalDuration: number }>;
  missingDailyUpdates: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }> | null;
  trackingUserId: string | null;
  dailyUpdateReminded?: boolean;
};

export type AttentionKind = "UPDATE" | "MENTION" | "REMINDER";

export type AttentionRow = {
  id: string;
  kind: AttentionKind;
  title: string;
  meta: string;
  href: string;
  cta: string;
  action: "open" | "remind";
  state: "open" | "resolved";
};

export type ActiveProjectRow = {
  id: string;
  name: string;
  clientLabel: string;
  kindLabel: string;
  status: string;
  lead: string;
  budgetPercent: number | null;
  trackedMtd: string;
  href: string;
};

export type WorkdayMemberRow = {
  id: string;
  name: string;
  initials: string;
  state: "TRACKING" | "UPDATE POSTED" | "UPDATE MISSING" | null;
  hours: string;
  self: boolean;
};

export type KnowledgeRow = {
  id: string;
  title: string;
  meta: string;
  when: string;
  href: string;
};

export type TodayModel = {
  dateChip: string;
  subhead: string;
  attention: AttentionRow[];
  projects: ActiveProjectRow[];
  workday: {
    memberCount: number;
    hoursTodayLabel: string;
    members: WorkdayMemberRow[];
  };
  knowledge: KnowledgeRow[];
  approvals: {
    empty: true;
    kicker: string;
    title: string;
    copy: string;
  };
};

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const LIVE_PROJECT_STATUSES = new Set(["active", "on_hold", "in_review", "completed"]);

const PROJECT_STATUS_LABEL: Record<string, string> = {
  planned: "PLANNED",
  active: "ACTIVE",
  on_hold: "ON HOLD",
  in_review: "IN REVIEW",
  completed: "COMPLETED",
};

export function formatHours(seconds: number): string {
  return `${(Math.max(0, seconds) / 3600).toFixed(1)} h`;
}

export function memberName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }): string {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.email || "Member";
}

export function memberInitials(user: { firstName?: string | null; lastName?: string | null; email?: string | null }): string {
  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
  return (user.email?.[0] ?? "M").toUpperCase();
}

export function formatDateChip(now: Date): string {
  return `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

export function projectHref(projectId: string): string {
  return `/projects/${projectId}`;
}

function formatClock(value: Date): string {
  return `${value.getHours().toString().padStart(2, "0")}:${value.getMinutes().toString().padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function yesterdayOf(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
}

export function formatWhen(updatedAt: Date | string | null, now: Date): string {
  if (!updatedAt) return "";
  const value = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(value.getTime())) return "";
  if (sameDay(value, now)) return formatClock(value);
  if (sameDay(value, yesterdayOf(now))) return "YDA";
  return `${value.getDate()} ${MONTHS[value.getMonth()]}`;
}

function kindLabel(project: TodayProject): string {
  if (project.projectType === "internal" || !project.client) return "INTERNAL";
  if (project.projectType === "monthly") return "MONTHLY";
  if (project.projectType === "hourly_budget") return "HOURLY";
  return "CLIENT PROJECT";
}

function attentionSubhead(count: number): string {
  if (count === 0) return "Nothing needs you yet.";
  if (count === 1) return "One item needs you before end of day.";
  return `${count} items need you before end of day.`;
}

function notificationKind(type: string): AttentionKind | null {
  if (type === "daily_update_reminder") return "UPDATE";
  if (type === "mention") return "MENTION";
  if (type === "reminder") return "REMINDER";
  return null;
}

function notificationHref(notification: TodayNotification): string {
  if (notification.type === "daily_update_reminder") return "/daily-update";
  if (notification.crmProjectId) return projectHref(notification.crmProjectId);
  return "/";
}

function composeAttention(input: TodayInput): AttentionRow[] {
  const rows: AttentionRow[] = [];
  const missing = input.missingDailyUpdates;
  if (missing && missing.length > 0) {
    const names = missing.map(memberName);
    const title =
      names.length === 1
        ? `1 missing Daily Update from ${names[0]}`
        : names.length === 2
          ? `2 missing Daily Updates from ${names[0]} and ${names[1]}`
          : `${names.length} missing Daily Updates`;
    const reminded = Boolean(input.dailyUpdateReminded);
    rows.push({
      id: "daily-updates-missing",
      kind: "UPDATE",
      title,
      meta: reminded ? "REMINDED" : "TODAY",
      href: "/daily-updates",
      cta: reminded ? "Reminded" : "Remind",
      action: "remind",
      state: reminded ? "resolved" : "open",
    });
  }

  for (const notification of input.notifications) {
    if (notification.isRead) continue;
    const kind = notificationKind(notification.type);
    if (!kind) continue;
    rows.push({
      id: notification.id,
      kind,
      title: notification.message || "You have a notification",
      meta: notification.createdAt ? formatWhen(notification.createdAt, input.now) : "",
      href: notificationHref(notification),
      cta: "Open",
      action: "open",
      state: "open",
    });
  }

  return rows;
}

function composeProjects(input: TodayInput): ActiveProjectRow[] {
  const month = new Map(input.monthSecondsByProject.map((row) => [row.crmProjectId, row.totalDuration]));
  return input.projects
    .filter((project) => LIVE_PROJECT_STATUSES.has(project.projectStatus))
    .map((project) => {
      const budgeted = project.budgetedHours ?? 0;
      const actual = project.actualHours ?? 0;
      return {
        id: project.id,
        name: project.project?.name || "Untitled Project",
        clientLabel: project.client?.name || "—",
        kindLabel: kindLabel(project),
        status: PROJECT_STATUS_LABEL[project.projectStatus] ?? project.projectStatus.replace(/_/g, " ").toUpperCase(),
        lead: project.assignee ? memberName(project.assignee) : "—",
        budgetPercent: budgeted > 0 ? Math.round((actual / budgeted) * 100) : null,
        trackedMtd: formatHours(month.get(project.id) ?? 0),
        href: projectHref(project.id),
      };
    });
}

function composeWorkday(input: TodayInput): TodayModel["workday"] {
  const hoursByUser = new Map(input.todaySecondsByUser.map((row) => [row.userId, row.totalDuration]));
  const missingIds = new Set((input.missingDailyUpdates ?? []).map((row) => row.id));
  const members = input.users
    .filter((user) => {
      if (user.isArchived) return false;
      if (user.id === input.currentUserId) return true;
      if (hoursByUser.has(user.id)) return true;
      return Boolean(input.missingDailyUpdates);
    })
    .map((user) => {
      let state: WorkdayMemberRow["state"] = null;
      if (input.trackingUserId === user.id) state = "TRACKING";
      else if (input.missingDailyUpdates) {
        state = missingIds.has(user.id) ? "UPDATE MISSING" : "UPDATE POSTED";
      }
      return {
        id: user.id,
        name: memberName(user),
        initials: memberInitials(user),
        state,
        hours: formatHours(hoursByUser.get(user.id) ?? 0),
        self: user.id === input.currentUserId,
      };
    });
  const totalSeconds = [...hoursByUser.values()].reduce((sum, value) => sum + value, 0);
  return {
    memberCount: members.length,
    hoursTodayLabel: `${formatHours(totalSeconds)} TODAY`,
    members,
  };
}

function composeKnowledge(input: TodayInput): KnowledgeRow[] {
  const projectNameByDocProject = new Map(
    input.projects
      .filter((project) => project.project?.id)
      .map((project) => [project.project!.id, project.project!.name]),
  );
  return input.recentDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    meta: `PROJECT DOC · ${projectNameByDocProject.get(document.projectId) ?? "Project"}`,
    when: formatWhen(document.updatedAt, input.now),
    href: `/document/${document.id}`,
  }));
}

export function mobileProjectMeta(
  row: Pick<ActiveProjectRow, "clientLabel" | "status" | "trackedMtd">,
): string {
  return `${row.clientLabel} · ${row.status} · ${row.trackedMtd}`;
}

export const EMPTY_TIMESHEET_APPROVALS = {
  empty: true as const,
  kicker: "APPROVAL QUEUE",
  title: "Timesheets",
  copy: "Timesheets are not a product record yet. Approvals will appear here when this Workspace has them.",
};

export function composeToday(input: TodayInput): TodayModel {
  const attention = composeAttention(input);
  const projects = composeProjects(input);
  return {
    dateChip: formatDateChip(input.now),
    subhead: attentionSubhead(attention.length),
    attention,
    projects,
    workday: composeWorkday(input),
    knowledge: composeKnowledge(input),
    approvals: EMPTY_TIMESHEET_APPROVALS,
  };
}
