import { projectStatusColor } from "./palette";
import { MONTHS, WEEKDAYS } from "./dates";

export type TodayProject = {
  id: string;
  projectStatus: string;
  projectType: string | null;
  budgetedHours: number | null;
  budgetedMinutes?: number | null;
  /** Seconds of every Time Entry on the Project: what its budget is consumed by (F44). */
  trackedSeconds?: number | null;
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
  /** Who the notification is about; `daily_update_submitted` carries the submitter. */
  fromUserId?: string | null;
};

export type TodayDocument = {
  id: string;
  title: string;
  updatedAt: Date | string | null;
  projectId: string;
  createdById?: string | null;
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
  missingDailyUpdates: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    remindedToday?: boolean;
  }> | null;
  trackingUserId: string | null;
  /** The reader's own active time entry (running or paused). */
  openTimer?: { startTime: Date | string } | null;
  dailyUpdateReminded?: boolean;
};

export type AttentionKind = "Team" | "Update" | "Mention" | "Reminder";

export type AttentionRow = {
  id: string;
  kind: AttentionKind;
  title: string;
  meta: string;
  href: string;
  cta: string;
  action: "open" | "remind" | "notifications";
  state: "open" | "resolved";
};

export type ActiveProjectRow = {
  id: string;
  name: string;
  clientLabel: string | null;
  kindLabel: string;
  status: string;
  /** The status's board colour; `swatchStyle` turns it into the badge. */
  statusColor: string;
  lead: string | null;
  meta: string;
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
  attentionTotal: number;
  projects: ActiveProjectRow[];
  workday: {
    memberCount: number;
    hoursTodayLabel: string;
    members: WorkdayMemberRow[];
    openTimerSince: string | null;
  };
  knowledge: KnowledgeRow[];
  knowledgeTotal: number;
  projectsTotal: number;
};

export const TODAY_SECTION_LIMIT = 5;

/**
 * One Today card's state from the reads it waits on: a failed read wins, so an
 * error never renders as the card's empty line; ready means neither (#370, F19).
 */
export function todayCardState(queries: Array<{ isLoading: boolean; isError: boolean }>): {
  loading: boolean;
  failed: boolean;
  ready: boolean;
} {
  const failed = queries.some((query) => query.isError);
  const loading = !failed && queries.some((query) => query.isLoading);
  return { loading, failed, ready: !failed && !loading };
}

const LIVE_PROJECT_STATUSES = new Set(["active", "in_review", "on_hold"]);

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

/** A Project's budget is `budgetedHours` plus `budgetedMinutes`; either may be empty. */
export function budgetedHoursTotal(project: { budgetedHours: number | null; budgetedMinutes?: number | null }): number {
  return Math.max(0, project.budgetedHours ?? 0) + Math.max(0, project.budgetedMinutes ?? 0) / 60;
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

/** Two initials from a display name; an email fallback gives one letter. */
export function nameInitials(name: string): string {
  const trimmed = name.trim();
  if (trimmed.includes("@")) return trimmed.charAt(0).toUpperCase();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
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
  if (sameDay(value, yesterdayOf(now))) return "Yesterday";
  return `${value.getDate()} ${MONTHS[value.getMonth()]}`;
}

function kindLabel(project: TodayProject): string {
  if (project.projectType === "internal" || !project.client) return "Internal";
  if (project.projectType === "monthly") return "Monthly";
  if (project.projectType === "hourly_budget") return "Hourly";
  return "Client project";
}

function attentionSubhead(count: number): string {
  if (count === 0) return "Nothing needs you yet.";
  if (count === 1) return "One item needs your attention.";
  return `${count} items need your attention.`;
}

function notificationKind(type: string): AttentionKind | null {
  if (type === "daily_update_reminder" || type === "daily_update_submitted") return "Update";
  if (type === "mention") return "Mention";
  if (type === "reminder") return "Reminder";
  return null;
}

/**
 * Team Daily Updates filtered to one Member and the local day a notification
 * landed on: the screen reads `member` and `day` from the URL (#341).
 */
export function teamDailyUpdatesHref(
  fromUserId: string | null | undefined,
  createdAt: Date | string | null | undefined,
): string {
  const params = new URLSearchParams();
  if (fromUserId) params.set("member", fromUserId);
  const created = createdAt ? new Date(createdAt) : null;
  if (created && !Number.isNaN(created.getTime())) {
    const month = String(created.getMonth() + 1).padStart(2, "0");
    const day = String(created.getDate()).padStart(2, "0");
    params.set("day", `${created.getFullYear()}-${month}-${day}`);
  }
  const query = params.toString();
  return query ? `/daily-updates?${query}` : "/daily-updates";
}

function notificationHref(notification: TodayNotification): string {
  if (notification.type === "daily_update_reminder") return "/daily-update";
  if (notification.type === "daily_update_submitted") {
    return teamDailyUpdatesHref(notification.fromUserId, notification.createdAt);
  }
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
    const remindedCount = missing.filter((member) => member.remindedToday).length;
    const allReminded = Boolean(input.dailyUpdateReminded) || remindedCount === missing.length;
    rows.push({
      id: "daily-updates-missing",
      kind: "Team",
      title,
      meta: allReminded
        ? "Reminded"
        : remindedCount > 0
          ? `${remindedCount} of ${missing.length} reminded`
          : "Today",
      href: "/daily-updates",
      cta: allReminded ? "Reminded" : "Remind",
      action: "remind",
      state: allReminded ? "resolved" : "open",
    });
  }

  const time = (value: Date | string | null): number => {
    if (!value) return Number.NEGATIVE_INFINITY;
    const ms = (value instanceof Date ? value : new Date(value)).getTime();
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };
  const unread = input.notifications.filter((notification) => !notification.isRead);

  const ownReminders = unread.filter((notification) => notification.type === "daily_update_reminder");
  if (ownReminders.length > 0) {
    const newest = ownReminders.reduce((best, item) => (time(item.createdAt) > time(best.createdAt) ? item : best));
    rows.push({
      id: "own-daily-update",
      kind: "Update",
      title: "Submit your Daily Update",
      meta: newest.createdAt ? formatWhen(newest.createdAt, input.now) : "",
      href: "/daily-update",
      cta: "Open",
      action: "open",
      state: "open",
    });
  }

  const others = unread
    .filter((notification) => notification.type !== "daily_update_reminder" && notificationKind(notification.type))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));
  for (const notification of others) {
    const kind = notificationKind(notification.type)!;
    const href = notificationHref(notification);
    const unrouted = href === "/";
    rows.push({
      id: notification.id,
      kind,
      title: notification.message || "You have a notification",
      meta: notification.createdAt ? formatWhen(notification.createdAt, input.now) : "",
      href: unrouted ? "" : href,
      cta: "Open",
      action: unrouted ? "notifications" : "open",
      state: "open",
    });
  }

  return rows;
}

function composeProjects(input: TodayInput): ActiveProjectRow[] {
  const month = new Map(input.monthSecondsByProject.map((row) => [row.crmProjectId, row.totalDuration]));
  return input.projects
    // "Tracked this month" means it shows more than 0.0 h, not merely a few seconds.
    .filter((project) => LIVE_PROJECT_STATUSES.has(project.projectStatus) && formatHours(month.get(project.id) ?? 0) !== formatHours(0))
    .sort((a, b) => (month.get(b.id) ?? 0) - (month.get(a.id) ?? 0))
    .map((project) => {
      const budgeted = budgetedHoursTotal(project);
      const actual = (project.trackedSeconds ?? 0) / 3600;
      const client = project.client?.name || null;
      const kind = kindLabel(project);
      return {
        id: project.id,
        name: project.project?.name || "Untitled Project",
        clientLabel: client,
        kindLabel: kind,
        meta: client ? `${client} · ${kind}` : kind,
        status: PROJECT_STATUS_LABEL[project.projectStatus] ?? project.projectStatus.replace(/_/g, " ").toUpperCase(),
        statusColor: projectStatusColor(project.projectStatus),
        lead: project.assignee ? memberName(project.assignee) : null,
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
        initials: nameInitials(memberName(user)),
        state,
        hours: formatHours(hoursByUser.get(user.id) ?? 0),
        self: user.id === input.currentUserId,
      };
    })
    .sort((a, b) => {
      if (a.self !== b.self) return a.self ? -1 : 1;
      const rank = (state: WorkdayMemberRow["state"]) =>
        state === "UPDATE MISSING" ? 0 : state === "TRACKING" ? 1 : state === "UPDATE POSTED" ? 2 : 3;
      return rank(a.state) - rank(b.state) || a.name.localeCompare(b.name);
    });
  const totalSeconds = [...hoursByUser.values()].reduce((sum, value) => sum + value, 0);
  return {
    memberCount: members.length,
    hoursTodayLabel: `${formatHours(totalSeconds)} today`,
    members,
    openTimerSince: openTimerSince(input),
  };
}

function openTimerSince(input: TodayInput): string | null {
  if (!input.openTimer) return null;
  const start = new Date(input.openTimer.startTime);
  if (Number.isNaN(start.getTime())) return null;
  const startOfDay = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate());
  if (start.getTime() >= startOfDay.getTime()) return null;
  return `Timer open since ${start.getDate()} ${MONTHS[start.getMonth()]} ${formatClock(start)}`;
}

function composeKnowledge(input: TodayInput): KnowledgeRow[] {
  const projectNameByDocProject = new Map(
    input.projects
      .filter((project) => project.project?.id)
      .map((project) => [project.project!.id, project.project!.name]),
  );
  const userById = new Map(input.users.map((user) => [user.id, user]));
  return input.recentDocuments.map((document) => {
    const projectName = projectNameByDocProject.get(document.projectId);
    const author = document.createdById ? userById.get(document.createdById) : undefined;
    const parts = [projectName, author ? `by ${memberName(author)}` : null].filter(Boolean);
    return {
      id: document.id,
      title: document.title,
      meta: parts.length > 0 ? parts.join(" · ") : "Project doc",
      when: formatWhen(document.updatedAt, input.now),
      href: `/document/${document.id}`,
    };
  });
}

export function mobileProjectMeta(
  row: Pick<ActiveProjectRow, "clientLabel" | "status" | "trackedMtd">,
): string {
  return [row.clientLabel, row.status, row.trackedMtd].filter(Boolean).join(" · ");
}

export function composeToday(input: TodayInput): TodayModel {
  const attention = composeAttention(input);
  const projects = composeProjects(input);
  const knowledge = composeKnowledge(input);
  return {
    dateChip: formatDateChip(input.now),
    subhead: attentionSubhead(attention.length),
    attention: attention.slice(0, TODAY_SECTION_LIMIT),
    attentionTotal: attention.length,
    projects: projects.slice(0, TODAY_SECTION_LIMIT),
    workday: composeWorkday(input),
    knowledge: knowledge.slice(0, TODAY_SECTION_LIMIT),
    knowledgeTotal: knowledge.length,
    projectsTotal: projects.length,
  };
}
