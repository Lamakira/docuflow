import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { CrmProjectWithDetails } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { BellIcon, CloseIcon, SearchIcon, SparkleIcon } from "./icons";
import { V2TimerChip } from "./V2TimerChip";
import { composeSearch, selectCommandPanel, chromeRefusal, type SearchModel } from "./chrome";
import { motionForSurface } from "./motion";
import { type V2CommandPanel, breadcrumbFor } from "./presentation";
import { projectVisibleTo } from "./projects";
import { useV2Chrome } from "./V2Shell";

const SEARCH_MOTION = motionForSurface("search-overlay").enterExit;

type Panel = V2CommandPanel | null;

type V2CommandBarProps = {
  workspaceName: string;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  timerWorkspaceLabel?: string | null;
  onToast?: (message: string) => void;
};

export function V2CommandBar({
  workspaceName,
  panel,
  onPanel,
  timerWorkspaceLabel = null,
  onToast,
}: V2CommandBarProps) {
  const [location] = useLocation();
  const crumbs = breadcrumbFor(location, workspaceName);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: unread } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
  });
  const unreadCount = unread?.count ?? 0;

  return (
    <>
      <header className="df-command" data-testid="v2-command-bar">
        <nav className="df-crumb" style={{ display: "flex", alignItems: "center", gap: 7, color: "#59657A", whiteSpace: "nowrap" }}>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {index > 0 ? <span style={{ color: "#C3CAD4" }}>/</span> : null}
              {crumb.href ? (
                <Link href={crumb.href} style={{ color: "#59657A" }}>
                  {crumb.label}
                </Link>
              ) : (
                <span style={{ color: "#0F1524" }}>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        <button type="button" className="df-search" onClick={() => setSearchOpen(true)} data-testid="v2-search">
          <SearchIcon />
          <span style={{ flex: 1, textAlign: "left" }}>Search {workspaceName}</span>
          <span className="df-keycap">/</span>
        </button>

        <div style={{ flex: 1 }} />

        <V2TimerChip workspaceLabel={timerWorkspaceLabel} onToast={onToast} />

        <button
          type="button"
          className="df-ghost-btn"
          data-testid="v2-ask"
          onClick={() => onPanel(selectCommandPanel(panel, "ask"))}
        >
          <SparkleIcon />
          Ask DocuFlow
        </button>

        <button
          type="button"
          className="df-icon-btn"
          data-testid="v2-notifications"
          onClick={() => onPanel(selectCommandPanel(panel, "notifications"))}
          aria-label="Notifications"
        >
          <BellIcon />
          {unreadCount > 0 ? <span className="df-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
        </button>
      </header>

      {searchOpen ? <SearchOverlay workspaceName={workspaceName} onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

type WorkspaceDocumentSearch = {
  documents?: Array<{ id: string; name: string; access?: string | null; folder?: { name: string } | null }>;
  folders?: Array<{ id: string; name: string }>;
  filteredByAccess?: boolean;
  restrictedHidden?: number;
};

async function loadSearch(
  query: string,
  viewer: { userId: string; role: string | null },
): Promise<{ model: SearchModel; knowledgeRefusal: string | null }> {
  const q = encodeURIComponent(query.trim());
  const [searchRes, knowledgeRes, projectsRes] = await Promise.all([
    fetch(`/api/search?q=${q}`, { credentials: "include" }),
    fetch(`/api/company-documents/search?q=${q}`, { credentials: "include" }),
    fetch("/api/crm/projects?pageSize=500", { credentials: "include" }),
  ]);
  const searchBody = searchRes.ok ? await searchRes.json() : [];
  const knowledge: WorkspaceDocumentSearch = knowledgeRes.ok ? await knowledgeRes.json() : { documents: [], folders: [] };
  const hits = Array.isArray(searchBody) ? searchBody : (searchBody.results ?? []);
  const accessFromBody = !Array.isArray(searchBody) && searchBody.filteredByAccess === true;
  const accessFact =
    accessFromBody || knowledge.filteredByAccess === true
      ? {
          filteredByAccess: true as const,
          restrictedHidden:
            !Array.isArray(searchBody) && typeof searchBody.restrictedHidden === "number"
              ? searchBody.restrictedHidden
              : knowledge.restrictedHidden,
        }
      : undefined;
  const projects = projectsRes.ok
    ? (((await projectsRes.json()) as { data?: CrmProjectWithDetails[] }).data ?? [])
    : [];
  const assignedProjectNames = projects
    .filter((project) => {
      const memberIds = (project.members ?? [])
        .map((row) => row.userId || row.user?.id)
        .filter((id): id is string => Boolean(id));
      return projectVisibleTo({
        role: viewer.role,
        userId: viewer.userId,
        memberIds,
        assigneeId: project.assigneeId ?? project.assignee?.id ?? null,
      });
    })
    .map((project) => project.project?.name)
    .filter((name): name is string => Boolean(name));
  return {
    model: composeSearch({
      query,
      searchHits: hits,
      workspaceDocuments: (knowledge.documents ?? []).map((document) => ({
        id: document.id,
        name: document.name,
        access: document.access,
        folderName: document.folder?.name,
      })),
      folders: knowledge.folders ?? [],
      accessFact,
      assignedProjectNames,
    }),
    knowledgeRefusal:
      knowledgeRes.status === 401 || knowledgeRes.status === 403
        ? chromeRefusal({ kind: "capability", capability: "View Workspace Documents" })
        : null,
  };
}

export function SearchOverlay({ workspaceName, onClose }: { workspaceName: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();
  const { user } = useAuth();
  const { memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const { data, isFetching } = useQuery({
    queryKey: [
      "/api/search",
      trimmed,
      "v2-chrome",
      user?.id ?? "",
      current?.workspaceRole ?? "",
    ],
    queryFn: () =>
      loadSearch(trimmed, {
        userId: user?.id ?? "",
        role: current?.workspaceRole?.toLowerCase() || null,
      }),
    enabled: trimmed.length > 0,
  });
  const rows = data?.model.rows ?? [];
  const footer = data?.model.footer ?? null;
  const knowledgeRefusal = data?.knowledgeRefusal ?? null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <>
      <div className="df-overlay-scrim" data-motion={SEARCH_MOTION} onClick={onClose} />
      <div
        className="df-overlay"
        role="dialog"
        aria-label={`Search ${workspaceName}`}
        data-testid="v2-search-overlay"
        data-motion={SEARCH_MOTION}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid #D8DEE6" }}>
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${workspaceName}`}
            aria-label={`Search ${workspaceName}`}
            style={{
              flex: 1,
              border: 0,
              outline: "none",
              fontSize: 14,
              background: "transparent",
            }}
          />
          <button type="button" onClick={onClose} className="df-icon-btn" style={{ width: 28, height: 28 }} aria-label="Close search">
            <CloseIcon />
          </button>
        </div>
        <div className="df-search-hits">
          {knowledgeRefusal ? <p className="df-refusal">{knowledgeRefusal}</p> : null}
          {trimmed && !isFetching && rows.length === 0 && !knowledgeRefusal ? (
            <p style={{ padding: "14px", fontSize: 13.5, color: "#59657A" }}>No results in this Workspace.</p>
          ) : (
            rows.map((row) => (
              <Link key={row.id} href={row.href} onClick={onClose} className="df-search-row">
                <span className="df-mono" style={{ width: 74, flex: "none", fontSize: 10, color: "#59657A" }}>
                  {row.kind}
                </span>
                <span style={{ minWidth: 0, flex: 1, fontWeight: 500, fontSize: 13.5 }}>{row.title}</span>
                {row.meta ? (
                  <span className="df-mono" style={{ fontSize: 10.5, color: "#59657A" }}>
                    {row.meta}
                  </span>
                ) : null}
              </Link>
            ))
          )}
        </div>
        {footer ? <div className="df-search-foot">{footer}</div> : null}
      </div>
    </>
  );
}
