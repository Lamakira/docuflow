export type AuthenticatedPresentation = {
  chrome: "v1" | "v2";
  signedInHome: "home" | "today";
};

export function authenticatedPresentation(v2Enabled: boolean): AuthenticatedPresentation {
  return v2Enabled
    ? { chrome: "v2", signedInHome: "today" }
    : { chrome: "v1", signedInHome: "home" };
}

export type V2CommandPanel = "ask" | "notifications" | "approvals";

export const V2_MOBILE_MAX_WIDTH = 639;
export const V2_DESKTOP_CONTENT_MIN_WIDTH = 1060;

export type V2ChromeLayout = {
  mode: "desktop" | "mobile";
  chrome: "command-bar" | "app-bar";
  timer: "chip" | "strip";
  context: "side-panel" | "sheet";
  rail: "fixed" | "drawer";
  contentMinWidth: number | null;
  stackedRegister: boolean;
  actionBar: boolean;
};

export function chromeLayoutForViewport(width: number): V2ChromeLayout {
  if (width <= V2_MOBILE_MAX_WIDTH) {
    return {
      mode: "mobile",
      chrome: "app-bar",
      timer: "strip",
      context: "sheet",
      rail: "drawer",
      contentMinWidth: null,
      stackedRegister: true,
      actionBar: true,
    };
  }
  return {
    mode: "desktop",
    chrome: "command-bar",
    timer: "chip",
    context: "side-panel",
    rail: "fixed",
    contentMinWidth: V2_DESKTOP_CONTENT_MIN_WIDTH,
    stackedRegister: false,
    actionBar: false,
  };
}

export type ContextSurface = {
  kind: "none" | "side-panel" | "sheet";
  route: string;
};

export function contextSurface(
  panel: V2CommandPanel | null,
  layout: V2ChromeLayout,
  route: string,
): ContextSurface {
  if (!panel) return { kind: "none", route };
  return { kind: layout.context, route };
}

export const DOSSIER_TAB_IDS = [
  "overview",
  "tasks",
  "time",
  "activity",
  "updates",
  "notes",
  "reminders",
  "documents",
  "files",
  "settings",
] as const;

export type DossierTabId = (typeof DOSSIER_TAB_IDS)[number];

const DOSSIER_TAB_SET = new Set<string>(DOSSIER_TAB_IDS);

/**
 * Time Tracking holds three views of one domain (#214): the Time Entry
 * register, the Workday totals the v1 dashboard showed, and the Projects &
 * Tasks manager. Entries stays the destination itself, so `/time` is the
 * register and the other two are named tabs under it.
 */
export const TIME_TAB_IDS = ["entries", "stats", "projects"] as const;

export type TimeTabId = (typeof TIME_TAB_IDS)[number];

const TIME_TAB_SET = new Set<string>(TIME_TAB_IDS);

/** Activity keeps its evidence register and adds the v1 capture gallery (#214). */
export const ACTIVITY_TAB_IDS = ["register", "gallery"] as const;

export type ActivityTabId = (typeof ACTIVITY_TAB_IDS)[number];

const ACTIVITY_TAB_SET = new Set<string>(ACTIVITY_TAB_IDS);

const TIME_TAB_CRUMB: Record<TimeTabId, string> = {
  entries: "TIME ENTRIES",
  stats: "TIME STATS",
  projects: "PROJECTS & TASKS",
};

export function timeTabHref(tab: TimeTabId): string {
  return tab === "entries" ? "/time" : `/time/${tab}`;
}

export function activityTabHref(tab: ActivityTabId): string {
  return tab === "register" ? "/activity" : `/activity/${tab}`;
}

export type V2Match =
  | { kind: "today"; title: "Today"; href: "/" }
  | { kind: "auth-redirect"; title: "Today"; href: "/" }
  | { kind: "projects"; title: "Projects"; href: "/projects" }
  | { kind: "legacy-project"; title: "Projects"; href: "/projects"; legacyProjectId: string }
  | { kind: "dossier"; title: string; href: "/projects"; projectId: string; tab: DossierTabId }
  | { kind: "documents"; title: "Workspace Documents"; href: "/documents" }
  | { kind: "project-documentation"; title: "Project Documentation"; href: "/project-documentation" }
  | { kind: "document-editor"; title: string; href: string; documentId: string; source: "workspace" | "project" }
  | { kind: "clients"; title: "Clients"; href: "/clients" }
  | { kind: "client-record"; title: string; href: "/clients"; clientId: string }
  | { kind: "opportunities"; title: "Opportunities"; href: "/opportunities" }
  | { kind: "opportunity-record"; title: "Opportunity"; href: "/opportunities"; opportunityId: string }
  | { kind: "time"; title: "Time Tracking"; href: string; tab: TimeTabId }
  | { kind: "daily-update"; title: "Daily Update"; href: "/daily-update" }
  | { kind: "daily-updates"; title: "Daily Updates"; href: "/daily-updates" }
  | { kind: "activity"; title: "Activity"; href: string; tab: ActivityTabId }
  | { kind: "people"; title: "People"; href: "/people" }
  | { kind: "invitation-accept"; title: "Invitation"; href: string }
  | { kind: "administration"; title: "Administration"; href: "/administration" }
  | { kind: "devices"; title: "Devices"; href: "/devices" }
  | { kind: "help"; title: "Help Center"; href: "/help"; slug?: string }
  | { kind: "placeholder"; title: string; href: string };

export type V2NavId =
  | "today"
  | "opportunities"
  | "clients"
  | "projects"
  | "documents"
  | "project-documentation"
  | "time"
  | "activity"
  | "people"
  | "administration"
  | "help"
  | "devices";

export type V2NavItem = {
  id: V2NavId;
  label: string;
  href: string;
  countKey?: "projects" | "people";
};

export type V2NavSection = {
  label: string | null;
  separated?: boolean;
  items: V2NavItem[];
};

export const V2_NAV: V2NavSection[] = [
  { label: null, items: [{ id: "today", label: "Today", href: "/" }] },
  {
    label: "WORK",
    items: [
      { id: "opportunities", label: "Opportunities", href: "/opportunities" },
      { id: "clients", label: "Clients", href: "/clients" },
      { id: "projects", label: "Projects", href: "/projects", countKey: "projects" },
    ],
  },
  {
    label: "KNOWLEDGE",
    items: [
      { id: "documents", label: "Workspace Documents", href: "/documents" },
      { id: "project-documentation", label: "Project Documentation", href: "/project-documentation" },
    ],
  },
  {
    label: "TIME & ACTIVITY",
    items: [
      { id: "time", label: "Time Tracking", href: "/time" },
      { id: "activity", label: "Activity", href: "/activity" },
    ],
  },
  {
    label: null,
    separated: true,
    items: [
      { id: "people", label: "People", href: "/people", countKey: "people" },
      { id: "administration", label: "Administration", href: "/administration" },
    ],
  },
];

function isDevicesPath(pathname: string): boolean {
  return (
    pathname === "/devices" ||
    pathname.startsWith("/devices/") ||
    pathname === "/time-tracking/devices" ||
    pathname.startsWith("/time-tracking/devices/")
  );
}

function parseHelpPath(pathname: string): { slug?: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "help" && parts[0] !== "help-center") return null;
  return { slug: parts[1] };
}

function parseV1ProjectRecord(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "crm" || parts[1] !== "project" || !parts[2] || parts[2] === "new") return null;
  return parts[2];
}

function parseLegacyProjectPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "project" || !parts[1]) return null;
  return parts[1];
}

function parseClientRecordPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "clients" && parts[1] && parts[1] !== "new" && parts.length === 2) return parts[1];
  if (parts[0] === "crm" && parts[1] === "client" && parts[2] && parts[2] !== "new") return parts[2];
  return null;
}

const DOCUMENT_LIBRARY_ACTIONS = new Set(["new", "new-folder", "upload", "access"]);

function parseWorkspaceDocumentPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "documents" && parts[1] && !DOCUMENT_LIBRARY_ACTIONS.has(parts[1]) && parts.length === 2) {
    return parts[1];
  }
  if (parts[0] === "company-documents" && parts[1] && (parts[2] === "edit" || parts[2] === "view")) {
    return parts[1];
  }
  return null;
}

function parseProjectDocumentPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "document" && parts[1]) return parts[1];
  return null;
}

function isScreencastsRewrite(pathname: string): boolean {
  return pathname === "/time-tracking/screencasts" || pathname.startsWith("/time-tracking/screencasts/");
}

function isTimeTrackingRewrite(pathname: string): boolean {
  if (pathname === "/time-tracking/devices" || pathname.startsWith("/time-tracking/devices/")) return false;
  if (isScreencastsRewrite(pathname)) return false;
  return pathname === "/time-tracking" || pathname.startsWith("/time-tracking/");
}

/** The v1 Time pages land on the v2 tab that does their job, not on the register. */
const V1_TIME_TAB: Record<string, TimeTabId> = {
  dashboard: "stats",
  stats: "stats",
  projects: "projects",
  tasks: "projects",
};

function timeTabForRewrite(pathname: string): TimeTabId {
  const parts = pathname.split("/").filter(Boolean);
  return V1_TIME_TAB[parts[1] ?? ""] ?? "entries";
}

function parseTimePath(pathname: string): TimeTabId | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "time") return null;
  if (parts.length === 1) return "entries";
  if (parts.length === 2 && TIME_TAB_SET.has(parts[1])) return parts[1] as TimeTabId;
  return null;
}

function parseActivityPath(pathname: string): ActivityTabId | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "activity") return null;
  if (parts.length === 1) return "register";
  if (parts.length === 2 && ACTIVITY_TAB_SET.has(parts[1])) return parts[1] as ActivityTabId;
  return null;
}

export function parseDossierPath(pathname: string): { projectId: string; tab: DossierTabId } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "projects" || parts.length < 2) return null;
  if (parts.length === 2) return { projectId: parts[1], tab: "overview" };
  if (parts.length === 3 && DOSSIER_TAB_SET.has(parts[2])) {
    return { projectId: parts[1], tab: parts[2] as DossierTabId };
  }
  return null;
}

export function matchV2Route(path: string): V2Match {
  const pathname = path.split("?")[0] || "/";
  if (pathname === "/auth") return { kind: "auth-redirect", title: "Today", href: "/" };
  if (pathname === "/") return { kind: "today", title: "Today", href: "/" };
  if (pathname === "/documents") {
    return { kind: "documents", title: "Workspace Documents", href: "/documents" };
  }
  if (pathname === "/company-documents") {
    return { kind: "documents", title: "Workspace Documents", href: "/documents" };
  }
  if (pathname.startsWith("/documents/")) {
    const action = pathname.split("/").filter(Boolean)[1];
    if (action && DOCUMENT_LIBRARY_ACTIONS.has(action)) {
      return { kind: "documents", title: "Workspace Documents", href: "/documents" };
    }
  }

  const workspaceDocumentId = parseWorkspaceDocumentPath(pathname);
  if (workspaceDocumentId) {
    return {
      kind: "document-editor",
      title: "Document",
      href: "/documents",
      documentId: workspaceDocumentId,
      source: "workspace",
    };
  }

  const projectDocumentId = parseProjectDocumentPath(pathname);
  if (projectDocumentId) {
    return {
      kind: "document-editor",
      title: "Document",
      href: "/project-documentation",
      documentId: projectDocumentId,
      source: "project",
    };
  }

  if (pathname === "/project-documentation" || pathname === "/documentation" || pathname.startsWith("/documentation/")) {
    return { kind: "project-documentation", title: "Project Documentation", href: "/project-documentation" };
  }

  if (pathname === "/opportunities") {
    return { kind: "opportunities", title: "Opportunities", href: "/opportunities" };
  }
  if (pathname.startsWith("/opportunities/")) {
    const opportunityId = pathname.split("/").filter(Boolean)[1];
    if (opportunityId) {
      return { kind: "opportunity-record", title: "Opportunity", href: "/opportunities", opportunityId };
    }
  }

  const timeTab = parseTimePath(pathname);
  if (timeTab) {
    return { kind: "time", title: "Time Tracking", href: timeTabHref(timeTab), tab: timeTab };
  }

  const activityTab = parseActivityPath(pathname);
  if (activityTab || isScreencastsRewrite(pathname)) {
    const tab = activityTab ?? "register";
    return { kind: "activity", title: "Activity", href: activityTabHref(tab), tab };
  }

  if (pathname === "/people") {
    return { kind: "people", title: "People", href: "/people" };
  }

  if (pathname.startsWith("/invitations/")) {
    return { kind: "invitation-accept", title: "Invitation", href: pathname };
  }

  if (pathname === "/daily-updates" || pathname === "/admin/daily-updates" || pathname.startsWith("/admin/daily-updates/")) {
    return { kind: "daily-updates", title: "Daily Updates", href: "/daily-updates" };
  }

  if (pathname === "/administration" || pathname === "/admin" || pathname.startsWith("/admin/")) {
    return { kind: "administration", title: "Administration", href: "/administration" };
  }

  if (isDevicesPath(pathname)) {
    return { kind: "devices", title: "Devices", href: "/devices" };
  }

  const help = parseHelpPath(pathname);
  if (help) {
    return help.slug
      ? { kind: "help", title: "Help Center", href: "/help", slug: help.slug }
      : { kind: "help", title: "Help Center", href: "/help" };
  }

  if (isTimeTrackingRewrite(pathname)) {
    const tab = timeTabForRewrite(pathname);
    return { kind: "time", title: "Time Tracking", href: timeTabHref(tab), tab };
  }

  if (pathname === "/daily-update" || pathname.startsWith("/daily-update/")) {
    return { kind: "daily-update", title: "Daily Update", href: "/daily-update" };
  }

  if (pathname === "/clients" || pathname === "/crm/client/new") {
    return { kind: "clients", title: "Clients", href: "/clients" };
  }

  const clientId = parseClientRecordPath(pathname);
  if (clientId) {
    return { kind: "client-record", title: "Client", href: "/clients", clientId };
  }

  if (pathname === "/projects" || pathname === "/crm" || pathname === "/crm/project/new") {
    return { kind: "projects", title: "Projects", href: "/projects" };
  }

  const projectId = parseV1ProjectRecord(pathname);
  if (projectId) {
    return {
      kind: "dossier",
      title: "Overview",
      href: "/projects",
      projectId,
      tab: "overview",
    };
  }

  const legacyProjectId = parseLegacyProjectPath(pathname);
  if (legacyProjectId) {
    return {
      kind: "legacy-project",
      title: "Projects",
      href: "/projects",
      legacyProjectId,
    };
  }

  const dossier = parseDossierPath(pathname);
  if (dossier) {
    return {
      kind: "dossier",
      title: dossier.tab === "overview" ? "Overview" : dossier.tab.replace(/^\w/, (ch) => ch.toUpperCase()),
      href: "/projects",
      projectId: dossier.projectId,
      tab: dossier.tab,
    };
  }

  return { kind: "placeholder", title: "Not in this batch", href: pathname };
}

export const V2_FOOTER_NAV: V2NavItem[] = [
  { id: "devices", label: "Devices", href: "/devices" },
  { id: "help", label: "Help Center", href: "/help" },
];

export function navIdForPath(path: string): V2NavId | null {
  const match = matchV2Route(path);
  if (match.kind === "today" || match.kind === "auth-redirect") return "today";
  if (match.kind === "documents") return "documents";
  if (match.kind === "project-documentation") return "project-documentation";
  if (match.kind === "document-editor") {
    return match.source === "project" ? "project-documentation" : "documents";
  }
  if (match.kind === "projects" || match.kind === "legacy-project") return "projects";
  if (match.kind === "clients" || match.kind === "client-record") return "clients";
  if (match.kind === "opportunities" || match.kind === "opportunity-record") return "opportunities";
  if (match.kind === "time") return "time";
  if (match.kind === "activity") return "activity";
  if (match.kind === "people") return "people";
  if (match.kind === "invitation-accept") return null;
  if (match.kind === "administration") return "administration";
  if (match.kind === "devices") return "devices";
  if (match.kind === "help") return "help";
  const item = [...V2_NAV.flatMap((section) => section.items), ...V2_FOOTER_NAV].find(
    (nav) => nav.href === match.href,
  );
  return item?.id ?? null;
}

export function breadcrumbFor(path: string, workspaceName: string): Array<{ label: string; href?: string }> {
  const match = matchV2Route(path);
  const workspace = workspaceName.toUpperCase();
  if (match.kind === "today" || match.kind === "auth-redirect") {
    return [
      { label: workspace, href: "/" },
      { label: "TODAY" },
    ];
  }
  if (match.kind === "dossier") {
    return [
      { label: workspace, href: "/" },
      { label: "PROJECTS", href: "/projects" },
      { label: match.tab.toUpperCase() },
    ];
  }
  if (match.kind === "projects" || match.kind === "legacy-project") {
    return [
      { label: workspace, href: "/" },
      { label: "PROJECTS" },
    ];
  }
  if (match.kind === "documents") {
    return [
      { label: workspace, href: "/" },
      { label: "WORKSPACE DOCUMENTS" },
    ];
  }
  if (match.kind === "project-documentation") {
    return [
      { label: workspace, href: "/" },
      { label: "PROJECT DOCUMENTATION" },
    ];
  }
  if (match.kind === "document-editor") {
    if (match.source === "project") {
      return [
        { label: workspace, href: "/" },
        { label: "PROJECT DOCUMENTATION", href: "/project-documentation" },
        { label: "DOCUMENT" },
      ];
    }
    return [
      { label: workspace, href: "/" },
      { label: "WORKSPACE DOCUMENTS", href: "/documents" },
      { label: "DOCUMENT" },
    ];
  }
  if (match.kind === "opportunities") {
    return [
      { label: workspace, href: "/" },
      { label: "OPPORTUNITIES" },
    ];
  }
  if (match.kind === "opportunity-record") {
    return [
      { label: workspace, href: "/" },
      { label: "OPPORTUNITIES", href: "/opportunities" },
      { label: "RECORD" },
    ];
  }
  if (match.kind === "time") {
    if (match.tab === "entries") {
      return [
        { label: workspace, href: "/" },
        { label: "TIME TRACKING" },
      ];
    }
    return [
      { label: workspace, href: "/" },
      { label: "TIME TRACKING", href: "/time" },
      { label: TIME_TAB_CRUMB[match.tab] },
    ];
  }
  if (match.kind === "activity") {
    if (match.tab === "register") {
      return [
        { label: workspace, href: "/" },
        { label: "ACTIVITY" },
      ];
    }
    return [
      { label: workspace, href: "/" },
      { label: "ACTIVITY", href: "/activity" },
      { label: "GALLERY" },
    ];
  }
  if (match.kind === "people") {
    return [
      { label: workspace, href: "/" },
      { label: "PEOPLE" },
    ];
  }
  if (match.kind === "administration") {
    return [
      { label: workspace, href: "/" },
      { label: "ADMINISTRATION" },
    ];
  }
  if (match.kind === "devices") {
    return [
      { label: workspace, href: "/" },
      { label: "DEVICES" },
    ];
  }
  if (match.kind === "help") {
    if (match.slug) {
      return [
        { label: workspace, href: "/" },
        { label: "HELP CENTER", href: "/help" },
        { label: match.slug.replace(/-/g, " ").toUpperCase() },
      ];
    }
    return [
      { label: workspace, href: "/" },
      { label: "HELP CENTER" },
    ];
  }
  if (match.kind === "daily-update") {
    return [
      { label: workspace, href: "/" },
      { label: "DAILY UPDATE" },
    ];
  }
  if (match.kind === "daily-updates") {
    return [
      { label: workspace, href: "/" },
      { label: "DAILY UPDATES" },
    ];
  }
  if (match.kind === "clients") {
    return [
      { label: workspace, href: "/" },
      { label: "CLIENTS" },
    ];
  }
  if (match.kind === "client-record") {
    return [
      { label: workspace, href: "/" },
      { label: "CLIENTS", href: "/clients" },
      { label: "RECORD" },
    ];
  }
  return [
    { label: workspace, href: "/" },
    { label: match.title.toUpperCase() },
  ];
}

export type TimerChipInput = {
  isRunning: boolean;
  isPaused: boolean;
  hasActiveEntry: boolean;
  displayDuration: number;
  projectLabel: string | null;
  taskLabel: string | null;
  workspaceLabel?: string | null;
};

export type TimerChipModel = {
  appearance: "running" | "paused" | "idle";
  holdsAmber: boolean;
  pagePrimary: "case-ink";
  clock: string;
  title: string;
  subtitle: string | null;
};

export function formatElapsedClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours, minutes, secs].map((part) => part.toString().padStart(2, "0")).join(":");
}

export function timerChipModel(input: TimerChipInput): TimerChipModel {
  const clock = formatElapsedClock(input.displayDuration);
  const workspaceLabel = input.workspaceLabel?.trim() || null;
  if (input.isRunning) {
    return {
      appearance: "running",
      holdsAmber: true,
      pagePrimary: "case-ink",
      clock,
      title: input.projectLabel ?? "Timer running",
      subtitle: workspaceLabel ?? input.taskLabel,
    };
  }
  if (input.isPaused || input.hasActiveEntry) {
    return {
      appearance: "paused",
      holdsAmber: false,
      pagePrimary: "case-ink",
      clock,
      title: "Timer paused",
      subtitle: workspaceLabel ?? input.taskLabel,
    };
  }
  return {
    appearance: "idle",
    holdsAmber: false,
    pagePrimary: "case-ink",
    clock,
    title: "No Timer running",
    subtitle: null,
  };
}

export function workspaceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || "WS";
}

export function workspaceRoleLabel(user: { role: string; owner: boolean }): string {
  if (user.owner) return "OWNER";
  if (user.role === "admin") return "ADMINISTRATOR";
  return "MEMBER";
}

export const RAIL_COLLAPSED_STORAGE_KEY = "docuflow.v2.railCollapsed";

export function readRailCollapsed(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === "true";
}

export function writeRailCollapsed(storage: Pick<Storage, "setItem">, collapsed: boolean): void {
  storage.setItem(RAIL_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
}

export function memberCountLabel(count: number): string {
  const noun = count === 1 ? "MEMBER" : "MEMBERS";
  return `WORKSPACE · ${count} ${noun}`;
}
