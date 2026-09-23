import { dossierFileDestination } from "./fileViewer";
import { formatHours, memberInitials, memberName, projectHref } from "./today";
import { DOSSIER_TAB_IDS, type DossierTabId } from "./presentation";
import { taskStatusLabel } from "./tasks";

export type DossierPerson = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type DossierProject = {
  id: string;
  projectStatus: string;
  projectType: string | null;
  budgetedHours: number | null;
  actualHours: number | null;
  updatedAt?: Date | string | null;
  startDate?: Date | string | null;
  dueDate?: Date | string | null;
  documentationEnabled?: number | null;
  project?: { id: string; name: string } | null;
  client?: {
    id?: string;
    name: string;
    contacts?: Array<{ id: string; name: string; role?: string | null }>;
  } | null;
  assignee?: DossierPerson | null;
  members?: Array<{ user?: DossierPerson | null }>;
};

export type DossierTask = {
  id: string;
  name: string;
  status: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type DossierDocument = {
  id: string;
  title: string;
  updatedAt: Date | string | null;
  projectId?: string;
  access?: string | null;
  parentId?: string | null;
  position?: number | null;
};

/** One row of `crm_project_stage_history`; the status columns hold the combined lifecycle. */
export type DossierStageChange = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date | string | null;
  changedBy?: DossierPerson | null;
};

export type DossierTag = {
  id: string;
  name: string;
  color: string;
};

export type DossierDailyUpdate = {
  id: string;
  whatHappened?: string | null;
  whatWasDone?: string | null;
  nextSteps?: string | null;
  blockageType?: string | null;
  waitingOnClient?: boolean;
  updateDate?: Date | string | null;
  createdAt?: Date | string | null;
  user?: DossierPerson | null;
};

export type DossierScreenshot = {
  id: string;
  capturedAt: Date | string | null;
  userId: string;
  deletedAt?: Date | string | null;
  entryIdleTime?: number | null;
};

export type DossierTimeEntry = {
  id: string;
  duration: number;
  startTime: Date | string | null;
  userId: string;
  taskId?: string | null;
  status: string;
  description?: string | null;
  user?: DossierPerson | null;
};

export type DossierFile = {
  id: string;
  title: string;
  updatedAt: Date | string | null;
  access?: string | null;
  href?: string;
};

/** `file` leaves the app to open the object; `app` is a v2 route; `none` has no destination. */
export type DossierReminderRow = {
  id: string;
  title: string;
  note: string | null;
  due: string;
  status: string;
  done: boolean;
  canComplete: boolean;
  canReopen: boolean;
  draft: { title: string; note: string; dueAt: string };
};

export type DossierFileRow = {
  id: string;
  title: string;
  meta: string;
  href: string;
  target: "file" | "app" | "none";
};

export type DossierReminder = {
  id: string;
  title: string;
  note?: string | null;
  dueAt: Date | string;
  status: string;
  notified?: number | null;
  taskId?: string | null;
};

export type DossierNote = {
  id: string;
  content: string;
  createdAt?: Date | string | null;
  audioUrl?: string | null;
  audioRecordingId?: string | null;
  transcriptStatus?: string | null;
  audioTranscript?: string | null;
  attachments?: string | null;
  createdBy?: DossierPerson | null;
};

export type DossierInput = {
  now: Date;
  currentUserId: string;
  tab: DossierTabId;
  project: DossierProject | null;
  tasks: DossierTask[];
  documents: DossierDocument[];
  dailyUpdate: DossierDailyUpdate | null;
  dailyUpdateCapabilityMiss: boolean;
  ownerName: string | null;
  monthSeconds: number;
  screenshots: DossierScreenshot[];
  users: Array<DossierPerson & { id: string }>;
  trackingTaskId: string | null;
  clientActiveProjectCount: number;
  timeEntries: DossierTimeEntry[];
  dailyUpdates: DossierDailyUpdate[];
  files: DossierFile[];
  reminders: DossierReminder[];
  notes: DossierNote[];
  stageHistory: DossierStageChange[];
  /** The Tags attached to this Project. */
  tags: DossierTag[];
  /** The Workspace's whole Tag vocabulary. */
  workspaceTags: DossierTag[];
};

export type DossierTab = {
  id: DossierTabId;
  label: string;
  href: string;
  count: string | null;
  active: boolean;
};

export type DossierTaskRow = {
  id: string;
  title: string;
  done: boolean;
  flag: "TIMER RUNNING" | "BLOCKED" | null;
  meta: string;
  status: string;
  statusValue: string;
};

export type DossierModel = {
  missing: boolean;
  tab: DossierTabId;
  tabIsPlaceholder: boolean;
  identity: {
    clientLabel: string | null;
    kindLabel: string;
    title: string;
    status: string;
    lead: { name: string; initials: string; self: boolean } | null;
    team: Array<{ name: string; initials: string }>;
    updatedLabel: string | null;
    tags: DossierTag[];
  } | null;
  stats: {
    budgetPercent: number | null;
    trackedMtd: string;
    planHours: string | null;
    showFinance: false;
  };
  tabs: DossierTab[];
  nextActions: {
    openCount: number;
    blockedCount: number;
    rows: DossierTaskRow[];
    empty: boolean;
    emptyCopy: string;
  };
  tasks: {
    rows: DossierTaskRow[];
    empty: boolean;
    emptyCopy: string;
    assignees: Array<{ id: string; name: string }>;
  };
  time: {
    rows: Array<{
      id: string;
      when: string;
      who: string;
      task: string;
      duration: string;
      status: string;
    }>;
    empty: boolean;
    emptyCopy: string;
  };
  updates: {
    kind: "empty" | "records" | "refusal";
    copy: string;
    rows: Array<{
      id: string;
      prose: string | null;
      blocker: string | null;
      meta: string | null;
    }>;
  };
  files: {
    rows: DossierFileRow[];
    empty: boolean;
    emptyCopy: string;
  };
  reminders: {
    rows: DossierReminderRow[];
    empty: boolean;
    emptyCopy: string;
  };
  notes: {
    rows: Array<{ id: string; content: string; meta: string; audioUrl: string | null; audioRecordingId: string | null; transcriptStatus: string | null; audioTranscript: string | null }>;
    empty: boolean;
    emptyCopy: string;
  };
  settings: {
    fields: Array<{ label: string; value: string }>;
    lead: { id: string; name: string } | null;
    members: Array<{ id: string; name: string }>;
    /** Rows in `project_members`, each one a member a reader could take off. */
    memberRows: Array<{ id: string; name: string; self: boolean; action: string; consequence: string }>;
    documentationEnabled: boolean;
  };
  history: {
    rows: Array<{
      id: string;
      from: string | null;
      to: string;
      when: string;
      who: string;
      /** How long the Project sat in `to` — until the next change, or until now. */
      held: string;
    }>;
    empty: boolean;
    emptyCopy: string;
  };
  tags: {
    vocabulary: Array<DossierTag & { attached: boolean; deleteConsequence: string }>;
    emptyCopy: string;
  };
  dailyUpdate: {
    kind: "empty" | "record" | "refusal";
    copy: string;
    prose: string | null;
    blocker: string | null;
    meta: string | null;
  };
  evidence: {
    tiles: Array<{ id: string; kind: "screenshot" | "idle"; caption: string }>;
    empty: boolean;
    emptyCopy: string;
    footnote: string;
  };
  budgetTime: {
    consumedLabel: string;
    percent: number | null;
    trackedThisMonth: string;
    unapproved: string | null;
  };
  documents: {
    rows: Array<{
      id: string;
      title: string;
      meta: string;
      href: string;
      /** Sibling indexes the reorder route takes; null where the move goes nowhere. */
      order: { parentId: string | null; up: number | null; down: number | null };
    }>;
    count: number;
    empty: boolean;
    emptyCopy: string;
  };
  client: {
    name: string;
    initials: string;
    meta: string;
    contacts: Array<{ name: string; role: string | null }>;
    empty: boolean;
  } | null;
  filed: Array<{ label: string; value: string }>;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const PROJECT_STATUS_LABEL: Record<string, string> = {
  planned: "PLANNED",
  active: "ACTIVE",
  on_hold: "ON HOLD",
  in_review: "IN REVIEW",
  completed: "COMPLETED",
};

const TAB_LABEL: Record<DossierTabId, string> = {
  overview: "Overview",
  tasks: "Tasks",
  time: "Time",
  activity: "Activity",
  updates: "Updates",
  notes: "Notes",
  reminders: "Reminders",
  documents: "Documents",
  files: "Files",
  settings: "Settings",
};

const VIEW_DAILY_UPDATES_CAPABILITY = "View Daily Updates";

/**
 * Project and Document depth (#260). Each of these routes existed for v1's
 * Project page; the dossier reaches them instead of a v1 screen.
 */
export function projectClonePath(projectId: string): string {
  return `/api/crm/projects/${projectId}/clone`;
}

export function projectStageHistoryPath(projectId: string): string {
  return `/api/crm/projects/${projectId}/stage-history`;
}

export function projectTagsPath(projectId: string): string {
  return `/api/crm/projects/${projectId}/tags`;
}

export function projectTagPath(projectId: string, tagId: string): string {
  return `/api/crm/projects/${projectId}/tags/${tagId}`;
}

export function projectMemberPath(projectId: string, userId: string): string {
  return `/api/crm/projects/${projectId}/members/${userId}`;
}

export function projectDocumentationPath(projectId: string): string {
  return `/api/crm/projects/${projectId}/documentation`;
}

export function tagsPath(): string {
  return "/api/crm/tags";
}

export function tagPath(tagId: string): string {
  return `/api/crm/tags/${tagId}`;
}

export function documentDuplicatePath(documentId: string): string {
  return `/api/documents/${documentId}/duplicate`;
}

/** Keyed by the `projects` row a Document belongs to, not the CRM Project. */
export function documentsReorderPath(documentProjectId: string): string {
  return `/api/projects/${documentProjectId}/documents/reorder`;
}

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

function formatWhen(updatedAt: Date | string | null | undefined, now: Date): string {
  const value = parseDate(updatedAt ?? null);
  if (!value) return "";
  if (sameDay(value, now)) return formatClock(value);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(value, yesterday)) return "YDA";
  return `${value.getDate()} ${MONTHS[value.getMonth()]}`;
}

function formatDayStamp(value: Date): string {
  return `${value.getDate().toString().padStart(2, "0")} ${MONTHS[value.getMonth()]}`;
}

function hoursLabel(hours: number): string {
  return `${hours.toFixed(1)} h`;
}

function kindLabel(project: DossierProject): string {
  if (project.projectType === "internal" || !project.client) return "INTERNAL";
  if (project.projectType === "monthly") return "MONTHLY";
  if (project.projectType === "hourly_budget") return "HOURLY";
  return "CLIENT PROJECT";
}

function statusLabel(status: string): string {
  return PROJECT_STATUS_LABEL[status] ?? status.replace(/_/g, " ").toUpperCase();
}

function personChip(user: DossierPerson): { name: string; initials: string } {
  return { name: memberName(user), initials: memberInitials(user) };
}

function visibleRecords<T extends { access?: string | null }>(records: T[]): T[] {
  return records.filter((record) => record.access !== "restricted");
}

function visibleDocuments(documents: DossierDocument[]): DossierDocument[] {
  return visibleRecords(documents);
}

function capabilityRefusal(capability: string, ownerName: string | null): string {
  const base = `You do not have the ${capability} Capability.`;
  if (!ownerName) return base;
  return `${base} ${ownerName} (Owner) can grant it.`;
}

function composeDailyUpdate(input: DossierInput): DossierModel["dailyUpdate"] {
  if (input.dailyUpdateCapabilityMiss) {
    return {
      kind: "refusal",
      copy: capabilityRefusal(VIEW_DAILY_UPDATES_CAPABILITY, input.ownerName),
      prose: null,
      blocker: null,
      meta: null,
    };
  }
  const update = input.dailyUpdate;
  if (!update) {
    return {
      kind: "empty",
      copy: "No Daily Update on this Project yet.",
      prose: null,
      blocker: null,
      meta: null,
    };
  }
  const prose = (update.whatHappened || update.whatWasDone || update.nextSteps || "").trim();
  const blocker =
    update.waitingOnClient || update.blockageType
      ? "Waiting on the Client."
      : null;
  const when = parseDate(update.updateDate ?? update.createdAt ?? null);
  const who = update.user ? memberName(update.user) : null;
  const metaParts = [
    when ? `${formatDayStamp(when)} ${formatClock(when)}` : null,
    who ? who.toUpperCase() : null,
  ].filter(Boolean);
  return {
    kind: "record",
    copy: "",
    prose: prose || null,
    blocker,
    meta: metaParts.length > 0 ? metaParts.join(" · ") : null,
  };
}

function composeNextActions(input: DossierInput): DossierModel["nextActions"] {
  const tasks = input.tasks.filter((task) => task.status !== "archived");
  const rows = tasks.map((task) => {
    const done = task.status === "done";
    const doneAt = parseDate(task.updatedAt ?? task.createdAt ?? null);
    return {
      id: task.id,
      title: task.name,
      done,
      flag: !done && input.trackingTaskId === task.id ? ("TIMER RUNNING" as const) : null,
      meta: done ? `DONE${doneAt ? ` ${formatDayStamp(doneAt)}` : ""}` : "",
      status: taskStatusLabel(task.status),
      statusValue: task.status,
    };
  });
  return {
    openCount: rows.filter((row) => !row.done).length,
    blockedCount: 0,
    rows,
    empty: rows.length === 0,
    emptyCopy: "No Tasks on this Project yet.",
  };
}

function projectAssignees(project: DossierProject | null): Array<{ id: string; name: string }> {
  const assignees: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  for (const member of project?.members ?? []) {
    if (!member.user?.id) continue;
    if (seen.has(member.user.id)) continue;
    seen.add(member.user.id);
    assignees.push({ id: member.user.id, name: memberName(member.user) });
  }
  if (project?.assignee?.id && !seen.has(project.assignee.id)) {
    assignees.unshift({ id: project.assignee.id, name: memberName(project.assignee) });
  }
  return assignees;
}

function composeTime(input: DossierInput): DossierModel["time"] {
  const tasksById = new Map(input.tasks.map((task) => [task.id, task.name]));
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const rows = input.timeEntries.map((entry) => {
    const user = entry.user ?? (entry.userId ? usersById.get(entry.userId) : undefined);
    return {
      id: entry.id,
      when: formatWhen(entry.startTime, input.now),
      who: user ? memberName(user) : "Member",
      task: (entry.taskId && tasksById.get(entry.taskId)) || "—",
      duration: formatHours(entry.duration),
      status: entry.status.replace(/_/g, " ").toUpperCase(),
    };
  });
  return {
    rows,
    empty: rows.length === 0,
    emptyCopy: "No Time Entries on this Project you can access.",
  };
}

function composeUpdateRow(update: DossierDailyUpdate): DossierModel["updates"]["rows"][number] {
  const prose = (update.whatHappened || update.whatWasDone || update.nextSteps || "").trim();
  const blocker = update.waitingOnClient || update.blockageType ? "Waiting on the Client." : null;
  const when = parseDate(update.updateDate ?? update.createdAt ?? null);
  const who = update.user ? memberName(update.user) : null;
  const metaParts = [
    when ? `${formatDayStamp(when)} ${formatClock(when)}` : null,
    who ? who.toUpperCase() : null,
  ].filter(Boolean);
  return {
    id: update.id,
    prose: prose || null,
    blocker,
    meta: metaParts.length > 0 ? metaParts.join(" · ") : null,
  };
}

function composeUpdates(input: DossierInput): DossierModel["updates"] {
  if (input.dailyUpdateCapabilityMiss) {
    return {
      kind: "refusal",
      copy: capabilityRefusal(VIEW_DAILY_UPDATES_CAPABILITY, input.ownerName),
      rows: [],
    };
  }
  const list =
    input.dailyUpdates.length > 0
      ? input.dailyUpdates
      : input.dailyUpdate
        ? [input.dailyUpdate]
        : [];
  if (list.length === 0) {
    return {
      kind: "empty",
      copy: "No Daily Update on this Project yet.",
      rows: [],
    };
  }
  return {
    kind: "records",
    copy: "",
    rows: list.map(composeUpdateRow),
  };
}

/**
 * A Dossier File comes from a note attachment, so its href is an object path
 * the backend serves — not a v2 route. The row says which kind of destination
 * it has and the page opens it accordingly (#213); the object path itself now
 * goes to the v2 File viewer rather than a bare browser tab (#216).
 */
function composeFiles(input: DossierInput): DossierModel["files"] {
  const files = visibleRecords(input.files);
  const backHref = input.project ? `${projectHref(input.project.id)}/files` : "/projects";
  return {
    rows: files.map((file) => {
      const destination = dossierFileDestination({
        href: file.href,
        name: file.title,
        backHref,
      });
      return {
        id: file.id,
        title: file.title,
        meta: formatWhen(file.updatedAt, input.now),
        href: destination.href,
        target: destination.target,
      };
    }),
    empty: files.length === 0,
    emptyCopy: "No Files on this Project you can access.",
  };
}

/** `<input type="datetime-local">` wants local wall-clock, not an ISO instant. */
function datetimeLocalValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => part.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function composeReminders(input: DossierInput): DossierModel["reminders"] {
  const rows = input.reminders.map((reminder) => {
    const done = reminder.status === "done";
    return {
      id: reminder.id,
      title: reminder.title,
      note: reminder.note ?? null,
      due: formatWhen(reminder.dueAt, input.now),
      status: reminder.status.replace(/_/g, " ").toUpperCase(),
      done,
      canComplete: !done,
      canReopen: done,
      // The edit form needs the values back, not the formatted ones.
      draft: {
        title: reminder.title,
        note: reminder.note ?? "",
        dueAt: datetimeLocalValue(reminder.dueAt),
      },
    };
  });
  return { rows, empty: rows.length === 0, emptyCopy: "No Reminders on this Project yet." };
}

function composeNotes(input: DossierInput): DossierModel["notes"] {
  const rows = input.notes.map((note) => ({
    id: note.id,
    content: note.content,
    meta: [note.createdAt ? formatWhen(note.createdAt, input.now) : null, note.createdBy ? memberName(note.createdBy).toUpperCase() : null].filter(Boolean).join(" · "),
    audioUrl: note.audioUrl ?? null,
    audioRecordingId: note.audioRecordingId ?? null,
    transcriptStatus: note.transcriptStatus ?? null,
    audioTranscript: note.audioTranscript ?? null,
  }));
  return { rows, empty: rows.length === 0, emptyCopy: "No notes on this Project yet." };
}

function composeSettings(input: DossierInput): DossierModel["settings"] {
  const project = input.project;
  if (!project) {
    return { fields: [], lead: null, members: [], memberRows: [], documentationEnabled: false };
  }
  const lead = project.assignee?.id
    ? { id: project.assignee.id, name: memberName(project.assignee) }
    : null;
  const members = projectAssignees(project);
  const start = parseDate(project.startDate ?? null);
  const due = parseDate(project.dueDate ?? null);
  const fields: Array<{ label: string; value: string }> = [
    { label: "NAME", value: project.project?.name || "Untitled Project" },
    { label: "CLIENT", value: project.client?.name || "—" },
    { label: "KIND", value: kindLabel(project) },
    { label: "STATUS", value: statusLabel(project.projectStatus) },
    { label: "LEAD", value: lead?.name || "—" },
    { label: "BUDGET", value: project.budgetedHours != null && project.budgetedHours > 0 ? hoursLabel(project.budgetedHours) : "—" },
    { label: "START", value: start ? formatDayStamp(start) : "—" },
    { label: "DUE", value: due ? formatDayStamp(due) : "—" },
    { label: "DOCUMENTATION", value: project.documentationEnabled ? "ON" : "OFF" },
  ];
  // Custom CRM field values are not shown here: `crm_custom_field_values`
  // holds them but no route exposes it, so there is nothing honest to render.
  // Composing one needs a BFF route, which #213 does not carry.
  const memberRows: DossierModel["settings"]["memberRows"] = [];
  const seen = new Set<string>();
  for (const member of project.members ?? []) {
    if (!member.user?.id || seen.has(member.user.id)) continue;
    seen.add(member.user.id);
    const name = memberName(member.user);
    const self = member.user.id === input.currentUserId;
    memberRows.push({
      id: member.user.id,
      name,
      self,
      action: self ? "Leave" : "Remove",
      consequence: self
        ? "You will no longer be assigned to this Project. A Project owner or Administrator can add you back."
        : `${name} will no longer be assigned to this Project. They can be added back from Settings.`,
    });
  }
  return {
    fields,
    lead,
    members,
    memberRows,
    documentationEnabled: Boolean(project.documentationEnabled),
  };
}

function lifecycleLabel(status: string): string {
  return status.replace(/_/g, " ").toUpperCase();
}

function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
  return `${rest} min`;
}

/**
 * Status history: the only record of how long anything took (#260). The route returns newest
 * first; the composer sorts anyway, because the span of each row is measured
 * to the change after it.
 */
function composeHistory(input: DossierInput): DossierModel["history"] {
  const changes = input.stageHistory
    .map((change) => ({ change, at: parseDate(change.changedAt) }))
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  const rows = changes.map(({ change, at }, index) => {
    const next = index > 0 ? changes[index - 1].at : null;
    const held = at ? formatSpan((next ?? input.now).getTime() - at.getTime()) : "—";
    return {
      id: change.id,
      from: change.fromStatus ? lifecycleLabel(change.fromStatus) : null,
      to: lifecycleLabel(change.toStatus),
      when: at ? formatDayStamp(at) : "",
      who: change.changedBy ? memberName(change.changedBy) : "—",
      held: next || !at ? held : `${held} so far`,
    };
  });
  return {
    rows,
    empty: rows.length === 0,
    emptyCopy: "No Project Status changes recorded for this Project yet.",
  };
}

function composeTags(input: DossierInput): DossierModel["tags"] {
  const attached = new Set(input.tags.map((tag) => tag.id));
  const vocabulary = input.workspaceTags
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      attached: attached.has(tag.id),
      deleteConsequence: `${tag.name} will be removed from every Project that carries it. This cannot be undone.`,
    }))
    .sort((a, b) => Number(b.attached) - Number(a.attached) || a.name.localeCompare(b.name));
  return {
    vocabulary,
    emptyCopy: vocabulary.length === 0 ? "No Tags in this Workspace yet." : "",
  };
}

/** Siblings share a parent; the reorder route takes an index among them, the moved one excluded. */
function documentOrder(documents: DossierDocument[]): Map<string, DossierModel["documents"]["rows"][number]["order"]> {
  const byParent = new Map<string | null, DossierDocument[]>();
  for (const document of documents) {
    const parentId = document.parentId ?? null;
    const list = byParent.get(parentId) ?? [];
    list.push(document);
    byParent.set(parentId, list);
  }
  const order = new Map<string, DossierModel["documents"]["rows"][number]["order"]>();
  byParent.forEach((siblings, parentId) => {
    const sorted = [...siblings].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    sorted.forEach((document, index) => {
      order.set(document.id, {
        parentId,
        up: index > 0 ? index - 1 : null,
        down: index < sorted.length - 1 ? index + 1 : null,
      });
    });
  });
  return order;
}

export function composeDossier(input: DossierInput): DossierModel {
  const project = input.project;
  const missing = !project;
  const documents = visibleDocuments(input.documents);
  const nextActions = composeNextActions(input);
  const time = composeTime(input);
  const updates = composeUpdates(input);
  const files = composeFiles(input);
  const reminders = composeReminders(input);
  const notes = composeNotes(input);
  const settings = composeSettings(input);
  const history = composeHistory(input);
  const tags = composeTags(input);
  const order = documentOrder(documents);
  const assignees = projectAssignees(project);
  const trackedMtd = formatHours(input.monthSeconds);
  const budgeted = project?.budgetedHours ?? 0;
  const actual = project?.actualHours ?? 0;
  const budgetPercent = budgeted > 0 ? Math.round((actual / budgeted) * 100) : null;
  const screenshots = input.screenshots.filter((shot) => !shot.deletedAt);
  const usersById = new Map(input.users.map((user) => [user.id, user]));

  const tabs: DossierTab[] = project
    ? DOSSIER_TAB_IDS.map((id) => ({
        id,
        label: TAB_LABEL[id],
        href: id === "overview" ? projectHref(project.id) : `${projectHref(project.id)}/${id}`,
        count:
          id === "tasks"
            ? String(nextActions.rows.length)
            : id === "time"
              ? String(time.rows.length)
              : id === "activity"
                ? String(screenshots.length)
                : id === "updates"
                  ? updates.kind === "records"
                    ? String(updates.rows.length)
                    : null
                  : id === "documents"
                    ? String(documents.length)
                    : id === "files"
                      ? String(files.rows.length)
                      : id === "notes"
                        ? String(notes.rows.length)
                        : id === "reminders"
                          ? String(reminders.rows.length)
                      : null,
        active: id === input.tab,
      }))
    : [];

  let identity: DossierModel["identity"] = null;
  if (project) {
    const team: Array<{ name: string; initials: string }> = [];
    const seen = new Set<string>();
    for (const member of project.members ?? []) {
      if (!member.user) continue;
      const chip = personChip(member.user);
      if (seen.has(chip.name)) continue;
      seen.add(chip.name);
      team.push(chip);
    }
    const updatedAt = parseDate(project.updatedAt ?? null);
    identity = {
      clientLabel: project.client?.name ?? null,
      kindLabel: kindLabel(project),
      title: project.project?.name || "Untitled Project",
      status: statusLabel(project.projectStatus),
      lead: project.assignee
        ? { ...personChip(project.assignee), self: project.assignee.id === input.currentUserId }
        : null,
      team,
      updatedLabel: updatedAt ? `UPDATED ${formatWhen(updatedAt, input.now)}` : null,
      tags: input.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    };
  }

  const client = project?.client
    ? {
        name: project.client.name,
        initials: project.client.name
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join("") || project.client.name.slice(0, 2).toUpperCase(),
        meta:
          input.clientActiveProjectCount === 1
            ? "1 ACTIVE PROJECT"
            : `${input.clientActiveProjectCount} ACTIVE PROJECTS`,
        contacts: (project.client.contacts ?? []).map((contact) => ({
          name: contact.name,
          role: contact.role ? contact.role.replace(/_/g, " ").toUpperCase() : null,
        })),
        empty: false,
      }
    : null;

  const filed: Array<{ label: string; value: string }> = [];
  if (project) {
    filed.push({ label: "TASKS", value: String(nextActions.rows.length) });
    filed.push({ label: "TIME", value: trackedMtd });
    filed.push({ label: "EVIDENCE", value: String(screenshots.length) });
    filed.push({ label: "DOCS", value: String(documents.length) });
  }

  return {
    missing,
    tab: input.tab,
    tabIsPlaceholder: false,
    identity,
    stats: {
      budgetPercent,
      trackedMtd,
      planHours: budgeted > 0 ? hoursLabel(budgeted) : null,
      showFinance: false,
    },
    tabs,
    nextActions,
    tasks: {
      rows: nextActions.rows,
      empty: nextActions.empty,
      emptyCopy: nextActions.emptyCopy,
      assignees,
    },
    time,
    updates,
    files,
    reminders,
    notes,
    settings,
    history,
    tags,
    dailyUpdate: composeDailyUpdate(input),
    evidence: {
      tiles: screenshots.map((shot) => {
        const user = usersById.get(shot.userId);
        const when = formatWhen(shot.capturedAt, input.now);
        const who = user ? memberName(user).toUpperCase() : "";
        return {
          id: shot.id,
          kind: "screenshot" as const,
          caption: [when, who].filter(Boolean).join(" · "),
        };
      }),
      empty: screenshots.length === 0,
      emptyCopy: "No Activity Evidence for this Project you can access.",
      footnote: "Members can see their own Activity Evidence. Tracking Policy decides who else may review it.",
    },
    budgetTime: {
      consumedLabel:
        budgeted > 0 ? `${hoursLabel(actual)} / ${hoursLabel(budgeted)}` : trackedMtd,
      percent: budgetPercent,
      trackedThisMonth: trackedMtd,
      unapproved: null,
    },
    documents: {
      rows: documents.map((document) => ({
        id: document.id,
        title: document.title,
        meta: formatWhen(document.updatedAt, input.now),
        href: `/document/${document.id}`,
        order: order.get(document.id) ?? { parentId: null, up: null, down: null },
      })),
      count: documents.length,
      empty: documents.length === 0,
      emptyCopy: "No Project Documents you can access.",
    },
    client,
    filed,
  };
}
