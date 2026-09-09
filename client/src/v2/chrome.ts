/**
 * v2 chrome actions (#184). Search, Timer commands, Ask, Notifications,
 * refusals, and toast copy. Motion lives in motion.ts.
 */

import { documentHref } from "./library";
import type { V2CommandPanel } from "./presentation";
import { projectHref } from "./today";
import { notificationOrigin } from "./workspace";

export type SearchHit = {
  type: string;
  id: string;
  title: string;
  projectName?: string;
};

export type SearchWorkspaceDocument = {
  id: string;
  name: string;
  access?: string | null;
  folderName?: string | null;
};

export type SearchFolder = {
  id: string;
  name: string;
};

export type SearchAccessFact = {
  filteredByAccess: true;
  restrictedHidden?: number;
};

export type SearchRow = {
  id: string;
  kind: string;
  title: string;
  meta: string | null;
  href: string;
};

export type SearchModel = {
  rows: SearchRow[];
  footer: string | null;
};

export function composeSearch(input: {
  query: string;
  searchHits: SearchHit[];
  workspaceDocuments: SearchWorkspaceDocument[];
  folders: SearchFolder[];
  accessFact?: SearchAccessFact;
}): SearchModel {
  if (!input.query.trim()) {
    return { rows: [], footer: null };
  }
  const rows: SearchRow[] = [];

  for (const hit of input.searchHits) {
    rows.push({
      id: `${hit.type}-${hit.id}`,
      kind: hit.type.toUpperCase(),
      title: hit.title,
      meta: hit.projectName ?? null,
      href: hit.type === "project" ? projectHref(hit.id) : "/project-documentation",
    });
  }

  for (const folder of input.folders) {
    rows.push({
      id: `folder-${folder.id}`,
      kind: "FOLDER",
      title: folder.name,
      meta: null,
      href: "/documents",
    });
  }

  for (const document of input.workspaceDocuments) {
    if (!isVisibleDocument(document.access)) continue;
    rows.push({
      id: `document-${document.id}`,
      kind: "DOCUMENT",
      title: document.name,
      meta: document.folderName ?? null,
      href: documentHref(document.id),
    });
  }

  return { rows, footer: searchFooter(input.accessFact) };
}

function isVisibleDocument(access: string | null | undefined): boolean {
  const value = (access ?? "workspace").toLowerCase();
  return value === "workspace" || value === "everyone";
}

function searchFooter(fact: SearchAccessFact | undefined): string | null {
  if (!fact?.filteredByAccess) return null;
  if (typeof fact.restrictedHidden === "number") {
    return `RESULTS FILTERED BY YOUR ACCESS · ${fact.restrictedHidden} RESTRICTED ITEMS HIDDEN`;
  }
  return "RESULTS FILTERED BY YOUR ACCESS";
}

export type TimerChipCommand = "start" | "pause" | "resume" | "stop";

export function timerChipCommands(appearance: "running" | "paused" | "idle"): {
  primary: TimerChipCommand;
  stop: "stop" | null;
} {
  if (appearance === "running") return { primary: "pause", stop: "stop" };
  if (appearance === "paused") return { primary: "resume", stop: "stop" };
  return { primary: "start", stop: null };
}

export type CommandPanel = V2CommandPanel | null;

export function selectCommandPanel(current: CommandPanel, next: V2CommandPanel): CommandPanel {
  return current === next ? null : next;
}

export type ChromeNotification = {
  id: string;
  type: string;
  message: string | null;
  isRead: number;
  createdAt: Date | string | null;
  crmProjectId?: string | null;
  workspace?: { id: string; name: string } | null;
};

export type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  when: string;
  origin: string;
  href: string;
  unread: boolean;
};

export type NotificationsModel = {
  rows: NotificationRow[];
  emptyCopy: string;
};

export function composeNotifications(input: {
  notifications: ChromeNotification[];
  now: Date;
}): NotificationsModel {
  return {
    emptyCopy: "No notifications yet.",
    rows: input.notifications.map((notification) => ({
      id: notification.id,
      kind: notificationKind(notification.type),
      title: notification.message?.trim() || "You have a notification",
      when: formatWhen(notification.createdAt, input.now),
      origin: notificationOrigin(notification),
      href: notificationHref(notification),
      unread: notification.isRead === 0,
    })),
  };
}

function notificationKind(type: string): string {
  if (type === "daily_update_reminder") return "UPDATE";
  if (type === "mention") return "MENTION";
  if (type === "reminder") return "REMINDER";
  return type.replace(/_/g, " ").toUpperCase();
}

function notificationHref(notification: ChromeNotification): string {
  if (notification.type === "daily_update_reminder") return "/daily-update";
  if (notification.crmProjectId) return projectHref(notification.crmProjectId);
  return "/";
}

export type AskMessageInput = {
  role: "user" | "assistant";
  content: string;
  relevantDocs?: number;
};

export type AskMessage = {
  role: "user" | "assistant";
  content: string;
  source: string | null;
};

export type AskModel = {
  kicker: string;
  title: string;
  messages: AskMessage[];
  emptyCopy: string;
  footnote: string;
};

export function composeAsk(input: { messages: AskMessageInput[] }): AskModel {
  return {
    kicker: "ASK DOCUFLOW",
    title: "Answers from your records",
    emptyCopy:
      "Ask about a Project, Client, or policy in this Workspace. Answers honor Document Access.",
    footnote: "Restricted Documents stay hidden from this panel when they are hidden from search and the library.",
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      source:
        message.role === "assistant" && (message.relevantDocs ?? 0) > 0
          ? "SOURCES · Records in this Workspace"
          : null,
    })),
  };
}

export type ChromeRefusal =
  | { kind: "capability"; capability: string; ownerName?: string | null }
  | { kind: "workspace-condition"; workspaceName: string; condition: "Read-only" | "Trial" | "Past due" }
  | { kind: "seat"; purchased: number }
  | { kind: "generic"; message: string };

export function chromeRefusal(input: ChromeRefusal): string {
  if (input.kind === "capability") {
    const base = `You do not have the ${input.capability} Capability.`;
    return input.ownerName ? `${base} ${input.ownerName} (Owner) can grant it.` : base;
  }
  if (input.kind === "workspace-condition") {
    if (input.condition === "Read-only") {
      return `${input.workspaceName} is read-only. Viewing, export, and recovery stay available.`;
    }
    return `${input.workspaceName} is ${input.condition.toLowerCase()}.`;
  }
  if (input.kind === "seat") {
    return `All ${input.purchased} purchased seats are consumed.`;
  }
  const lower = input.message.toLowerCase();
  if (
    lower.includes("permission denied") ||
    lower.includes("not authorized") ||
    lower.includes("access denied") ||
    lower.includes("forbidden")
  ) {
    return "This action needs a Capability. An Owner can grant it.";
  }
  return input.message;
}

export type ToastModel = {
  message: string;
  edge: "bottom";
  undoLabel: "UNDO" | null;
};

export function toastModel(input: { message: string; undo?: boolean }): ToastModel {
  return {
    message: input.message,
    edge: "bottom",
    undoLabel: input.undo ? "UNDO" : null,
  };
}

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

function formatWhen(updatedAt: Date | string | null, now: Date): string {
  const value = parseDate(updatedAt);
  if (!value) return "";
  if (sameDay(value, now)) return formatClock(value);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(value, yesterday)) return "YDA";
  return `${value.getDate()} ${MONTHS[value.getMonth()]}`;
}
