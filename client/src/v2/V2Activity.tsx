import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { CrmProjectWithDetails, SafeUser, ScreenshotPolicy, TimeEntryWithDetails } from "@shared/schema";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { timeEntriesPath, timePeriodLabel, timePeriodRange, TIME_PERIODS, type TimePeriod } from "./time";
import { ACTIVITY_TAB_IDS, type ActivityTabId } from "./presentation";
import { useV2Chrome } from "./V2Shell";
import {
  activityEvidencePath,
  activityTabs,
  composeActivity,
  composeActivityGallery,
  trackingPolicyPath,
  type ActivityEntryInput,
  type ActivityProjectInput,
  type GalleryEvidenceInput,
  type GalleryTile,
} from "./activity";

type ScreenshotsResponse = { data: GalleryEvidenceInput[] };
type TimeEntriesResponse = { data: TimeEntryWithDetails[] };
type TrackingPolicyResponse = { screenshotPolicy: ScreenshotPolicy };

const EXPAND_MOTION = motionForSurface("activity-evidence-expand").enterExit;
const GALLERY_FILTER_MOTION = motionForSurface("activity-gallery-filter").enterExit;

function toProject(project: CrmProjectWithDetails): ActivityProjectInput {
  return {
    id: project.id,
    project: project.project,
    client: project.client,
  };
}

async function saveCapture(tile: GalleryTile): Promise<void> {
  const res = await fetch(tile.imageSrc, { credentials: "include" });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = tile.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toEntry(entry: TimeEntryWithDetails): ActivityEntryInput {
  return {
    id: entry.id,
    taskId: entry.taskId,
    task: entry.task,
    description: entry.description,
  };
}

export function V2ActivityPage() {
  const params = useParams<{ tab?: string }>();
  const requested = params.tab ?? "register";
  const tab: ActivityTabId = (ACTIVITY_TAB_IDS as readonly string[]).includes(requested)
    ? (requested as ActivityTabId)
    : "register";
  return <ActivityDestination tab={tab} />;
}

function ActivityDestination({ tab }: { tab: ActivityTabId }) {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();

  // The same periods the Time stats offer, so a date filter means one thing (#214).
  const [range, setRange] = useState<TimePeriod>("today");
  const [projectFilter, setProjectFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lowActivityOnly, setLowActivityOnly] = useState(false);
  const [identicalOnly, setIdenticalOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const canReview = user?.role === "admin";

  const rangeDates = useMemo(() => timePeriodRange(range, now), [now, range]);

  const requestedUserId = canReview && userFilter !== "all" ? userFilter : null;
  const filters = {
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: projectFilter === "all" ? null : projectFilter,
    userId: requestedUserId,
  };
  const evidenceUrl = activityEvidencePath({ ...filters, limit: tab === "gallery" ? 100 : null });
  const entriesUrl = timeEntriesPath({
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: filters.crmProjectId,
    userId: filters.userId,
  });

  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const owner = users.find((member) => member.isMainAdmin === 1);
  const { data: projectsResponse } = useQuery<{ data: CrmProjectWithDetails[] }>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500").then((res) => res.json()),
  });
  const { data: policyResponse } = useQuery<TrackingPolicyResponse>({
    queryKey: ["/api/time-tracking/tracking-policy"],
    queryFn: async () => {
      const res = await fetch(trackingPolicyPath(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Tracking Policy");
      return res.json();
    },
  });
  const { data: evidenceResponse, isLoading, isError } = useQuery<ScreenshotsResponse>({
    queryKey: ["/api/time-tracking/screenshots", evidenceUrl],
    queryFn: async () => {
      const res = await fetch(evidenceUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Activity Evidence");
      return res.json();
    },
  });
  const { data: entriesResponse } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time-tracking/entries", entriesUrl],
    queryFn: async () => {
      const res = await fetch(entriesUrl, { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const page = composeActivity({
    now,
    workspaceName,
    currentUserId: user?.id ?? "",
    canReview,
    ownerName: owner ? memberName(owner) : null,
    requestedUserId,
    expandedId,
    policy: policyResponse?.screenshotPolicy ?? null,
    projects: (projectsResponse?.data ?? []).map(toProject),
    entries: (entriesResponse?.data ?? []).map(toEntry),
    users,
    evidence: evidenceResponse?.data ?? [],
  });

  const gallery = composeActivityGallery({
    now,
    currentUserId: user?.id ?? "",
    canReview,
    lowActivityOnly,
    identicalOnly,
    selectedIds,
    projects: (projectsResponse?.data ?? []).map(toProject),
    entries: (entriesResponse?.data ?? []).map(toEntry),
    users,
    evidence: evidenceResponse?.data ?? [],
  });

  const refusal = page.refusal;
  const tabs = activityTabs(tab);

  function onToggle(id: string) {
    setExpandedId((currentId) => (currentId === id ? null : id));
  }

  function onSelect(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((rowId) => rowId !== id) : [...current, id],
    );
  }

  function onSelectShown() {
    const shown = gallery.groups.flatMap((group) => group.tiles).map((tile) => tile.id);
    setSelectedIds((current) => (current.length === shown.length ? [] : shown));
  }

  function onClearFilters() {
    setRange("today");
    setProjectFilter("all");
    setUserFilter("all");
    setLowActivityOnly(false);
    setIdenticalOnly(false);
    setSelectedIds([]);
  }

  /**
   * Batch download saves each capture in turn. The BFF serves one capture per
   * request, so there is no archive endpoint to invent here.
   */
  async function onBatchDownload() {
    const tiles = gallery.groups.flatMap((group) => group.tiles).filter((tile) => tile.selected);
    setDownloading(true);
    try {
      for (const tile of tiles) {
        await saveCapture(tile);
      }
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="df-page" data-testid="v2-activity">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Activity</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="df-page" data-testid="v2-activity">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Activity</h1>
            <p className="df-subhead">{page.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Activity Evidence in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-activity">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Activity</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
        <span className="df-count-chip">
          {tab === "gallery" ? gallery.count : page.rows.length}
        </span>
      </header>

      <nav className="df-tabs" aria-label="Activity">
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="df-tab"
            data-active={item.active ? "true" : "false"}
            data-testid={`v2-activity-tab-${item.id}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <section className="df-card" data-testid="v2-activity-policy">
        <div className="df-card-head">
          <h2 className="df-card-title">Tracking Policy</h2>
        </div>
        <div className="df-activity-policy">
          {page.policyLines.map((line) => (
            <div key={line.label} className="df-kv">
              <span>{line.label}</span>
              <span className="df-mono">{line.value}</span>
            </div>
          ))}
        </div>
        <p className="df-empty" style={{ paddingTop: 0 }}>
          {page.policyFootnote}
        </p>
      </section>

      <div className="df-filter-bar">
        <label className="df-filter-chip" data-active={range === "today" ? "true" : "false"}>
          DATE
          <select value={range} aria-label="Date" onChange={(event) => setRange(event.target.value as TimePeriod)}>
            {TIME_PERIODS.map((option) => (
              <option key={option} value={option}>
                {timePeriodLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="df-filter-chip">
          PROJECT
          <select
            value={projectFilter}
            aria-label="Filter by Project"
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="all">All</option>
            {(projectsResponse?.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.project?.name || "Untitled Project"}
              </option>
            ))}
          </select>
        </label>
        {canReview ? (
          <label className="df-filter-chip">
            MEMBER
            <select
              value={userFilter}
              aria-label="Filter by Member"
              onChange={(event) => setUserFilter(event.target.value)}
            >
              <option value="all">All</option>
              {users.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberName(member)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {tab === "gallery" ? (
          <>
            <label className="df-filter-chip df-gallery-filter" data-active={lowActivityOnly ? "true" : "false"}>
              <input
                type="checkbox"
                checked={lowActivityOnly}
                onChange={(event) => {
                  setLowActivityOnly(event.target.checked);
                  setSelectedIds([]);
                }}
              />
              LOW ACTIVITY
            </label>
            <label className="df-filter-chip df-gallery-filter" data-active={identicalOnly ? "true" : "false"}>
              <input
                type="checkbox"
                checked={identicalOnly}
                disabled={gallery.identicalCount === 0}
                onChange={(event) => {
                  setIdenticalOnly(event.target.checked);
                  setSelectedIds([]);
                }}
              />
              IDENTICAL{gallery.identicalCount > 0 ? ` (${gallery.identicalCount})` : ""}
            </label>
            <button type="button" className="df-ghost-link" onClick={onClearFilters}>
              Clear filters
            </button>
          </>
        ) : null}
      </div>

      {refusal ? <p className="df-refusal">{refusal}</p> : null}

      {tab === "register" ? (
      <section className="df-card df-activity-register df-activity-stream" data-testid="v2-activity-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>WHEN</span>
            <span>PROJECT</span>
            <span>TASK</span>
            <span>WHO</span>
            <span>SOURCE</span>
            <span />
          </div>
        )}
        {page.empty ? (
          <p className="df-empty">{page.emptyCopy}</p>
        ) : (
          page.rows.map((row) => (
            <div key={row.id}>
              <button
                type="button"
                className="df-register-row df-activity-row"
                aria-expanded={row.expanded}
                data-testid={`v2-activity-row-${row.id}`}
                onClick={() => onToggle(row.id)}
              >
                {layout.stackedRegister ? (
                  <span className="df-project-mobile">
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="df-row-title">{row.project}</div>
                      <div className="df-mono df-meta">
                        {row.when} · {row.task} · {row.source}
                      </div>
                    </span>
                    <span className="df-mono df-meta">{row.who}</span>
                    <span className="df-ghost-link">{row.expanded ? "Close" : "Open"}</span>
                  </span>
                ) : (
                  <>
                    <span className="df-mono df-meta">{row.when}</span>
                    <span className="df-row-title">{row.project}</span>
                    <span className="df-mono df-meta">{row.task}</span>
                    <span>{row.who}</span>
                    <span className="df-mono df-meta">{row.source}</span>
                    <span className="df-ghost-link">{row.expanded ? "Close" : "Open"}</span>
                  </>
                )}
              </button>
              <div
                className="df-activity-expand"
                data-open={row.expanded ? "true" : "false"}
                data-motion={EXPAND_MOTION}
              >
                <div className="df-activity-expand-inner">
                  <div className="df-activity-detail">
                    <img src={row.imageSrc} alt="" />
                    <div className="df-kv">
                      <span>PROJECT</span>
                      <span>{row.project}</span>
                    </div>
                    <div className="df-kv">
                      <span>TASK</span>
                      <span>{row.task}</span>
                    </div>
                    <div className="df-kv">
                      <span>SOURCE</span>
                      <span>{row.source}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </section>
      ) : (
        <ActivityGallery
          gallery={gallery}
          downloading={downloading}
          onSelect={onSelect}
          onSelectShown={onSelectShown}
          onBatchDownload={onBatchDownload}
        />
      )}
    </div>
  );
}

type ActivityGalleryProps = {
  gallery: ReturnType<typeof composeActivityGallery>;
  downloading: boolean;
  onSelect: (id: string) => void;
  onSelectShown: () => void;
  onBatchDownload: () => void;
};

/**
 * The capture gallery v1 had: hour groups, a fixed thumbnail frame so nothing
 * reflows as images land, and a batch download of what the User selected.
 */
function ActivityGallery({
  gallery,
  downloading,
  onSelect,
  onSelectShown,
  onBatchDownload,
}: ActivityGalleryProps) {
  return (
    <section className="df-card df-gallery" data-testid="v2-activity-gallery">
      <div className="df-card-head">
        <h2 className="df-card-title">{gallery.countCopy}</h2>
        <span className="df-gallery-actions">
          <button type="button" className="df-ghost-link" onClick={onSelectShown}>
            {gallery.selectedCount === gallery.count && gallery.count > 0 ? "Clear selection" : "Select all"}
          </button>
          <button
            type="button"
            className="df-ink-btn"
            disabled={!gallery.canBatch || downloading}
            onClick={onBatchDownload}
          >
            {downloading ? "Downloading…" : gallery.batchLabel}
          </button>
        </span>
      </div>
      {gallery.empty ? (
        <p className="df-empty">{gallery.emptyCopy}</p>
      ) : (
        gallery.groups.map((group) => (
          <div key={group.key} className="df-gallery-group">
            <div className="df-register-head df-gallery-hour">
              <span>
                {group.dateLabel} · {group.hourLabel}
              </span>
            </div>
            <div className="df-gallery-grid" data-motion={GALLERY_FILTER_MOTION}>
              {group.tiles.map((tile) => (
                <label
                  key={tile.id}
                  className="df-gallery-tile"
                  data-selected={tile.selected ? "true" : "false"}
                  data-testid={`v2-activity-capture-${tile.id}`}
                >
                  <img src={tile.imageSrc} alt="" loading="lazy" />
                  <span className="df-gallery-meta">
                    <input
                      type="checkbox"
                      checked={tile.selected}
                      aria-label={`Select the capture from ${tile.when}`}
                      onChange={() => onSelect(tile.id)}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="df-mono df-meta">
                        {tile.when} · {tile.who}
                      </span>
                      <span className="df-gallery-provenance">
                        {tile.project} · {tile.task} · {tile.source}
                      </span>
                    </span>
                    {tile.identical ? <span className="df-mono df-meta">IDENTICAL</span> : null}
                    {tile.lowActivity ? <span className="df-mono df-meta">LOW ACTIVITY</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
