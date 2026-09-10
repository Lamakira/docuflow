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
  "documents",
  "files",
  "settings",
] as const;

export type DossierTabId = (typeof DOSSIER_TAB_IDS)[number];

const DOSSIER_TAB_SET = new Set<string>(DOSSIER_TAB_IDS);

export type V2Match =
  | { kind: "today"; title: "Today"; href: "/" }
  | { kind: "auth-redirect"; title: "Today"; href: "/" }
  | { kind: "projects"; title: "Projects"; href: "/projects" }
  | { kind: "legacy-project"; title: "Projects"; href: "/projects"; legacyProjectId: string }
  | { kind: "dossier"; title: string; href: "/projects"; projectId: string; tab: DossierTabId }
  | { kind: "documents"; title: "Workspace Documents"; href: "/documents" }
  | { kind: "clients"; title: "Clients"; href: "/clients" }
  | { kind: "client-record"; title: string; href: "/clients"; clientId: string }
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

const PLACEHOLDERS: Array<{ href: string; title: string; prefixes?: string[] }> = [
  { href: "/opportunities", title: "Opportunities" },
  { href: "/project-documentation", title: "Project Documentation" },
  { href: "/time", title: "Time Tracking" },
  { href: "/activity", title: "Activity" },
  { href: "/people", title: "People" },
  { href: "/administration", title: "Administration" },
  { href: "/help", title: "Help Center" },
  { href: "/devices", title: "Devices" },
];

const V1_TO_PLACEHOLDER: Array<{ test: (path: string) => boolean; href: string; title: string }> = [
  { test: (path) => path === "/company-documents" || path.startsWith("/company-documents/"), href: "/documents", title: "Workspace Documents" },
  { test: (path) => path === "/time-tracking/devices" || path.startsWith("/time-tracking/devices/"), href: "/devices", title: "Devices" },
  { test: (path) => path === "/devices" || path.startsWith("/devices/"), href: "/devices", title: "Devices" },
  { test: (path) => path === "/time-tracking" || path.startsWith("/time-tracking/"), href: "/time", title: "Time Tracking" },
  { test: (path) => path === "/admin" || path.startsWith("/admin/"), href: "/administration", title: "Administration" },
  { test: (path) => path === "/help-center" || path.startsWith("/help-center/"), href: "/help", title: "Help Center" },
  { test: (path) => path === "/documentation" || path.startsWith("/documentation/"), href: "/project-documentation", title: "Project Documentation" },
  { test: (path) => path === "/daily-update" || path.startsWith("/daily-update/"), href: "/daily-update", title: "Daily Update" },
  { test: (path) => path.startsWith("/document/"), href: "/documents", title: "Workspace Documents" },
];

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
  if (pathname.startsWith("/documents/")) {
    return { kind: "placeholder", title: "Document", href: "/documents" };
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

  for (const entry of PLACEHOLDERS) {
    if (pathname === entry.href) return { kind: "placeholder", title: entry.title, href: entry.href };
    if (entry.prefixes?.some((prefix) => pathname.startsWith(prefix))) {
      return { kind: "placeholder", title: entry.title, href: entry.href };
    }
  }

  for (const leak of V1_TO_PLACEHOLDER) {
    if (leak.test(pathname)) return { kind: "placeholder", title: leak.title, href: leak.href };
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
  if (match.kind === "projects" || match.kind === "legacy-project") return "projects";
  if (match.kind === "clients" || match.kind === "client-record") return "clients";
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
