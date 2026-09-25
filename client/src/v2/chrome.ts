/**
 * v2 chrome actions (#184, #210). Search, Timer commands, Ask, Notifications,
 * Delivery Preference, account menu, refusals, and toast copy. Motion lives
 * in motion.ts.
 */

import { PLATFORM_CONSOLE_LABEL } from "./platform";
import { isVisibleDocumentAccess } from "@shared/documentAccess";
import {
  DELIVERY_CATEGORIES,
  emailChannelEnabled,
  toggleDeliveryPreference,
  type DeliveryCategoryId,
} from "@shared/deliveryPreference";
import { documentHref, projectDocumentHref } from "./library";
import type { V2CommandPanel } from "./presentation";
import { projectHref } from "./today";
import { notificationOrigin, workspaceRoleInCopy } from "./workspace";

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
  assignedProjectNames?: string[];
}): SearchModel {
  if (!input.query.trim()) {
    return { rows: [], footer: null };
  }
  const rows: SearchRow[] = [];
  const assigned =
    input.assignedProjectNames === undefined
      ? null
      : new Set(input.assignedProjectNames.map((name) => name.toLowerCase()));

  for (const hit of input.searchHits) {
    if (hit.type === "document" && assigned) {
      const projectName = (hit.projectName ?? "").toLowerCase();
      if (!projectName || !assigned.has(projectName)) continue;
    }
    rows.push({
      id: `${hit.type}-${hit.id}`,
      kind: hit.type.toUpperCase(),
      title: hit.title,
      meta: hit.projectName ?? null,
      href:
        hit.type === "project"
          ? projectHref(hit.id)
          : hit.type === "document"
            ? projectDocumentHref(hit.id)
            : "/project-documentation",
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
  return isVisibleDocumentAccess(access);
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
  unreadCount: number;
  emptyCopy: string;
};

export function composeNotifications(input: {
  notifications: ChromeNotification[];
  now: Date;
}): NotificationsModel {
  const rows = input.notifications.map((notification) => ({
    id: notification.id,
    kind: notificationKind(notification.type),
    title: notification.message?.trim() || "You have a notification",
    when: formatWhen(notification.createdAt, input.now),
    origin: notificationOrigin(notification),
    href: notificationHref(notification),
    unread: notification.isRead === 0,
  }));
  return {
    emptyCopy: "No notifications yet.",
    unreadCount: rows.filter((row) => row.unread).length,
    rows,
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

export const ASK_CHAT_MODE = "both" as const;

export type AskCitationInput = {
  id: string;
  title: string;
  kind: "document" | "project-document";
  access?: string | null;
};

export type AskMessageInput = {
  role: "user" | "assistant";
  content: string;
  relevantDocs?: number;
  citations?: AskCitationInput[];
};

export type AskSource = {
  id: string;
  title: string;
  kind: string;
  href: string;
};

export type AskMessage = {
  role: "user" | "assistant";
  content: string;
  source: string | null;
  sources: AskSource[];
};

export type AskModel = {
  kicker: string;
  title: string;
  mode: "workspace-records";
  messages: AskMessage[];
  emptyCopy: string;
  footnote: string;
};

export function composeAsk(input: { messages: AskMessageInput[] }): AskModel {
  return {
    kicker: "ASK DOCUFLOW",
    title: "Answers from your records",
    mode: "workspace-records",
    emptyCopy:
      "Ask about a Project, Client, or policy in this Workspace. Answers honor Document Access.",
    footnote: "Restricted Documents stay hidden from this panel when they are hidden from search and the library.",
    messages: input.messages.map((message) => {
      const sources = message.role === "assistant" ? citeAskSources(message.citations ?? []) : [];
      const cited =
        message.role === "assistant" &&
        (sources.length > 0 || ((message.relevantDocs ?? 0) > 0 && message.citations === undefined));
      return {
        role: message.role,
        content: message.content,
        source: cited ? "SOURCES · Records in this Workspace" : null,
        sources,
      };
    }),
  };
}

function citeAskSources(citations: AskCitationInput[]): AskSource[] {
  const seen = new Set<string>();
  const sources: AskSource[] = [];
  for (const citation of citations) {
    if (!isVisibleDocument(citation.access)) continue;
    if (seen.has(citation.id)) continue;
    seen.add(citation.id);
    sources.push({
      id: citation.id,
      title: citation.title,
      kind: citation.kind === "project-document" ? "PROJECT DOCUMENT" : "DOCUMENT",
      href:
        citation.kind === "project-document" ? projectDocumentHref(citation.id) : documentHref(citation.id),
    });
  }
  return sources;
}

export {
  DELIVERY_CATEGORIES,
  toggleDeliveryPreference,
  type DeliveryCategoryId,
};

export type DeliveryChannelState = { on: boolean; locked: boolean };

export type DeliveryPreferenceRow = {
  id: DeliveryCategoryId;
  label: string;
  inbox: { on: true; locked: true };
  email: DeliveryChannelState;
};

export type DeliveryPreferenceModel = {
  kicker: string;
  title: string;
  copy: string;
  rows: DeliveryPreferenceRow[];
};

export function composeDeliveryPreference(input: {
  workspaceName: string;
  emailByCategory: Partial<Record<DeliveryCategoryId, boolean>>;
}): DeliveryPreferenceModel {
  return {
    kicker: "CHANNELS",
    title: "Delivery Preference",
    copy: `The in-app inbox cannot be disabled. Delivery Preference is for ${input.workspaceName}. Security, billing, and membership notices always arrive.`,
    rows: DELIVERY_CATEGORIES.map((category) => {
      const locked = category.mandatory;
      return {
        id: category.id,
        label: category.label,
        inbox: { on: true, locked: true },
        email: { on: emailChannelEnabled(input.emailByCategory, category.id), locked },
      };
    }),
  };
}

export type AccountTheme = "light" | "dark" | "system";

export type AccountMenuStructure = "theme" | "separator" | "platform" | "account" | "signOut";

export type AccountMenuModel = {
  themeOptions: Array<{ id: AccountTheme; label: string; selected: boolean }>;
  /** Radio group, then a separator, then Account and Sign out (#249). */
  structure: AccountMenuStructure[];
  /** The account destination itself — where deletion lives (#217, Flow 10). */
  accountLabel: "Account";
  /** The platform console, for a platform admin only (#266) — never a rail destination. */
  platformLabel: typeof PLATFORM_CONSOLE_LABEL;
  signOutLabel: "Sign out";
};

export function composeAccountMenu(input: { theme: string; platformAdmin?: boolean }): AccountMenuModel {
  // System follows the OS (#272); anything unrecognised reads as Light.
  const theme: AccountTheme = input.theme === "dark" || input.theme === "system" ? input.theme : "light";
  return {
    accountLabel: "Account",
    platformLabel: PLATFORM_CONSOLE_LABEL,
    signOutLabel: "Sign out",
    structure: input.platformAdmin
      ? ["theme", "separator", "platform", "account", "signOut"]
      : ["theme", "separator", "account", "signOut"],
    themeOptions: [
      { id: "light", label: "Light", selected: theme === "light" },
      { id: "dark", label: "Dark", selected: theme === "dark" },
      { id: "system", label: "System", selected: theme === "system" },
    ],
  };
}

export type ChromeRefusal =
  | { kind: "capability"; capability: string; ownerName?: string | null }
  | {
      /**
       * A destination governed by the Workspace Role rather than by a Capability
       * (#238). Naming a Capability here would name a row that does not exist and
       * offer a grant nobody — the Owner included — could make.
       */
      kind: "workspace-role";
      destination: string;
      roles: string;
      workspaceRole: string;
      ownerName?: string | null;
    }
  | { kind: "workspace-condition"; workspaceName: string; condition: "Read-only" | "Trial" | "Past due" }
  | { kind: "seat"; purchased: number }
  | { kind: "generic"; message: string };

export function chromeRefusal(input: ChromeRefusal): string {
  if (input.kind === "capability") {
    const base = `You do not have the ${input.capability} Capability.`;
    return input.ownerName ? `${base} ${input.ownerName} (Owner) can grant it.` : base;
  }
  if (input.kind === "workspace-role") {
    const role = workspaceRoleInCopy(input.workspaceRole);
    const base = `${input.destination} is open to ${input.roles}. Your Workspace Role is ${role}.`;
    // The Owner is never told to ask the Owner: that was the refusal #238 found.
    if (!input.ownerName || role === "Owner") return base;
    return `${base} ${input.ownerName} (Owner) can change it.`;
  }
  if (input.kind === "workspace-condition") {
    if (input.condition === "Read-only") {
      return `${input.workspaceName} is read-only. Viewing, export, and recovery stay available.`;
    }
    return `${input.workspaceName} is ${input.condition.toLowerCase()}.`;
  }
  if (input.kind === "seat") {
    // Naming the wall without naming the way out leaves the reader to discover
    // the seat control on another destination unaided (#245, F3). Every surface
    // that raises this refusal is already gated on the Workspace Role that can
    // reach Billing, so the instruction is one the reader can follow.
    return `All ${input.purchased} purchased seats are consumed. Add seats in Administration → Billing.`;
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

export type RefusalPlacement = {
  open: boolean;
  align: "end";
  side: "bottom";
};

/**
 * A Capability refusal hangs from the control that failed (#245 F3, #249).
 * The composer names that attachment so a screen cannot place the popover
 * against a distant ancestor.
 */
export function composeRefusalPlacement(input: {
  failedControlId: string | null;
  controlId: string;
}): RefusalPlacement {
  return {
    open: input.failedControlId === input.controlId,
    align: "end",
    side: "bottom",
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
