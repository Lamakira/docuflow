import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { CrmProjectWithDetails, SafeUser, ScreenshotPolicy, TimeEntryWithDetails } from "@shared/schema";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { timeEntriesPath } from "./time";
import { ACTIVITY_TAB_IDS, type ActivityTabId } from "./presentation";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect } from "./V2Select";
import {
  activityEvidencePath,
  activityTabs,
  composeActivity,
  composeActivityGallery,
  evidenceDateLabel,
  evidenceDateRange,
  trackingPolicyPath,
  EVIDENCE_DATE_MODES,
  type EvidenceDateMode,
  type ActivityEntryInput,
  type ActivityProjectInput,
  type GalleryEvidenceInput,
  type GalleryTile,
} from "./activity";

type ScreenshotsResponse = { data: GalleryEvidenceInput[]; total?: number };
type TimeEntriesResponse = { data: TimeEntryWithDetails[] };
type TrackingPolicyResponse = { screenshotPolicy: ScreenshotPolicy };

const EXPAND_MOTION = motionForSurface("activity-evidence-expand").enterExit;
/** The BFF caps a screenshot page at 100; 50 keeps a page readable. */
const GALLERY_PAGE_SIZE = 50;

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

  // The periods the Time stats offer, plus v1's named day and span (#214).
  const [range, setRange] = useState<EvidenceDateMode>("today");
  const [typedDay, setTypedDay] = useState("");
  const [typedFrom, setTypedFrom] = useState("");
  const [typedTo, setTypedTo] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lowActivityOnly, setLowActivityOnly] = useState(false);
  const [identicalOnly, setIdenticalOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedCaptureId, setExpandedCaptureId] = useState<string | null>(null);
  const [galleryPage, setGalleryPage] = useState(1);
  const [includeArchivedUsers, setIncludeArchivedUsers] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const canReview = user?.role === "admin";

  const rangeDates = useMemo(
    () => evidenceDateRange(range, now, { day: typedDay, from: typedFrom, to: typedTo }),
    [now, range, typedDay, typedFrom, typedTo],
  );

  const requestedUserId = canReview && userFilter !== "all" ? userFilter : null;
  const filters = {
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: projectFilter === "all" ? null : projectFilter,
    userId: requestedUserId,
  };
  const evidenceUrl = activityEvidencePath(
    tab === "gallery"
      ? { ...filters, limit: GALLERY_PAGE_SIZE, offset: (galleryPage - 1) * GALLERY_PAGE_SIZE }
      : filters,
  );
  const entriesUrl = timeEntriesPath({
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: filters.crmProjectId,
    userId: filters.userId,
  });

  const usersUrl = includeArchivedUsers ? "/api/users?includeArchived=true" : "/api/users";
  const { data: users = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/users", usersUrl],
    queryFn: async () => {
      const res = await fetch(usersUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Members");
      return res.json();
    },
  });
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
    expandedId: expandedCaptureId,
    page: galleryPage,
    pageSize: GALLERY_PAGE_SIZE,
    total: evidenceResponse?.total ?? evidenceResponse?.data?.length ?? 0,
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

  // A selection only means anything against the captures on screen: when the
  // filters underneath it change, the old ids are no longer what the User picked.
  useEffect(() => {
    setSelectedIds([]);
    setExpandedCaptureId(null);
  }, [range, typedDay, typedFrom, typedTo, projectFilter, userFilter, lowActivityOnly, identicalOnly, galleryPage, tab]);

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
    setTypedDay("");
    setTypedFrom("");
    setTypedTo("");
    setProjectFilter("all");
    setUserFilter("all");
    setLowActivityOnly(false);
    setIdenticalOnly(false);
    setGalleryPage(1);
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
        <V2FilterSelect
          label="DATE"
          ariaLabel="Date"
          value={range}
          active={range === "today"}
          onChange={(next) => {
            setRange(next as EvidenceDateMode);
            setGalleryPage(1);
          }}
          options={EVIDENCE_DATE_MODES.map((option) => ({
            value: option,
            label: evidenceDateLabel(option),
          }))}
        />
        <V2FilterSelect
          label="PROJECT"
          ariaLabel="Filter by Project"
          value={projectFilter}
          onChange={setProjectFilter}
          options={[
            { value: "all", label: "All" },
            ...(projectsResponse?.data ?? []).map((project) => ({
              value: project.id,
              label: project.project?.name || "Untitled Project",
            })),
          ]}
        />
        {canReview ? (
          <V2FilterSelect
            label="MEMBER"
            ariaLabel="Filter by Member"
            value={userFilter}
            onChange={setUserFilter}
            options={[
              { value: "all", label: "All" },
              ...users.map((member) => ({ value: member.id, label: memberName(member) })),
            ]}
          />
        ) : null}
        {range === "day" ? (
          <label className="df-filter-chip">
            DAY
            <input
              type="date"
              value={typedDay}
              aria-label="Day"
              onChange={(event) => {
                setTypedDay(event.target.value);
                setGalleryPage(1);
              }}
            />
          </label>
        ) : null}
        {range === "custom" ? (
          <>
            <label className="df-filter-chip">
              FROM
              <input
                type="date"
                value={typedFrom}
                aria-label="From"
                onChange={(event) => {
                  setTypedFrom(event.target.value);
                  setGalleryPage(1);
                }}
              />
            </label>
            <label className="df-filter-chip">
              TO
              <input
                type="date"
                value={typedTo}
                aria-label="To"
                onChange={(event) => {
                  setTypedTo(event.target.value);
                  setGalleryPage(1);
                }}
              />
            </label>
          </>
        ) : null}
        {tab === "gallery" ? (
          <>
            <label className="df-filter-chip df-gallery-filter" data-active={lowActivityOnly ? "true" : "false"}>
              <input
                type="checkbox"
                checked={lowActivityOnly}
                onChange={(event) => {
                  setLowActivityOnly(event.target.checked);
                  setGalleryPage(1);
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
                  setGalleryPage(1);
                }}
              />
              IDENTICAL{gallery.identicalCount > 0 ? ` (${gallery.identicalCount})` : ""}
            </label>
            {canReview ? (
              <label className="df-filter-chip df-gallery-filter" data-active={includeArchivedUsers ? "true" : "false"}>
                <input
                  type="checkbox"
                  checked={includeArchivedUsers}
                  onChange={(event) => setIncludeArchivedUsers(event.target.checked)}
                />
                INCLUDE ARCHIVED MEMBERS
              </label>
            ) : null}
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
          onExpand={(id) => setExpandedCaptureId((current) => (current === id ? null : id))}
          onSave={saveCapture}
          onPage={(step) => setGalleryPage((current) => Math.max(1, current + step))}
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
  onExpand: (id: string) => void;
  onSave: (tile: GalleryTile) => void;
  onPage: (step: number) => void;
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
  onExpand,
  onSave,
  onPage,
}: ActivityGalleryProps) {
  const expanded = gallery.groups.flatMap((group) => group.tiles).find((tile) => tile.expanded) ?? null;
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
            <div className="df-gallery-grid">
              {group.tiles.map((tile) => (
                <div
                  key={tile.id}
                  className="df-gallery-tile"
                  data-selected={tile.selected ? "true" : "false"}
                  data-expanded={tile.expanded ? "true" : "false"}
                  data-testid={`v2-activity-capture-${tile.id}`}
                >
                  <button
                    type="button"
                    className="df-gallery-open"
                    aria-expanded={tile.expanded}
                    aria-label={`Open the capture from ${tile.when} at full size`}
                    onClick={() => onExpand(tile.id)}
                  >
                    <img src={tile.imageSrc} alt="" loading="lazy" />
                  </button>
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
                    {tile.identical ? <span className="df-status-word">Identical</span> : null}
                    <button type="button" className="df-ghost-link" onClick={() => onSave(tile)}>
                      Download
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      {expanded ? (
        <div className="df-gallery-full" data-testid="v2-activity-capture-full">
          <img src={expanded.imageSrc} alt="" />
          <div className="df-kv">
            <span>WHEN</span>
            <span>{expanded.when}</span>
          </div>
          <div className="df-kv">
            <span>PROJECT</span>
            <span>{expanded.project}</span>
          </div>
          <div className="df-kv">
            <span>TASK</span>
            <span>{expanded.task}</span>
          </div>
          <div className="df-kv">
            <span>SOURCE</span>
            <span>{expanded.source}</span>
          </div>
        </div>
      ) : null}
      {gallery.paging.pageCount > 1 ? (
        <div className="df-gallery-paging">
          <span className="df-mono df-meta">{gallery.paging.label}</span>
          <span className="df-gallery-actions">
            <button
              type="button"
              className="df-ghost-link"
              disabled={!gallery.paging.hasPrevious}
              onClick={() => onPage(-1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="df-ghost-link"
              disabled={!gallery.paging.hasNext}
              onClick={() => onPage(1)}
            >
              Next
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
