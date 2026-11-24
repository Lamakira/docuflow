import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { CrmClient, CrmProjectWithDetails } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { BellIcon, SearchIcon, SparkleIcon } from "./icons";
import { V2TimerChip } from "./V2TimerChip";
import { composeSearch, selectCommandPanel, chromeRefusal, type SearchModel } from "./chrome";
import {
  documentOwnerKey,
  documentQueryKey,
  isSaleDocumentOwner,
  loadDocument,
  loadDocumentOwner,
  type DocumentOwner,
  type LoadedDocument,
} from "./documentEditor";
import { motionForSurface } from "./motion";
import { type V2CommandPanel, type V2RecordRoot, breadcrumbFor, matchV2Route } from "./presentation";
import { projectVisibleTo } from "./projects";
import { useV2Chrome } from "./V2Shell";
import { Button } from "@/components/ui/button";

const SEARCH_MOTION = motionForSurface("search-overlay").enterExit;

type Panel = V2CommandPanel | null;

/**
 * Where the open record files when its path cannot say (F60, F61). Reads what
 * the record's page loaded; runs nothing itself.
 */
export function useRecordRoot(location: string): V2RecordRoot | null {
  const route = matchV2Route(location);
  const dossierId = route.kind === "dossier" ? route.projectId : "";
  const documentId = route.kind === "document-editor" && route.source === "project" ? route.documentId : "";
  const { data: project } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", dossierId],
    enabled: false,
  });
  const { data: document } = useQuery<LoadedDocument>({
    queryKey: documentQueryKey("project", documentId),
    queryFn: () => loadDocument("project", documentId),
    enabled: false,
  });
  const ownedProjectId = document?.record?.projectId ?? "";
  const { data: owner } = useQuery<DocumentOwner | null>({
    queryKey: documentOwnerKey(ownedProjectId),
    queryFn: () => loadDocumentOwner(ownedProjectId),
    enabled: false,
  });
  if (project?.isDocumentationOnly) return "project-documentation";
  return isSaleDocumentOwner(owner) ? "opportunities" : null;
}

type V2CommandBarProps = {
  workspaceName: string;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  timerWorkspaceLabel?: string | null;
};

export function V2CommandBar({
  workspaceName,
  panel,
  onPanel,
  timerWorkspaceLabel = null,
}: V2CommandBarProps) {
  const [location] = useLocation();
  // A record's crumb is its name. The record page fills these cache entries;
  // the bar only reads them (enabled: false) and re-renders when the data lands.
  const route = matchV2Route(location);
  const opportunityId = route.kind === "opportunity-record" ? route.opportunityId : "";
  const projectId = route.kind === "dossier" ? route.projectId : "";
  const clientId = route.kind === "client-record" ? route.clientId : "";
  const { data: opportunityRecord } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", opportunityId],
    enabled: false,
  });
  const { data: projectRecord } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", projectId],
    enabled: false,
  });
  const { data: clientRecord } = useQuery<CrmClient | null>({
    queryKey: ["/api/crm/clients", clientId],
    enabled: false,
  });
  const documentId = route.kind === "document-editor" && route.source === "workspace" ? route.documentId : "";
  const { data: documentRecord } = useQuery<LoadedDocument>({
    queryKey: documentQueryKey("workspace", documentId),
    // Never run from here, but an observer's options become its query's: the default
    // queryFn would answer the editor's own refetches with a URL that does not exist.
    queryFn: () => loadDocument("workspace", documentId),
    enabled: false,
  });
  const projectDocumentId = route.kind === "document-editor" && route.source === "project" ? route.documentId : "";
  const { data: projectDocumentRecord } = useQuery<LoadedDocument>({
    queryKey: documentQueryKey("project", projectDocumentId),
    queryFn: () => loadDocument("project", projectDocumentId),
    enabled: false,
  });
  const recordLabel =
    route.kind === "opportunity-record"
      ? opportunityRecord?.project?.name?.trim() || undefined
      : route.kind === "dossier"
        ? projectRecord?.project?.name?.trim() || undefined
        : route.kind === "client-record"
          ? clientRecord?.name?.trim() || undefined
          : route.kind === "document-editor"
            ? (documentRecord ?? projectDocumentRecord)?.record?.name?.trim() || undefined
            : undefined;
  const crumbs = breadcrumbFor(location, workspaceName, recordLabel, useRecordRoot(location));
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
        <nav className="df-crumb">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`}>
              {index > 0 ? <span style={{ color: "var(--df-placeholder)" }}>/</span> : null}
              {crumb.href ? (
                <Link href={crumb.href} style={{ color: "var(--df-archive-slate)" }}>
                  {crumb.label}
                </Link>
              ) : (
                <span style={{ color: "var(--df-case-ink)" }}>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        <button
          type="button"
          className="df-search"
          onClick={() => setSearchOpen(true)}
          aria-label={`Search ${workspaceName}`}
          data-testid="v2-search"
        >
          <SearchIcon />
          <span className="df-search-label">Search {workspaceName}</span>
          <span className="df-keycap">/</span>
        </button>

        <div style={{ flex: 1 }} />

        <V2TimerChip workspaceLabel={timerWorkspaceLabel} />

        <Button variant="outline" type="button" data-testid="v2-ask" onClick={() => onPanel(selectCommandPanel(panel, "ask"))} className="df-btn">
          <SparkleIcon />
          <span className="df-command-label">Ask DocuFlow</span>
        </Button>

        <Button variant="outline" size="icon" type="button" data-testid="v2-notifications" onClick={() => onPanel(selectCommandPanel(panel, "notifications"))} aria-label="Notifications" className="df-btn">
          <BellIcon />
          {unreadCount > 0 ? <span className="df-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
        </Button>
      </header>

      {searchOpen ? <SearchOverlay workspaceName={workspaceName} onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

type WorkspaceDocumentSearch = {
  documents?: Array<{
    id: string;
    name: string;
    access?: string | null;
    effectiveAccess?: string | null;
    folder?: { name: string } | null;
  }>;
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
        opportunityOwnerId: project.opportunityOwnerId ?? null,
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
        effectiveAccess: document.effectiveAccess,
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
  const [, navigate] = useLocation();
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

  return (
    <CommandDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      shouldFilter={false}
      overlayClassName="df-command-scrim"
      className="df-v2 df-command-palette"
      title={`Search ${workspaceName}`}
      data-testid="v2-search-overlay"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={`Search ${workspaceName}`}
        data-motion={SEARCH_MOTION}
      />
      <CommandList className="df-search-hits">
        {knowledgeRefusal ? <p className="df-refusal">{knowledgeRefusal}</p> : null}
        {!trimmed && !knowledgeRefusal ? (
          // Without this the palette is an input and nothing else, which on a
          // phone reads as a stray field rather than a surface waiting for a
          // query.
          <CommandEmpty>Type to search {workspaceName}.</CommandEmpty>
        ) : null}
        {trimmed && !isFetching && rows.length === 0 && !knowledgeRefusal ? (
          <CommandEmpty>No results in this Workspace.</CommandEmpty>
        ) : (
          rows.map((row) => (
            <CommandItem
              key={row.id}
              value={`${row.kind} ${row.title} ${row.id}`}
              className="df-search-row"
              onSelect={() => {
                onClose();
                navigate(row.href);
              }}
            >
              <span className="df-mono" style={{ width: 74, flex: "none", fontSize: 10, color: "var(--df-archive-slate)" }}>
                {row.kind}
              </span>
              <span style={{ minWidth: 0, flex: 1, fontWeight: 500, fontSize: 13.5 }}>{row.title}</span>
              {row.meta ? (
                <span className="df-mono" style={{ fontSize: 10.5, color: "var(--df-archive-slate)" }}>
                  {row.meta}
                </span>
              ) : null}
            </CommandItem>
          ))
        )}
      </CommandList>
      {footer ? <div className="df-search-foot">{footer}</div> : null}
    </CommandDialog>
  );
}
