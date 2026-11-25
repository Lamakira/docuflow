import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { notify } from "./notify";
import { useAuth } from "@/hooks/useAuth";
import type { CrmProjectWithDetails, SafeUser, ScreenshotPolicy } from "@shared/schema";
import { canManageAdministration } from "./administration";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { filterProjectOptions, knownFilterId } from "./time";
import { ACTIVITY_TAB_IDS, activityTabHref, type ActivityTabId } from "./presentation";
import { useToday } from "./useToday";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect } from "./V2Select";
import { V2ProjectPicker } from "./V2ProjectPicker";
import { V2RegisterPager } from "./V2RegisterPager";
import { V2DateField } from "./V2DateField";
import { V2CaptureImage } from "./V2CaptureImage";
import { V2EmptyState, V2LoadFailed, V2RecordEmpty } from "./V2EmptyState";
import {
  activityEvidencePath,
  activityPaging,
  activityTabs,
  batchFailureCopy,
  clearActivityFacets,
  composeActivity,
  composeActivityGallery,
  captureCountCopy,
  evidenceDateLabel,
  evidenceDateRange,
  evidenceRangeProblem,
  hasActivityFacets,
  pickCapture,
  readActivityFilters,
  screenshotPath,
  stepViewer,
  trackingPolicyPath,
  writeActivityFilters,
  ACTIVITY_FILTERS_DEFAULT,
  EVIDENCE_DATE_MODES,
  widerEvidenceRange,
  type ActivityEvidenceInput,
  type ActivityFilters,
  type EvidenceDateMode,
  type GalleryTile,
  type TileActivity,
  type GalleryViewer,
} from "./activity";
import { ChevronDown, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SkeletonRegister, SkeletonSection, V2PageSkeleton } from "./V2Skeleton";

type ScreenshotsResponse = {
  data: ActivityEvidenceInput[];
  total?: number;
  limit?: number;
  offset?: number;
  lowActivityThresholdPercent?: number;
  counts?: { lowActivity: number; similar: number };
};
type TrackingPolicyResponse = { screenshotPolicy: ScreenshotPolicy };

const EXPAND_MOTION = motionForSurface("activity-evidence-expand").enterExit;

/** Saves one capture; `false` when it could not be read or saved. */
async function saveCapture(tile: GalleryTile): Promise<boolean> {
  try {
    const res = await fetch(tile.imageSrc, { credentials: "include" });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = tile.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** A refresh that fails keeps what is on screen and says so once. */
function useRefreshFailure(failed: boolean, message: string, id: string) {
  useEffect(() => {
    if (failed) notify.error(null, { fallback: message, id });
  }, [failed, message, id]);
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

/** The Projects the reader may see, on the Time tracker's own query. */
function useActivityProjects() {
  const query = useQuery<{ data: CrmProjectWithDetails[]; total?: number }>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: async () => {
      const res = await fetch("/api/crm/projects?pageSize=500", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Projects");
      return res.json();
    },
  });
  // Another screen on this key may have cached a refusal's body.
  const list = Array.isArray(query.data?.data) ? query.data.data : null;
  const failed = query.isError || (query.isSuccess && list === null);
  return {
    list,
    complete: list !== null && (query.data?.total ?? list.length) <= list.length,
    state: list ? ("ready" as const) : failed ? ("failed" as const) : ("loading" as const),
  };
}

function ActivityDestination({ tab }: { tab: ActivityTabId }) {
  const now = useToday();
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();
  const search = useSearch();
  const [, navigate] = useLocation();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Rows opened at least once: their image is read then, and kept while the row closes.
  const [openedRows, setOpenedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedCaptureId, setExpandedCaptureId] = useState<string | null>(null);
  // A viewer step across a page edge, waiting for the other page to arrive.
  const [pendingStep, setPendingStep] = useState<{ page: number; pick: "first" | "last" } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const ready = memberships !== undefined;
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const canReview = ready && canManageAdministration(current?.workspaceRole ?? "");

  const activityProjects = useActivityProjects();
  const asked = readActivityFilters(search);
  const usersUrl = asked.archived && canReview ? "/api/users?includeArchived=true" : "/api/users";
  const { data: users } = useQuery<SafeUser[]>({
    queryKey: ["/api/users", usersUrl],
    enabled: canReview,
    queryFn: async () => {
      const res = await fetch(usersUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Members");
      return res.json();
    },
  });
  const filters: ActivityFilters = {
    ...asked,
    project: knownFilterId(asked.project, activityProjects.complete ? activityProjects.list : null),
    member: canReview ? knownFilterId(asked.member, users ?? null) : "all",
    archived: canReview && asked.archived,
  };

  function setFilters(next: ActivityFilters, replace = false) {
    navigate(`${activityTabHref(tab)}${writeActivityFilters(search, next)}`, { replace });
  }

  // An old link (`crmProjectId`) moves to the names the address uses now.
  const legacy = new URLSearchParams(search).has("crmProjectId");
  useEffect(() => {
    if (legacy) setFilters(asked, true);
  }, [legacy]);

  const rangeProblem = evidenceRangeProblem(filters.range, filters);
  const rangeDates = useMemo(
    () => evidenceDateRange(filters.range, now, { day: filters.day, from: filters.from, to: filters.to }),
    [now, filters.range, filters.day, filters.from, filters.to],
  );

  const requestedUserId = canReview && filters.member !== "all" ? filters.member : null;
  const evidenceUrl = activityEvidencePath({
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: filters.project === "all" ? null : filters.project,
    userId: requestedUserId,
    limit: filters.pageSize,
    offset: (filters.page - 1) * filters.pageSize,
    lowActivity: filters.low,
    similar: filters.similar,
  });

  const ownerName = useWorkspaceOwnerName();
  const { data: policyResponse } = useQuery<TrackingPolicyResponse>({
    queryKey: ["/api/time-tracking/tracking-policy"],
    queryFn: async () => {
      const res = await fetch(trackingPolicyPath(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Tracking Policy");
      return res.json();
    },
  });

  // Every visit re-reads, and a page turn or a filter keeps the page before it on screen
  // until the next one arrives, instead of the skeleton.
  const {
    data: response,
    isLoading,
    isError,
    isPlaceholderData,
    refetch,
  } = useQuery<ScreenshotsResponse>({
    queryKey: ["/api/time-tracking/screenshots", evidenceUrl],
    enabled: ready && !rangeProblem,
    placeholderData: keepPreviousData,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch(evidenceUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Activity Evidence");
      return res.json();
    },
  });
  // A day or span still being chosen asks for nothing; what was read before it is not its answer.
  const data = rangeProblem ? undefined : response;
  useRefreshFailure(isError && Boolean(data), "Activity Evidence could not be refreshed.", "v2-activity-refresh-failed");
  const loadFailed = isError && !data && !rangeProblem;

  const rows = data?.data ?? [];
  const total = data?.total ?? rows.length;
  const paging = activityPaging({ page: filters.page, pageSize: filters.pageSize, total });
  const offset = data?.offset ?? 0;

  // A page past the end (a shared link, or captures deleted since) moves to the last one.
  useEffect(() => {
    if (!data || isPlaceholderData || total === 0 || filters.page <= paging.pageCount) return;
    setFilters({ ...filters, page: paging.pageCount }, true);
  }, [data, isPlaceholderData, total, filters.page, paging.pageCount]);

  // Cheap "ever recorded" probe, asked only when nothing matches: one piece of
  // Evidence the reader may see, in any period (#325).
  const probeEver = Boolean(data) && !isPlaceholderData && !isError && total === 0;
  const everUrl = activityEvidencePath({ limit: 1 });
  const { data: everResponse } = useQuery<ScreenshotsResponse>({
    queryKey: ["/api/time-tracking/screenshots", everUrl],
    enabled: probeEver,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch(everUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Activity Evidence");
      return res.json();
    },
  });
  const everRecorded = everResponse ? everResponse.data.length > 0 : null;

  const projectOptions = useMemo(() => filterProjectOptions(activityProjects.list ?? []), [activityProjects.list]);
  const facetsActive = filters.project !== "all" || filters.member !== "all" || filters.low || filters.similar;
  const facetLabels = [
    ...(filters.project !== "all"
      ? [`Project: ${projectOptions.find((option) => option.id === filters.project)?.label ?? "-"}`]
      : []),
    ...(filters.member !== "all" ? [`Member: ${memberName((users ?? []).find((member) => member.id === filters.member) ?? {})}`] : []),
    ...(filters.low ? ["Low activity"] : []),
    ...(filters.similar ? ["Similar"] : []),
  ];
  const page = composeActivity({
    now,
    currentUserId: user?.id ?? "",
    canReview,
    ownerName,
    requestedUserId,
    expandedId,
    policy: policyResponse?.screenshotPolicy ?? null,
    evidence: rows,
    facetsActive,
    facetLabels,
    everRecorded,
    range: filters.range,
  });

  const galleryInput = {
    now,
    currentUserId: user?.id ?? "",
    canReview,
    lowActivityOnly: filters.low,
    similarOnly: filters.similar,
    lowActivityThresholdPercent: data?.lowActivityThresholdPercent,
    counts: data?.counts,
    selectedIds,
    total,
    offset,
    evidence: rows,
    facetsActive,
    facetLabels,
    everRecorded,
    range: filters.range,
  };
  // The capture a page step lands on is read while rendering, so the viewer never closes in between.
  const landed =
    pendingStep && !isPlaceholderData && data && filters.page === pendingStep.page
      ? pickCapture(composeActivityGallery({ ...galleryInput, expandedId: null }).groups, pendingStep.pick)
      : null;
  const gallery = composeActivityGallery({ ...galleryInput, expandedId: landed ?? expandedCaptureId });

  useEffect(() => {
    if (!pendingStep || isPlaceholderData || !data || filters.page !== pendingStep.page) return;
    setExpandedCaptureId(landed);
    setPendingStep(null);
  }, [pendingStep, isPlaceholderData, data, filters.page, landed]);
  useEffect(() => {
    if (pendingStep && isError) setPendingStep(null);
  }, [pendingStep, isError]);

  const deleteCapture = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", screenshotPath(id)),
    onSuccess: (_result, id) => {
      const viewer = gallery.viewer;
      if (viewer && viewer.tile.id === id) setExpandedCaptureId(viewer.nextId ?? viewer.previousId ?? null);
      setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/screenshots"] });
      notify.success("Capture deleted");
    },
    onError: (error: Error) => {
      notify.error(error.message);
    },
  });

  const refusal = page.refusal;
  const tabs = activityTabs(tab);
  const carried = search ? `?${search}` : "";

  function onToggle(id: string) {
    setExpandedId((currentId) => (currentId === id ? null : id));
    setOpenedRows((opened) => (opened.has(id) ? opened : new Set(opened).add(id)));
  }

  // A selection only means anything against the captures on screen: when the
  // filters or the page underneath it change, the old ids are no longer what the User picked.
  useEffect(() => {
    setSelectedIds([]);
  }, [filters.range, filters.day, filters.from, filters.to, filters.project, filters.member, filters.low, filters.similar, filters.page, filters.pageSize, tab]);
  // A page step keeps the viewer open; a filter or tab change closes it.
  useEffect(() => {
    setExpandedCaptureId(null);
    setPendingStep(null);
  }, [filters.range, filters.day, filters.from, filters.to, filters.project, filters.member, filters.low, filters.similar, filters.pageSize, tab]);

  function onSelect(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((rowId) => rowId !== id) : [...current, id],
    );
  }

  function onSelectShown() {
    const shown = gallery.groups.flatMap((group) => group.tiles).map((tile) => tile.id);
    setSelectedIds((current) => (current.length === shown.length ? [] : shown));
  }

  const widerRange = widerEvidenceRange(filters.range);
  const onWiden = widerRange ? () => setFilters({ ...filters, range: widerRange, page: 1 }) : undefined;
  const onClearFilters = () => setFilters(clearActivityFacets(filters));

  async function onSave(tile: GalleryTile) {
    if (!(await saveCapture(tile))) notify.error(null, { fallback: "Could not download the capture" });
  }

  /**
   * Batch download saves each capture in turn. The BFF serves one capture per
   * request, so there is no archive endpoint to invent here. It goes on past a
   * failure and says so once at the end.
   */
  async function onBatchDownload() {
    const tiles = gallery.groups.flatMap((group) => group.tiles).filter((tile) => tile.selected);
    setDownloading(true);
    let failed = 0;
    try {
      for (const tile of tiles) {
        if (!(await saveCapture(tile))) failed += 1;
      }
    } finally {
      setDownloading(false);
    }
    const message = batchFailureCopy(failed, tiles.length);
    if (message) notify.error(null, { fallback: message });
  }

  const viewer = gallery.viewer;
  const stepping = pendingStep !== null;
  const stepTarget = (direction: "previous" | "next") =>
    viewer ? stepViewer(viewer, direction, { page: filters.page, pageCount: paging.pageCount }) : null;
  function onStep(direction: "previous" | "next") {
    if (stepping) return;
    const step = stepTarget(direction);
    if (!step) return;
    if ("openId" in step) {
      setExpandedCaptureId(step.openId);
      return;
    }
    setPendingStep(step);
    setFilters({ ...filters, page: step.page });
  }

  if (!ready || isLoading) {
    return (
      <V2PageSkeleton title="Activity" hasSubhead={false} testId="v2-activity" status="Loading Activity for this Workspace.">
        <SkeletonSection title="Tracking Policy" lines={3} />
        <SkeletonRegister
          className="df-activity-register df-activity-stream"
          heads={["When", "Project", "Task", "Who", "Source"]}
        />
      </V2PageSkeleton>
    );
  }

  const pager = (
    <V2RegisterPager
      paging={paging}
      ariaLabel="Captures pages"
      onPage={(next) => setFilters({ ...filters, page: next })}
      onPageSize={(pageSize) => setFilters({ ...filters, pageSize, page: 1 })}
    />
  );
  const showPager = !loadFailed && !rangeProblem && total > 0;
  const notice = loadFailed ? (
    <V2LoadFailed
      title="Activity Evidence could not be loaded"
      onRetry={() => refetch()}
      testId="v2-activity-load-failed"
    />
  ) : rangeProblem ? (
    <V2EmptyState
      icon="activity"
      title={rangeProblem}
      copy="Set the dates above to see captures."
      testId="v2-activity-range-problem"
    />
  ) : null;
  const countChip = loadFailed || rangeProblem || !data ? null : captureCountCopy(total);

  return (
    <div className="df-page" data-testid="v2-activity">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Activity</h1>
        </div>
        {countChip ? <span className="df-count-chip">{countChip}</span> : null}
      </header>

      <nav className="df-tabs" aria-label="Activity">
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={`${item.href}${carried}`}
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
          <dl className="df-policy-lineup">
            {page.policyLines.map((line) => (
              <div key={line.label} className="df-detail-pair">
                <dt>{line.label}</dt>
                <dd className="df-mono">{line.value}</dd>
              </div>
            ))}
          </dl>
          {page.policyFootnote ? (
            <p className="df-policy-hint df-activity-policy-note">{page.policyFootnote}</p>
          ) : null}
        </div>
      </section>

      <div className="df-filter-bar">
        <V2FilterSelect
          label="Date"
          ariaLabel="Date"
          value={filters.range}
          active={filters.range !== ACTIVITY_FILTERS_DEFAULT.range}
          onChange={(next) => setFilters({ ...filters, range: next as EvidenceDateMode, page: 1 })}
          options={EVIDENCE_DATE_MODES.map((option) => ({
            value: option,
            label: evidenceDateLabel(option),
          }))}
        />
        {filters.range === "day" ? (
          <span className="df-date-filter">
            <span className="df-meta">Day</span>
            <V2DateField
              value={filters.day}
              ariaLabel="Day"
              placeholder="Choose a day"
              testId="v2-activity-day"
              onChange={(day) => setFilters({ ...filters, day, page: 1 })}
            />
          </span>
        ) : null}
        {filters.range === "custom" ? (
          <>
            <span className="df-date-filter">
              <span className="df-meta">From</span>
              <V2DateField
                value={filters.from}
                ariaLabel="From"
                placeholder="Choose a day"
                max={filters.to || undefined}
                testId="v2-activity-from"
                onChange={(from) => setFilters({ ...filters, from, page: 1 })}
              />
            </span>
            <span className="df-date-filter">
              <span className="df-meta">To</span>
              <V2DateField
                value={filters.to}
                ariaLabel="To"
                placeholder="Choose a day"
                min={filters.from || undefined}
                testId="v2-activity-to"
                onChange={(to) => setFilters({ ...filters, to, page: 1 })}
              />
            </span>
          </>
        ) : null}
        <V2ProjectPicker
          variant="chip"
          label="Project"
          ariaLabel="Filter by Project"
          value={filters.project}
          valueLabel="All"
          active={filters.project !== "all"}
          onChange={(project) => setFilters({ ...filters, project, page: 1 })}
          options={[{ id: "all", label: "All", meta: null }, ...projectOptions]}
          state={activityProjects.state}
          testId="v2-activity-filter-project"
        />
        {canReview ? (
          <V2FilterSelect
            label="Member"
            ariaLabel="Filter by Member"
            value={filters.member}
            active={filters.member !== "all"}
            onChange={(member) => setFilters({ ...filters, member, page: 1 })}
            options={[
              { value: "all", label: "All" },
              ...(users ?? []).map((member) => ({ value: member.id, label: memberName(member) })),
            ]}
          />
        ) : null}
        <FilterCheck
          id="v2-activity-low"
          checked={filters.low}
          disabled={(data?.counts?.lowActivity ?? 0) === 0 && !filters.low}
          label={`Low activity (${data?.counts?.lowActivity ?? 0})`}
          onChange={(low) => setFilters({ ...filters, low, page: 1 })}
        />
        <FilterCheck
          id="v2-activity-similar"
          checked={filters.similar}
          disabled={(data?.counts?.similar ?? 0) === 0 && !filters.similar}
          label={`Similar (${data?.counts?.similar ?? 0})`}
          onChange={(similar) => setFilters({ ...filters, similar, page: 1 })}
        />
        {canReview ? (
          <FilterCheck
            id="v2-activity-archived"
            checked={filters.archived}
            label="Include archived members"
            onChange={(archived) => setFilters({ ...filters, archived, page: 1 })}
          />
        ) : null}
        {hasActivityFacets(filters) ? (
          <Button variant="outline" type="button" onClick={onClearFilters} className="df-btn" data-testid="v2-activity-clear">
            Clear filters
          </Button>
        ) : null}
      </div>

      {refusal ? <p className="df-refusal">{refusal}</p> : null}

      {tab === "register" ? (
      <section
        className="df-card df-activity-register df-activity-stream"
        data-testid="v2-activity-register"
        aria-busy={isPlaceholderData && !rangeProblem}
      >
        {layout.stackedRegister || notice || page.emptyState ? null : (
          <div className="df-register-head df-desktop-only">
            <span>When</span>
            <span>Project</span>
            <span>Task</span>
            <span>Who</span>
            <span>Source</span>
            <span />
          </div>
        )}
        {notice ? (
          notice
        ) : page.emptyState ? (
          <V2RecordEmpty
            model={page.emptyState}
            icon="activity"
            action={<SetUpAgentAction />}
            onClear={onClearFilters}
            onWiden={onWiden}
          />
        ) : (
          page.rows.map((row) => (
            <div key={row.id} className="df-activity-item">
              <button
                type="button"
                className="df-register-row df-activity-row"
                aria-expanded={row.expanded}
                aria-controls={`v2-activity-detail-${row.id}`}
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
                    <ChevronDown className="df-row-chevron" strokeWidth={1.6} aria-hidden />
                  </span>
                ) : (
                  <>
                    <span className="df-mono df-meta">{row.when}</span>
                    <span className="df-row-title">{row.project}</span>
                    <span className="df-time-task">{row.task}</span>
                    <span className="df-time-person">{row.who}</span>
                    <span className="df-mono df-meta">{row.source}</span>
                    <ChevronDown className="df-row-chevron" strokeWidth={1.6} aria-hidden />
                  </>
                )}
              </button>
              <div
                id={`v2-activity-detail-${row.id}`}
                className="df-activity-expand"
                data-open={row.expanded ? "true" : "false"}
                data-motion={EXPAND_MOTION}
              >
                <div className="df-activity-expand-inner">
                  <div className="df-activity-detail">
                    {openedRows.has(row.id) ? <V2CaptureImage src={row.imageSrc} alt="" lazy /> : null}
                    <div className="df-detail-pairs">
                      <div className="df-detail-pair">
                        <span>Project</span>
                        <span>{row.project}</span>
                      </div>
                      <div className="df-detail-pair">
                        <span>Task</span>
                        <span>{row.task}</span>
                      </div>
                      <div className="df-detail-pair">
                        <span>Source</span>
                        <span>{row.source}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        {showPager ? pager : null}
      </section>
      ) : (
        <ActivityGallery
          gallery={gallery}
          notice={notice}
          busy={isPlaceholderData && !rangeProblem}
          pager={showPager ? pager : null}
          downloading={downloading}
          stepping={stepping}
          canStep={{ previous: stepTarget("previous") !== null, next: stepTarget("next") !== null }}
          onSelect={onSelect}
          onSelectShown={onSelectShown}
          onBatchDownload={onBatchDownload}
          onOpen={(id) => setExpandedCaptureId(id)}
          onStep={onStep}
          onClose={() => {
            setExpandedCaptureId(null);
            setPendingStep(null);
          }}
          onSave={onSave}
          canDelete={gallery.canDelete}
          deleting={deleteCapture.isPending}
          onDelete={(tile) => deleteCapture.mutate(tile.id)}
          onClearFilters={onClearFilters}
          onWiden={onWiden}
        />
      )}
    </div>
  );
}

/** A narrowing filter drawn as a chip: the shadcn Checkbox with its label. */
function FilterCheck({
  id,
  checked,
  disabled,
  label,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="df-filter-chip df-gallery-filter" data-active={checked ? "true" : "false"}>
      <div className="df-checkbox-row" data-disabled={disabled ? "true" : "false"}>
        <Checkbox
          id={id}
          className="df-checkbox"
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onChange(next === true)}
        />
        <label htmlFor={id}>{label}</label>
      </div>
    </div>
  );
}

type ActivityGalleryProps = {
  gallery: ReturnType<typeof composeActivityGallery>;
  /** The failed or unreadable-range message that stands in for the captures. */
  notice: ReactNode;
  /** The next page is loading; the one on screen stays. */
  busy: boolean;
  pager: ReactNode;
  downloading: boolean;
  stepping: boolean;
  canStep: { previous: boolean; next: boolean };
  onSelect: (id: string) => void;
  onSelectShown: () => void;
  onBatchDownload: () => void;
  onOpen: (id: string) => void;
  onStep: (direction: "previous" | "next") => void;
  onClose: () => void;
  onSave: (tile: GalleryTile) => void;
  canDelete: boolean;
  deleting: boolean;
  onDelete: (tile: GalleryTile) => void;
  onClearFilters: () => void;
  onWiden?: () => void;
};

/**
 * The capture gallery v1 had: hour groups, a fixed thumbnail frame so nothing
 * reflows as images land, and a batch download of what the User selected.
 */
function ActivityGallery({
  gallery,
  notice,
  busy,
  pager,
  downloading,
  stepping,
  canStep,
  onSelect,
  onSelectShown,
  onBatchDownload,
  onOpen,
  onStep,
  onClose,
  onSave,
  canDelete,
  deleting,
  onDelete,
  onClearFilters,
  onWiden,
}: ActivityGalleryProps) {
  // The thumbnail that opened the viewer, so closing returns focus to it.
  const openerId = useRef<string | null>(null);
  return (
    <section className="df-card df-gallery" data-testid="v2-activity-gallery" aria-busy={busy}>
      {/* Nothing to count, select or download in an empty gallery. */}
      {notice || gallery.emptyState ? null : (
        <div className="df-card-head">
          <h2 className="df-card-title">{gallery.countCopy}</h2>
          {gallery.count > 0 ? (
            <span className="df-gallery-actions">
              <Button variant="outline" type="button" onClick={onSelectShown} className="df-btn">
                {gallery.selectedCount === gallery.count ? "Clear selection" : "Select this page"}
              </Button>
              {gallery.canBatch ? (
                <Button variant="default" type="button" disabled={downloading} onClick={onBatchDownload} className="df-btn">
                  <Download strokeWidth={1.6} aria-hidden />
                  {downloading ? "Downloading…" : gallery.batchLabel}
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      )}
      {notice ? (
        notice
      ) : gallery.emptyState ? (
        <V2RecordEmpty
          model={gallery.emptyState}
          icon="activity"
          action={<SetUpAgentAction />}
          onClear={onClearFilters}
          onWiden={onWiden}
        />
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
                    <V2CaptureImage src={tile.imageSrc} alt="" lazy />
                  </button>
                  <span className="df-gallery-meta">
                    <Checkbox
                      className="df-checkbox"
                      checked={tile.selected}
                      aria-label={`Select the capture from ${tile.when}`}
                      onCheckedChange={() => onSelect(tile.id)}
                    />
                    <span className="df-mono df-meta df-gallery-when" title={`${tile.when} · ${tile.who}`}>
                      {tile.when} · {tile.who}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          type="button"
                          onClick={() => onSave(tile)}
                          aria-label={`Download the capture from ${tile.when}`}
                          className="df-btn df-gallery-download"
                        >
                          <Download width={16} height={16} strokeWidth={1.6} aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="df-v2 df-tooltip">Download</TooltipContent>
                    </Tooltip>
                  </span>
                  <span className="df-gallery-provenance" title={`${tile.project} · ${tile.task}`}>{tile.project} · {tile.task}</span>
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
      <CaptureViewer
        viewer={gallery.viewer}
        stepping={stepping}
        canStep={canStep}
        onStep={onStep}
        onClose={onClose}
        onSave={onSave}
        canDelete={canDelete}
        deleting={deleting}
        onDelete={onDelete}
        openerId={openerId}
      />
      {pager}
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
  /** The neighbouring page is loading: Previous and Next wait for it. */
  stepping: boolean;
  canStep: { previous: boolean; next: boolean };
  onStep: (direction: "previous" | "next") => void;
  onClose: () => void;
  onSave: (tile: GalleryTile) => void;
  canDelete: boolean;
  deleting: boolean;
  onDelete: (tile: GalleryTile) => void;
  openerId: MutableRefObject<string | null>;
};

/**
 * One capture as large as the viewport allows (#332), on the shadcn Dialog.
 * Radix portals outside `.df-v2`, so the panel carries the class itself.
 */
function CaptureViewer({
  viewer,
  stepping,
  canStep,
  onStep,
  onClose,
  onSave,
  canDelete,
  deleting,
  onDelete,
  openerId,
}: CaptureViewerProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const previousEnabled = canStep.previous && !stepping;
  const nextEnabled = canStep.next && !stepping;
  // On the window, not the panel: stepping onto the last capture disables Next,
  // and the focus it held falls to the body, out of the panel's key events.
  useEffect(() => {
    if (!viewer || confirmingDelete) return;
    function onKey(event: KeyboardEvent) {
      const direction = event.key === "ArrowLeft" ? "previous" : event.key === "ArrowRight" ? "next" : null;
      if (!direction || (direction === "previous" ? !previousEnabled : !nextEnabled)) return;
      event.preventDefault();
      onStep(direction);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, onStep, confirmingDelete, previousEnabled, nextEnabled]);

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
          // The first control is Delete capture: the panel takes the focus, not it.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
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
            <V2CaptureImage src={viewer.tile.imageSrc} alt={`Capture from ${viewer.tile.when}`} />
          </div>
          <div className="df-capture-viewer-meta">
            <div className="df-detail-pair">
              <span>When</span>
              <span>{viewer.tile.when}</span>
            </div>
            <div className="df-detail-pair">
              <span>Who</span>
              <span>{viewer.tile.who}</span>
            </div>
            <div className="df-detail-pair">
              <span>Project</span>
              <span>{viewer.tile.project}</span>
            </div>
            <div className="df-detail-pair">
              <span>Task</span>
              <span>{viewer.tile.task}</span>
            </div>
            <div className="df-detail-pair">
              <span>Source</span>
              <span>{viewer.tile.source}</span>
            </div>
            <div className="df-detail-pair">
              <span>Activity</span>
              <span>
                {viewer.tile.activity.low ? "Low activity · " : ""}
                {viewer.tile.activity.label}
              </span>
            </div>
            {viewer.tile.similar ? (
              <div className="df-detail-pair">
                <span>Screen</span>
                <span>{viewer.tile.similarCopy}</span>
              </div>
            ) : null}
          </div>
          <DialogFooter className="df-capture-viewer-actions">
            {canDelete ? (
              <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructiveOutline"
                    className="df-btn"
                    disabled={deleting}
                    data-testid="v2-activity-capture-delete"
                  >
                    <Trash2 strokeWidth={1.6} aria-hidden />
                    Delete capture
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="df-v2 df-alert">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this capture</AlertDialogTitle>
                    <AlertDialogDescription>
                      {`The capture from ${viewer.tile.when} by ${viewer.tile.who} leaves Activity for everyone in this Workspace. This cannot be undone.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="df-btn" autoFocus>
                      Keep capture
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid="v2-activity-capture-delete-confirm"
                      onClick={() => onDelete(viewer.tile)}
                    >
                      <Trash2 strokeWidth={1.6} aria-hidden />
                      Delete capture
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <Button
              variant="outline"
              type="button"
              className="df-btn"
              disabled={!previousEnabled}
              onClick={() => onStep("previous")}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              type="button"
              className="df-btn"
              disabled={!nextEnabled}
              onClick={() => onStep("next")}
            >
              Next
            </Button>
            <Button variant="default" type="button" className="df-btn" onClick={() => onSave(viewer.tile)}>
              <Download strokeWidth={1.6} aria-hidden />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
