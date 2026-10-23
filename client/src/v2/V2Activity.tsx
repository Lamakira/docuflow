import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { CrmProjectWithDetails, SafeUser, ScreenshotPolicy, TimeEntryWithDetails } from "@shared/schema";
import { canManageAdministration } from "./administration";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { timeEntriesPath } from "./time";
import { ACTIVITY_TAB_IDS, type ActivityTabId } from "./presentation";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
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
  type TileActivity,
  type GalleryViewer,
} from "./activity";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { V2RecordEmpty } from "./V2EmptyState";
import { SkeletonRegister, SkeletonSection, V2PageSkeleton } from "./V2Skeleton";

type ScreenshotsResponse = {
  data: GalleryEvidenceInput[];
  total?: number;
  lowActivityThresholdPercent?: number;
  counts?: { lowActivity: number; similar: number };
};
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

/** The designed empty state's one action: Activity Evidence comes from the desktop agent. */
function SetUpAgentAction() {
  return (
    <Button asChild variant="outline" className="df-btn">
      <Link href="/devices">Set up the desktop agent</Link>
    </Button>
  );
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
  const [similarOnly, setSimilarOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedCaptureId, setExpandedCaptureId] = useState<string | null>(null);
  const [galleryPage, setGalleryPage] = useState(1);
  const [includeArchivedUsers, setIncludeArchivedUsers] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const canReview = canManageAdministration(current?.workspaceRole ?? "");

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
      ? {
          ...filters,
          limit: GALLERY_PAGE_SIZE,
          offset: (galleryPage - 1) * GALLERY_PAGE_SIZE,
          lowActivity: lowActivityOnly,
          similar: similarOnly,
        }
      : filters,
  );
  const entriesUrl = timeEntriesPath({
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: filters.crmProjectId,
    userId: filters.userId,
  });

  const ownerName = useWorkspaceOwnerName();
  const usersUrl = includeArchivedUsers ? "/api/users?includeArchived=true" : "/api/users";
  const { data: users = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/users", usersUrl],
    queryFn: async () => {
      const res = await fetch(usersUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Members");
      return res.json();
    },
  });
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

  // Cheap "ever recorded" probe, asked only when the stream is empty: one piece
  // of Evidence the reader may see, in any period (#325).
  const probeEver = !isLoading && !isError && (evidenceResponse?.data ?? []).length === 0;
  const everUrl = activityEvidencePath({ limit: 1 });
  const { data: everResponse } = useQuery<ScreenshotsResponse>({
    queryKey: ["/api/time-tracking/screenshots", everUrl],
    enabled: probeEver,
    queryFn: async () => {
      const res = await fetch(everUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Activity Evidence");
      return res.json();
    },
  });
  const everRecorded = everResponse ? everResponse.data.length > 0 : null;

  const page = composeActivity({
    now,
    workspaceName,
    currentUserId: user?.id ?? "",
    canReview,
    ownerName,
    requestedUserId,
    expandedId,
    policy: policyResponse?.screenshotPolicy ?? null,
    projects: (projectsResponse?.data ?? []).map(toProject),
    entries: (entriesResponse?.data ?? []).map(toEntry),
    users,
    evidence: evidenceResponse?.data ?? [],
    facetsActive: projectFilter !== "all" || userFilter !== "all",
    everRecorded,
  });

  const gallery = composeActivityGallery({
    now,
    currentUserId: user?.id ?? "",
    canReview,
    lowActivityOnly,
    similarOnly,
    lowActivityThresholdPercent: evidenceResponse?.lowActivityThresholdPercent,
    counts: evidenceResponse?.counts,
    selectedIds,
    expandedId: expandedCaptureId,
    page: galleryPage,
    pageSize: GALLERY_PAGE_SIZE,
    total: evidenceResponse?.total ?? evidenceResponse?.data?.length ?? 0,
    projects: (projectsResponse?.data ?? []).map(toProject),
    entries: (entriesResponse?.data ?? []).map(toEntry),
    users,
    evidence: evidenceResponse?.data ?? [],
    facetsActive: projectFilter !== "all" || userFilter !== "all",
    everRecorded,
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
  }, [range, typedDay, typedFrom, typedTo, projectFilter, userFilter, lowActivityOnly, similarOnly, galleryPage, tab]);

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
    setSimilarOnly(false);
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
      <V2PageSkeleton title="Activity" testId="v2-activity" status="Loading Activity for this Workspace.">
        <SkeletonSection title="Tracking Policy" lines={3} />
        <SkeletonRegister
          className="df-activity-register df-activity-stream"
          heads={["When", "Project", "Task", "Who", "Source"]}
        />
      </V2PageSkeleton>
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
        <p className="df-empty" data-edge="end">
          {page.policyFootnote}
        </p>
      </section>

      <div className="df-filter-bar">
        <V2FilterSelect
          label="Date"
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
          label="Project"
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
            label="Member"
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
            Day
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
              From
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
                disabled={gallery.lowActivityCount === 0 && !lowActivityOnly}
                onChange={(event) => {
                  setLowActivityOnly(event.target.checked);
                  setGalleryPage(1);
                }}
              />
              Low activity ({gallery.lowActivityCount})
            </label>
            <label className="df-filter-chip df-gallery-filter" data-active={similarOnly ? "true" : "false"}>
              <input
                type="checkbox"
                checked={similarOnly}
                disabled={gallery.similarCount === 0 && !similarOnly}
                onChange={(event) => {
                  setSimilarOnly(event.target.checked);
                  setGalleryPage(1);
                }}
              />
              Similar ({gallery.similarCount})
            </label>
            {canReview ? (
              <label className="df-filter-chip df-gallery-filter" data-active={includeArchivedUsers ? "true" : "false"}>
                <input
                  type="checkbox"
                  checked={includeArchivedUsers}
                  onChange={(event) => setIncludeArchivedUsers(event.target.checked)}
                />
                Include archived members
              </label>
            ) : null}
            <Button variant="outline" type="button" onClick={onClearFilters} className="df-btn">
              Clear filters
            </Button>
          </>
        ) : null}
      </div>

      {refusal ? <p className="df-refusal">{refusal}</p> : null}

      {tab === "register" ? (
      <section className="df-card df-activity-register df-activity-stream" data-testid="v2-activity-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>When</span>
            <span>Project</span>
            <span>Task</span>
            <span>Who</span>
            <span>Source</span>
            <span />
          </div>
        )}
        {page.emptyState ? (
          <V2RecordEmpty model={page.emptyState} icon="activity" action={<SetUpAgentAction />} onClear={onClearFilters} />
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
                      <span>Project</span>
                      <span>{row.project}</span>
                    </div>
                    <div className="df-kv">
                      <span>Task</span>
                      <span>{row.task}</span>
                    </div>
                    <div className="df-kv">
                      <span>Source</span>
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
          onOpen={(id) => setExpandedCaptureId(id)}
          onClose={() => setExpandedCaptureId(null)}
          onSave={saveCapture}
          onPage={(step) => setGalleryPage((current) => Math.max(1, current + step))}
          onClearFilters={onClearFilters}
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
  onOpen: (id: string) => void;
  onClose: () => void;
  onSave: (tile: GalleryTile) => void;
  onPage: (step: number) => void;
  onClearFilters: () => void;
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
  onOpen,
  onClose,
  onSave,
  onPage,
  onClearFilters,
}: ActivityGalleryProps) {
  // The thumbnail that opened the viewer, so closing returns focus to it.
  const openerId = useRef<string | null>(null);
  return (
    <section className="df-card df-gallery" data-testid="v2-activity-gallery">
      <div className="df-card-head">
        <h2 className="df-card-title">{gallery.countCopy}</h2>
        <span className="df-gallery-actions">
          <Button variant="outline" type="button" onClick={onSelectShown} className="df-btn">
            {gallery.selectedCount === gallery.count && gallery.count > 0 ? "Clear selection" : "Select all"}
          </Button>
          <Button variant="default" type="button" disabled={!gallery.canBatch || downloading} onClick={onBatchDownload} className="df-btn">
            {downloading ? "Downloading…" : gallery.batchLabel}
          </Button>
        </span>
      </div>
      {gallery.emptyState ? (
        <V2RecordEmpty model={gallery.emptyState} icon="activity" action={<SetUpAgentAction />} onClear={onClearFilters} />
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
                    aria-haspopup="dialog"
                    aria-expanded={tile.expanded}
                    data-capture-open={tile.id}
                    aria-label={`Open the capture from ${tile.when} at full size`}
                    onClick={() => {
                      openerId.current = tile.id;
                      onOpen(tile.id);
                    }}
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
                    <Button variant="outline" type="button" onClick={() => onSave(tile)} className="df-btn">
                      Download
                    </Button>
                  </span>
                  <span className="df-gallery-facts">
                    <ActivityFacts activity={tile.activity} />
                    {tile.similar ? <span className="df-gallery-similar">{tile.similarCopy}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <CaptureViewer viewer={gallery.viewer} onOpen={onOpen} onClose={onClose} onSave={onSave} openerId={openerId} />
      {gallery.paging.pageCount > 1 ? (
        <div className="df-gallery-paging">
          <span className="df-mono df-meta">{gallery.paging.label}</span>
          <span className="df-gallery-actions">
            <Button variant="outline" type="button" disabled={!gallery.paging.hasPrevious} onClick={() => onPage(-1)} className="df-btn">
              Previous
            </Button>
            <Button variant="outline" type="button" disabled={!gallery.paging.hasNext} onClick={() => onPage(1)} className="df-btn">
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The minute before a capture: two short bars and their figures, or the plain
 * words when the agent recorded nothing. Low activity is said in text; the
 * warning tone on the bars only backs the words up.
 */
function ActivityFacts({ activity }: { activity: TileActivity }) {
  if (!activity.hasData) {
    return <span className="df-gallery-noactivity df-meta">{activity.label}</span>;
  }
  return (
    <span className="df-activity-facts" data-low={activity.low ? "true" : "false"} title={activity.label}>
      {activity.low ? (
        <span className="df-status-word" data-tone="active">
          Low activity
        </span>
      ) : null}
      {(
        [
          ["Keyboard", activity.keyboardPercent],
          ["Mouse", activity.mousePercent],
        ] as const
      ).map(([name, percent]) => (
        <span key={name} className="df-activity-bar-row">
          <span className="df-meta">{name}</span>
          <span className="df-activity-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} />
          </span>
          <span className="df-activity-figure">{percent} %</span>
        </span>
      ))}
    </span>
  );
}

type CaptureViewerProps = {
  viewer: GalleryViewer | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onSave: (tile: GalleryTile) => void;
  openerId: MutableRefObject<string | null>;
};

/**
 * One capture as large as the viewport allows (#332), on the shadcn Dialog.
 * Radix portals outside `.df-v2`, so the panel carries the class itself.
 */
function CaptureViewer({ viewer, onOpen, onClose, onSave, openerId }: CaptureViewerProps) {
  // On the window, not the panel: stepping onto the last capture disables Next,
  // and the focus it held falls to the body, out of the panel's key events.
  useEffect(() => {
    if (!viewer) return;
    const { previousId, nextId } = viewer;
    function onKey(event: KeyboardEvent) {
      const target = event.key === "ArrowLeft" ? previousId : event.key === "ArrowRight" ? nextId : null;
      if (!target) return;
      event.preventDefault();
      onOpen(target);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, onOpen]);

  return (
    <Dialog
      open={viewer !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {viewer ? (
        <DialogContent
          className="df-v2 df-alert df-capture-viewer"
          data-testid="v2-activity-capture-viewer"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!openerId.current) return;
            const opener = document.querySelector<HTMLElement>(
              `[data-capture-open="${CSS.escape(openerId.current)}"]`,
            );
            opener?.focus();
          }}
        >
          <DialogHeader className="df-capture-viewer-head">
            <DialogTitle>Capture from {viewer.tile.when}</DialogTitle>
            <DialogDescription className="df-mono df-meta">{viewer.position}</DialogDescription>
          </DialogHeader>
          <div className="df-capture-viewer-frame">
            <img src={viewer.tile.imageSrc} alt={`Capture from ${viewer.tile.when}`} />
          </div>
          <div className="df-capture-viewer-meta">
            <div className="df-kv">
              <span>When</span>
              <span>{viewer.tile.when}</span>
            </div>
            <div className="df-kv">
              <span>Who</span>
              <span>{viewer.tile.who}</span>
            </div>
            <div className="df-kv">
              <span>Project</span>
              <span>{viewer.tile.project}</span>
            </div>
            <div className="df-kv">
              <span>Task</span>
              <span>{viewer.tile.task}</span>
            </div>
            <div className="df-kv">
              <span>Source</span>
              <span>{viewer.tile.source}</span>
            </div>
            <div className="df-kv">
              <span>Activity</span>
              <span>
                {viewer.tile.activity.low ? "Low activity · " : ""}
                {viewer.tile.activity.label}
              </span>
            </div>
            {viewer.tile.similar ? (
              <div className="df-kv">
                <span>Screen</span>
                <span>{viewer.tile.similarCopy}</span>
              </div>
            ) : null}
          </div>
          <DialogFooter className="df-capture-viewer-actions">
            <Button
              variant="outline"
              type="button"
              className="df-btn"
              disabled={viewer.previousId === null}
              onClick={() => viewer.previousId && onOpen(viewer.previousId)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              type="button"
              className="df-btn"
              disabled={viewer.nextId === null}
              onClick={() => viewer.nextId && onOpen(viewer.nextId)}
            >
              Next
            </Button>
            <Button variant="default" type="button" className="df-btn" onClick={() => onSave(viewer.tile)}>
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
