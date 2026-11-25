import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkeletonBar, SkeletonLines, SkeletonRows } from "./V2Skeleton";
import {
  ANALYTICS_RANGE_PRESETS,
  analyticsDevicesPath,
  analyticsPath,
  analyticsRange,
  analyticsRangeWords,
  analyticsRefusal,
  browserTimeZone,
  composeCaptures,
  composeDevices,
  composeFigureBand,
  composeHourly,
  composeHoursChart,
  composeRecordedTime,
  composeWarnings,
  customFromRange,
  DEVICE_ROWS,
  exportFilename,
  FIGURE_NOTE,
  limitRows,
  readAnalyticsFilters,
  RECORDED_ROWS,
  WARNING_ROWS,
  writeAnalyticsFilters,
  type AnalyticsAlertsInput,
  type AnalyticsCoverageInput,
  type AnalyticsDeviceInput,
  type AnalyticsFigure,
  type AnalyticsFilters,
  type AnalyticsProductivityInput,
  type AnalyticsRange,
  type AnalyticsRangeId,
  type AnalyticsScreenshotsInput,
  type AnalyticsTab,
} from "./analytics";
import { canManageAdministration } from "./administration";
import { notify } from "./notify";
import { useRefreshFailure } from "./useRefreshFailure";
import { useToday } from "./useToday";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect } from "./V2Select";
import { V2DateRangeField } from "./V2DateField";
import { V2CompactEmpty, V2EmptyState, V2LoadFailed } from "./V2EmptyState";
import { V2PageHead } from "./V2PageHead";
import { ChartCard, ChartSkeleton } from "./V2BackOfficeCharts";
import { CapturesByHour, HoursPerDayChart } from "./V2AnalyticsCharts";

/**
 * Reads behind the Administration gate, which Analytics shares (#281). A 403 is
 * that gate, so it becomes `null` and composes into the named refusal rather
 * than an empty surface.
 */
export async function readBehindAdministration<T>(path: string): Promise<T | null> {
  const res = await fetch(path, { credentials: "include" });
  if (res.status === 403) return null;
  if (!res.ok) throw new Error(`Failed to read ${path}`);
  return res.json();
}

/** One card's read: it loads, fails and refreshes alone (F97). */
type AnalyticsRead<T> = {
  data: T | undefined;
  state: "loading" | "failed" | "ready";
  /** A new Range is on its way; the figures on screen are the old ones. */
  refreshing: boolean;
  /** The Range the figures on screen were read for: the old one while a new one is on its way. */
  range: AnalyticsRange;
  /** The gate refused this read. */
  refused: boolean;
  retry: () => void;
};

function useAnalyticsRead<T>(path: string, enabled: boolean, noun: string, id: string, range: AnalyticsRange): AnalyticsRead<T> {
  const query = useQuery<T | null>({
    queryKey: [path],
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    queryFn: () => readBehindAdministration<T>(path),
  });
  const data = query.data ?? undefined;
  const settled = useRef(range);
  if (!query.isPlaceholderData) settled.current = range;
  useRefreshFailure(query.isError && Boolean(data), `${noun} could not be refreshed.`, `v2-analytics-${id}-refresh-failed`);
  const failed = query.isError && !data;
  return {
    data,
    state: failed ? "failed" : data === undefined ? "loading" : "ready",
    refreshing: query.isPlaceholderData,
    range: settled.current,
    refused: query.data === null,
    retry: () => {
      void query.refetch();
    },
  };
}

/** The CSV, saved under the server's filename; a refusal or an outage is never saved as a file. */
async function saveExport(path: string, range: AnalyticsRange): Promise<void> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.message === "string" ? body.message : "");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(res.headers.get("Content-Disposition"), range);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Analytics, its own destination on the rail (#281): the Range's figures, the
 * warnings, hours per day, recorded time, captures and Devices, for the
 * Workspace Roles Administration admits. The head and the Range never go away.
 */
export function V2AnalyticsPage() {
  const { layout, memberships } = useV2Chrome();
  const search = useSearch();
  const [, navigate] = useLocation();
  const today = useToday();
  const tz = useMemo(browserTimeZone, []);
  const ownerName = useWorkspaceOwnerName();
  const [exporting, setExporting] = useState(false);

  const known = memberships !== undefined;
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceRole = current?.workspaceRole ?? "MEMBER";
  const canManage = known && canManageAdministration(workspaceRole);

  const filters = readAnalyticsFilters(search);
  const range = useMemo(
    () => analyticsRange(filters.range, today, { from: filters.from, to: filters.to }),
    [filters.range, filters.from, filters.to, today],
  );
  function setFilters(next: AnalyticsFilters) {
    navigate(`/analytics${writeAnalyticsFilters(search, next)}`);
  }
  function onRangeChange(next: AnalyticsRangeId) {
    setFilters({
      ...filters,
      range: next,
      ...(next === "custom" ? customFromRange(range) : { from: "", to: "" }),
    });
  }

  const productivity = useAnalyticsRead<AnalyticsProductivityInput>(
    analyticsPath("productivity", range, tz),
    canManage,
    "Recorded time",
    "productivity",
    range,
  );
  const coverage = useAnalyticsRead<AnalyticsCoverageInput>(
    analyticsPath("coverage", range, tz),
    canManage,
    "Captures",
    "coverage",
    range,
  );
  const screenshots = useAnalyticsRead<AnalyticsScreenshotsInput>(
    analyticsPath("screenshots", range, tz),
    canManage,
    "Captures by hour",
    "screenshots",
    range,
  );
  const alerts = useAnalyticsRead<AnalyticsAlertsInput>(analyticsPath("alerts", range, tz), canManage, "Warnings", "alerts", range);
  const devices = useAnalyticsRead<AnalyticsDeviceInput[]>(analyticsDevicesPath(tz), canManage, "Devices", "devices", range);

  const refusal = known
    ? analyticsRefusal({
        workspaceRole,
        ownerName,
        refused: [productivity, coverage, screenshots, alerts, devices].some((read) => read.refused),
      })
    : null;

  // `/administration#alerts` and v1 links land here on the Warnings card.
  useEffect(() => {
    if (alerts.state === "loading") return;
    if (window.location.hash !== "#alerts") return;
    document.getElementById("alerts")?.scrollIntoView();
  }, [alerts.state]);

  async function exportCsv() {
    setExporting(true);
    try {
      await saveExport(analyticsPath("export", range, tz), range);
    } catch (error) {
      notify.error(error, { fallback: "The export could not be downloaded. Try again." });
    } finally {
      setExporting(false);
    }
  }

  const now = new Date();
  const actions =
    canManage && !refusal ? (
      <>
        <V2FilterSelect
          label="Range"
          ariaLabel="Analytics range"
          value={filters.range}
          options={ANALYTICS_RANGE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          onChange={(next) => onRangeChange(next as AnalyticsRangeId)}
          active={filters.range !== "7d"}
          testId="v2-analytics-range"
        />
        {filters.range === "custom" ? (
          <V2DateRangeField
            value={{ from: filters.from, to: filters.to }}
            onChange={(days) => setFilters({ ...filters, range: "custom", from: days.from, to: days.to })}
            ariaLabel="Custom range"
            testId="v2-analytics-custom-range"
          />
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="df-btn"
          disabled={exporting}
          aria-busy={exporting || undefined}
          onClick={exportCsv}
          data-testid="v2-analytics-export"
        >
          {exporting ? <Loader2 width={14} height={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          Export CSV
        </Button>
      </>
    ) : null;

  return (
    <div className="df-page" data-testid="v2-analytics">
      <V2PageHead title="Analytics" chip={refusal ? undefined : analyticsRangeWords(range, today)} actions={actions} />
      {refusal ? (
        <V2EmptyState icon="access" title="Analytics is not open to you" copy={refusal} testId="v2-analytics-refusal" />
      ) : (
        <>
          <FigureBandCard productivity={productivity} coverage={coverage} />
          <WarningsCard read={alerts} now={now} stacked={layout.stackedRegister} />
          <HoursCard read={productivity} />
          <RecordedTimeCard
            read={productivity}
            tab={filters.tab}
            onTab={(tab) => setFilters({ ...filters, tab })}
            stacked={layout.stackedRegister}
          />
          <CapturesCard read={coverage} hourly={screenshots} stacked={layout.stackedRegister} />
          <DevicesCard read={devices} now={now} stacked={layout.stackedRegister} />
        </>
      )}
    </div>
  );
}

/** A card of the page: dimmed while a new Range's figures arrive, with its layout untouched. */
function AnalyticsCard({
  title,
  sub,
  testId,
  id,
  refreshing = false,
  children,
}: {
  title?: string;
  sub?: string;
  testId: string;
  id?: string;
  refreshing?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="df-card df-analytics-register"
      data-testid={testId}
      data-refreshing={refreshing ? "true" : undefined}
      aria-busy={refreshing || undefined}
      aria-label={title ? undefined : "Totals"}
    >
      {title ? (
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">{title}</h2>
            {sub ? <p className="df-card-sub">{sub}</p> : null}
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

function FigureSkeleton({ tiles }: { tiles: number }) {
  return (
    <div className="df-figure-band" data-figures={tiles} aria-hidden="true">
      {Array.from({ length: tiles }, (_, index) => (
        <div key={index} className="df-analytics-figure">
          <SkeletonBar width="short" />
          <SkeletonBar role="value" />
        </div>
      ))}
    </div>
  );
}

function FigureBandCard({
  productivity,
  coverage,
}: {
  productivity: AnalyticsRead<AnalyticsProductivityInput>;
  coverage: AnalyticsRead<AnalyticsCoverageInput>;
}) {
  const loading = productivity.state === "loading" || coverage.state === "loading";
  return (
    <AnalyticsCard testId="v2-analytics-overview-card" refreshing={productivity.refreshing || coverage.refreshing}>
      {loading ? (
        <FigureSkeleton tiles={5} />
      ) : (
        <FigureBand figures={composeFigureBand(productivity.data, coverage.data)} testId="v2-analytics-overview" />
      )}
      <p className="df-note">{FIGURE_NOTE}</p>
    </AnalyticsCard>
  );
}

function WarningsCard({
  read,
  now,
  stacked,
}: {
  read: AnalyticsRead<AnalyticsAlertsInput>;
  now: Date;
  stacked: boolean;
}) {
  const warnings = read.data ? composeWarnings(read.data, now) : null;
  return (
    <AnalyticsCard title="Warnings" id="alerts" testId="v2-analytics-alerts" refreshing={read.refreshing}>
      {read.state === "loading" ? (
        <SkeletonRows columns={3} rows={3} dataColumns />
      ) : read.state === "failed" || !warnings ? (
        <V2LoadFailed title="Warnings could not be loaded" onRetry={read.retry} testId="v2-analytics-alerts-failed" />
      ) : warnings.empty ? (
        <V2CompactEmpty>No warnings</V2CompactEmpty>
      ) : (
        <>
          {warnings.stalledDevices.length > 0 ? (
            <>
              <p className="df-analytics-group-label">Stalled Devices</p>
              <LimitedRegister
                stacked={stacked}
                limit={WARNING_ROWS}
                head={["Device", "Member", "Last seen"]}
                rows={warnings.stalledDevices.map((row) => ({ id: row.id, cells: [row.name, row.who, row.lastSeen] }))}
                testId="v2-analytics-alert-device"
              />
            </>
          ) : null}
          {warnings.mostlyIdle.length > 0 ? (
            <>
              <p className="df-analytics-group-label">Mostly idle</p>
              <LimitedRegister
                stacked={stacked}
                limit={WARNING_ROWS}
                numeric
                head={["Member", "Tracked", "Idle %"]}
                rows={warnings.mostlyIdle.map((row) => ({ id: row.id, cells: [row.who, row.tracked, row.idle] }))}
                testId="v2-analytics-alert-idle"
              />
            </>
          ) : null}
          {warnings.runningWithoutCaptures.length > 0 ? (
            <>
              <p className="df-analytics-group-label">Running without captures</p>
              <LimitedRegister
                stacked={stacked}
                limit={WARNING_ROWS}
                head={["Member", "Started"]}
                rows={warnings.runningWithoutCaptures.map((row) => ({ id: row.id, cells: [row.who, row.started] }))}
                testId="v2-analytics-alert-running"
              />
            </>
          ) : null}
        </>
      )}
    </AnalyticsCard>
  );
}

function HoursCard({ read }: { read: AnalyticsRead<AnalyticsProductivityInput> }) {
  const chart = useMemo(
    () => (read.data ? composeHoursChart(read.data.dailyTrend, read.range) : null),
    [read.data, read.range],
  );
  // Recorded time says it for both.
  if (chart?.empty && read.state === "ready") return null;
  if (!chart || read.state !== "ready") {
    return (
      <AnalyticsCard title="Hours per day" testId="v2-analytics-hours-card">
        {read.state === "failed" ? (
          <V2LoadFailed title="Hours per day could not be loaded" onRetry={read.retry} testId="v2-analytics-hours-failed" />
        ) : (
          <div className="df-chart-body">
            <ChartSkeleton />
          </div>
        )}
      </AnalyticsCard>
    );
  }
  return (
    <div data-refreshing={read.refreshing ? "true" : undefined} aria-busy={read.refreshing || undefined}>
      <ChartCard title={chart.grain === "week" ? "Hours per week" : "Hours per day"} table={chart.table} testId="v2-analytics-hours">
        <HoursPerDayChart chart={chart} />
      </ChartCard>
    </div>
  );
}

const TAB_LABEL: Record<AnalyticsTab, string> = { members: "Members", projects: "Projects", tasks: "Tasks" };

/** Only the name is a link; a client or a project sits beneath it in muted text. */
function NameCell({ href, name, below, testId }: { href: string | null; name: string; below?: string | null; testId: string }) {
  const label = href ? (
    <Link href={href} className="df-row-link df-analytics-link" data-testid={testId}>
      {name}
    </Link>
  ) : (
    name
  );
  if (!below) return <>{label}</>;
  return (
    <span className="df-analytics-name">
      <span>{label}</span>
      <span className="df-meta">{below}</span>
    </span>
  );
}

function RecordedTimeCard({
  read,
  tab,
  onTab,
  stacked,
}: {
  read: AnalyticsRead<AnalyticsProductivityInput>;
  tab: AnalyticsTab;
  onTab: (tab: AnalyticsTab) => void;
  stacked: boolean;
}) {
  const recorded = read.data ? composeRecordedTime(read.data) : null;
  const title = "Recorded time";
  if (!recorded || read.state !== "ready") {
    return (
      <AnalyticsCard title={title} testId="v2-analytics-recorded-time">
        {read.state === "failed" ? (
          <V2LoadFailed title="Recorded time could not be loaded" onRetry={read.retry} testId="v2-analytics-recorded-time-failed" />
        ) : (
          <SkeletonLines count={5} />
        )}
      </AnalyticsCard>
    );
  }
  return (
    <AnalyticsCard title={title} testId="v2-analytics-recorded-time" refreshing={read.refreshing}>
      {recorded.empty ? (
        <V2CompactEmpty>No tracked time in this range</V2CompactEmpty>
      ) : (
        <Tabs value={tab} onValueChange={(next) => onTab(next as AnalyticsTab)} activationMode="manual">
          <div className="df-analytics-tabs">
            <TabsList className="df-tabs" aria-label="Recorded time by">
              {(Object.keys(TAB_LABEL) as AnalyticsTab[]).map((id) => (
                <TabsTrigger key={id} value={id} className="df-tab" data-testid={`v2-analytics-tab-${id}`}>
                  {TAB_LABEL[id]}
                  <span className="df-tab-count">{recorded.counts[id]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="members" data-testid="v2-analytics-panel-members">
            <LimitedRegister
              stacked={stacked}
              limit={RECORDED_ROWS}
              numeric
              head={["Member", "Tracked", "Idle", "Time Entries"]}
              rows={recorded.members.map((row) => ({
                id: row.id,
                cells: [
                  <NameCell key="n" href={row.href} name={row.name} testId={`v2-analytics-member-link-${row.id}`} />,
                  row.tracked,
                  row.idle,
                  row.entries,
                ],
              }))}
              testId="v2-analytics-recorded-time-member"
            />
          </TabsContent>
          <TabsContent value="projects" data-testid="v2-analytics-panel-projects">
            <LimitedRegister
              stacked={stacked}
              limit={RECORDED_ROWS}
              numeric
              head={["Project", "Tracked", "Time Entries"]}
              rows={recorded.projects.map((row) => ({
                id: row.id,
                cells: [
                  <NameCell key="n" href={row.href} name={row.name} below={row.client} testId={`v2-analytics-project-link-${row.id}`} />,
                  row.tracked,
                  row.entries,
                ],
              }))}
              testId="v2-analytics-recorded-time-project"
            />
          </TabsContent>
          <TabsContent value="tasks" data-testid="v2-analytics-panel-tasks">
            <LimitedRegister
              stacked={stacked}
              limit={RECORDED_ROWS}
              numeric
              head={["Task", "Tracked"]}
              rows={recorded.tasks.map((row) => ({
                id: row.id,
                cells: [
                  <NameCell
                    key="n"
                    href={row.href}
                    name={row.name}
                    below={[row.project, row.client].filter(Boolean).join(" · ") || null}
                    testId={`v2-analytics-task-link-${row.id}`}
                  />,
                  row.tracked,
                ],
              }))}
              testId="v2-analytics-recorded-time-task"
            />
          </TabsContent>
        </Tabs>
      )}
    </AnalyticsCard>
  );
}

function CapturesCard({
  read,
  hourly,
  stacked,
}: {
  read: AnalyticsRead<AnalyticsCoverageInput>;
  hourly: AnalyticsRead<AnalyticsScreenshotsInput>;
  stacked: boolean;
}) {
  const title = "Captures";
  const captures = read.data ? composeCaptures(read.data, read.range) : null;
  if (!captures || read.state !== "ready") {
    return (
      <AnalyticsCard title={title} testId="v2-analytics-captures">
        {read.state === "failed" ? (
          <V2LoadFailed title="Captures could not be loaded" onRetry={read.retry} testId="v2-analytics-captures-failed" />
        ) : (
          <>
            <FigureSkeleton tiles={4} />
            <SkeletonRows columns={4} rows={3} dataColumns />
          </>
        )}
      </AnalyticsCard>
    );
  }
  const hours = hourly.data ? composeHourly(hourly.data) : null;
  return (
    <AnalyticsCard
      title={title}
      sub={captures.line}
      testId="v2-analytics-captures"
      refreshing={read.refreshing || hourly.refreshing}
    >
      {captures.empty ? (
        <V2CompactEmpty>No captures in this range</V2CompactEmpty>
      ) : (
        <>
          <FigureBand figures={captures.figures} testId="v2-analytics-captures-figures" />
          <AnalyticsRegister
            stacked={stacked}
            numeric
            head={["Member", "Tracked", "Taken of expected", "Coverage"]}
            rows={captures.rows.map((row) => ({
              id: row.id,
              cells: [
                <NameCell key="n" href={row.href} name={row.name} testId={`v2-analytics-capture-link-${row.id}`} />,
                row.tracked,
                row.captures,
                row.coverage,
              ],
            }))}
            empty={false}
            emptyCopy=""
            testId="v2-analytics-capture-row"
          />
        </>
      )}
      {captures.noneTaken ? null : hourly.state === "failed" ? (
        <V2LoadFailed title="Captures by hour could not be loaded" onRetry={hourly.retry} testId="v2-analytics-hourly-failed" />
      ) : hours && hourly.state === "ready" ? (
        <CapturesByHour hourly={hours} />
      ) : (
        <div className="df-chart-body">
          <ChartSkeleton />
        </div>
      )}
    </AnalyticsCard>
  );
}

function DevicesCard({
  read,
  now,
  stacked,
}: {
  read: AnalyticsRead<AnalyticsDeviceInput[]>;
  now: Date;
  stacked: boolean;
}) {
  const rows = read.data ? composeDevices(read.data, now) : null;
  return (
    <AnalyticsCard title="Devices" testId="v2-analytics-devices">
      {read.state === "loading" ? (
        <SkeletonRows columns={5} rows={3} dataColumns />
      ) : read.state === "failed" || !rows ? (
        <V2LoadFailed title="Devices could not be loaded" onRetry={read.retry} testId="v2-analytics-devices-failed" />
      ) : rows.length === 0 ? (
        <V2CompactEmpty>No Devices in this Workspace</V2CompactEmpty>
      ) : (
        <LimitedRegister
          stacked={stacked}
          limit={DEVICE_ROWS}
          head={["Device", "Member", "Platform", "Last seen", "Status"]}
          rows={rows.map((row) => ({
            id: row.id,
            cells: [row.name, row.who, row.platform, row.lastSeen, row.status],
          }))}
          testId="v2-analytics-device"
        />
      )}
    </AnalyticsCard>
  );
}

export function FigureBand({ figures, testId }: { figures: AnalyticsFigure[]; testId: string }) {
  if (figures.length === 0) return null;
  return (
    <div className="df-figure-band" data-figures={figures.length} data-testid={testId}>
      {figures.map((figure) => (
        <div key={figure.label} className="df-analytics-figure">
          <span className="df-analytics-figure-label">{figure.label}</span>
          <span className="df-analytics-figure-value">{figure.value}</span>
        </div>
      ))}
    </div>
  );
}

/** The first rows of a register and the one button that shows the rest. */
function LimitedRegister({
  rows,
  limit,
  ...register
}: {
  stacked: boolean;
  head: string[];
  rows: Array<{ id: string; cells: ReactNode[] }>;
  limit: number;
  numeric?: boolean;
  testId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = limitRows(rows, limit, expanded);
  return (
    <>
      <AnalyticsRegister {...register} rows={shown.rows} empty={false} emptyCopy="" />
      {shown.toggle ? (
        <div className="df-analytics-more">
          <Button
            type="button"
            variant="ghost"
            className="df-btn"
            aria-expanded={shown.toggle.expanded}
            onClick={() => setExpanded(!expanded)}
            data-testid={`${register.testId}-toggle`}
          >
            {shown.toggle.label}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * A register of rows. With `numeric`, every column after the first holds
 * numbers: right-aligned in tabular figures, their heads on the same edge, and
 * a stacked row names each one.
 */
export function AnalyticsRegister({
  stacked,
  head,
  rows,
  empty,
  emptyCopy,
  testId,
  numeric = false,
}: {
  stacked: boolean;
  head: string[];
  rows: Array<{ id: string; cells: ReactNode[] }>;
  empty: boolean;
  emptyCopy: string;
  testId: string;
  numeric?: boolean;
}) {
  if (empty) return <V2CompactEmpty>{emptyCopy}</V2CompactEmpty>;
  const align = (index: number) => (numeric && index > 0 ? "end" : undefined);
  return (
    <>
      {stacked ? null : (
        <div className="df-register-head df-desktop-only" data-columns={head.length}>
          {head.map((label, index) => (
            <span key={label} data-align={align(index)}>
              {label}
            </span>
          ))}
        </div>
      )}
      {rows.map((row) => (
        <div
          key={row.id}
          className="df-register-row"
          data-columns={head.length}
          data-testid={`${testId}-${row.id}`}
        >
          {stacked ? (
            <span className="df-project-mobile">
              <span style={{ minWidth: 0, flex: 1 }}>
                <div className="df-row-title">{row.cells[0]}</div>
                <div className="df-mono df-meta">
                  {row.cells.slice(1).map((cell, index) => (
                    <Fragment key={head[index + 1]}>
                      {index > 0 ? " · " : null}
                      {numeric ? (
                        <span className="df-analytics-pair">
                          {head[index + 1]} {cell}
                        </span>
                      ) : (
                        cell
                      )}
                    </Fragment>
                  ))}
                </div>
              </span>
            </span>
          ) : (
            <>
              <span className="df-row-title">{row.cells[0]}</span>
              {row.cells.slice(1).map((cell, index) => (
                <span key={head[index + 1]} className="df-mono df-meta" data-align={align(index + 1)}>
                  {cell}
                </span>
              ))}
            </>
          )}
        </div>
      ))}
    </>
  );
}
