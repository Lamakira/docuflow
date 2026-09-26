import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SkeletonSection, V2PageSkeleton } from "./V2Skeleton";
import {
  analyticsActivityPath,
  analyticsAlertsPath,
  analyticsCoveragePath,
  analyticsDevicesPath,
  analyticsEvidenceQualityPath,
  analyticsOverviewPath,
  analyticsProductivityPath,
  analyticsScreenshotsPath,
  analyticsRange,
  ANALYTICS_RANGE_PRESETS,
  canManageAdministration,
  composeAnalytics,
  type AnalyticsActivityInput,
  type AnalyticsAlertsInput,
  type AnalyticsCoverageInput,
  type AnalyticsDeviceInput,
  type AnalyticsEvidenceQualityInput,
  type AnalyticsFigure,
  type AnalyticsModel,
  type AnalyticsOverviewInput,
  type AnalyticsProductivityInput,
  type AnalyticsRangePreset,
  type AnalyticsScreenshotsInput,
  type RecordedTimeModel,
  type RecordedTimeSection,
} from "./administration";
import { workspaceOwnerName } from "./workspace";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect } from "./V2Select";

type WorkspaceMembershipsResponse = {
  memberships: Array<{
    firstName: string | null;
    lastName: string | null;
    email: string;
    workspaceRole: string;
  }>;
};

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

/**
 * Analytics, its own destination on the rail (#281): the analytics panes and
 * the four #259 dashboards — warnings, evidence quality, recorded time and
 * Activity Evidence — for the Workspace Roles Administration admits.
 */
export function V2AnalyticsPage() {
  const { layout, memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const workspaceRole = current?.workspaceRole ?? "MEMBER";
  const canManage = canManageAdministration(workspaceRole);
  const [rangePreset, setRangePreset] = useState<AnalyticsRangePreset>("7d");
  const [rangeAnchor] = useState(() => new Date());
  const range = useMemo(() => analyticsRange(rangePreset, rangeAnchor), [rangePreset, rangeAnchor]);

  const { data: people, isLoading: peopleLoading } = useQuery<WorkspaceMembershipsResponse>({
    queryKey: ["/api/workspace/memberships"],
    queryFn: async () => {
      const res = await fetch("/api/workspace/memberships", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Memberships");
      return res.json();
    },
  });
  const { data: overview, isLoading: overviewLoading, isError: overviewFailed } = useQuery<AnalyticsOverviewInput | null>({
    queryKey: [analyticsOverviewPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsOverviewInput>(analyticsOverviewPath(range)),
  });
  const { data: activity, isLoading: activityLoading, isError: activityFailed } = useQuery<AnalyticsActivityInput | null>({
    queryKey: [analyticsActivityPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsActivityInput>(analyticsActivityPath(range)),
  });
  const { data: coverage, isLoading: coverageLoading, isError: coverageFailed } = useQuery<AnalyticsCoverageInput | null>({
    queryKey: [analyticsCoveragePath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsCoverageInput>(analyticsCoveragePath(range)),
  });
  const {
    data: analyticsDevices,
    isLoading: analyticsDevicesLoading,
    isError: analyticsDevicesFailed,
  } = useQuery<AnalyticsDeviceInput[] | null>({
    queryKey: [analyticsDevicesPath()],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsDeviceInput[]>(analyticsDevicesPath()),
  });
  const { data: alerts, isLoading: alertsLoading, isError: alertsFailed } = useQuery<AnalyticsAlertsInput | null>({
    queryKey: [analyticsAlertsPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsAlertsInput>(analyticsAlertsPath(range)),
  });
  const {
    data: recordedTime,
    isLoading: recordedTimeLoading,
    isError: recordedTimeFailed,
  } = useQuery<AnalyticsProductivityInput | null>({
    queryKey: [analyticsProductivityPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsProductivityInput>(analyticsProductivityPath(range)),
  });
  const {
    data: screenshots,
    isLoading: screenshotsLoading,
    isError: screenshotsFailed,
  } = useQuery<AnalyticsScreenshotsInput | null>({
    queryKey: [analyticsScreenshotsPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsScreenshotsInput>(analyticsScreenshotsPath(range)),
  });
  const {
    data: evidenceQuality,
    isLoading: evidenceQualityLoading,
    isError: evidenceQualityFailed,
  } = useQuery<AnalyticsEvidenceQualityInput | null>({
    queryKey: [analyticsEvidenceQualityPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsEvidenceQualityInput>(analyticsEvidenceQualityPath(range)),
  });

  // Warnings ride with the analytics already on this page. The three
  // reporting reads must not hold a stalled Device off the screen.
  const analyticsLoading =
    overviewLoading || activityLoading || coverageLoading || analyticsDevicesLoading || alertsLoading;
  const analyticsRefused =
    overview === null || activity === null || coverage === null || analyticsDevices === null || alerts === null;
  const analyticsFailed =
    overviewFailed || activityFailed || coverageFailed || analyticsDevicesFailed || alertsFailed;

  // `/administration#alerts` and v1 links land here on the Warnings card.
  useEffect(() => {
    if (analyticsLoading) return;
    if (window.location.hash !== "#alerts") return;
    document.getElementById("alerts")?.scrollIntoView();
  }, [analyticsLoading]);

  const ownerName = workspaceOwnerName(people?.memberships ?? []);
  const analytics = composeAnalytics({
    now: rangeAnchor,
    workspaceName,
    workspaceRole,
    ownerName,
    range,
    overview: overview ?? null,
    activity: activity ?? null,
    coverage: coverage ?? null,
    devices: analyticsDevices ?? [],
    alerts: alerts ?? null,
    productivity: recordedTime ?? null,
    screenshots: screenshots ?? null,
    evidenceQuality: evidenceQuality ?? null,
    refused: analyticsRefused,
    readFailed: analyticsFailed,
  });

  if (!memberships || peopleLoading) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="df-page" data-testid="v2-analytics">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Analytics</h1>
          <p className="df-subhead">
            Recorded time, Activity Evidence, and operational warnings for {workspaceName}.
          </p>
        </div>
      </header>
      <AnalyticsSections
        analytics={analytics}
        loading={analyticsLoading}
        stacked={layout.stackedRegister}
        rangePreset={rangePreset}
        onRangeChange={setRangePreset}
        recordedTimeRead={reportRead(recordedTimeLoading, recordedTimeFailed, recordedTime)}
        screenshotsRead={reportRead(screenshotsLoading, screenshotsFailed, screenshots)}
        evidenceQualityRead={reportRead(evidenceQualityLoading, evidenceQualityFailed, evidenceQuality)}
      />
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <V2PageSkeleton title="Analytics" testId="v2-analytics" status="Loading Analytics for this Workspace.">
      <SkeletonSection title="Analytics" className="df-analytics-register" tiles={8} />
      <SkeletonSection title="Warnings" className="df-analytics-register" columns={3} rows={2} dataColumns />
      <SkeletonSection title="Activity" className="df-analytics-register" columns={4} rows={3} dataColumns />
    </V2PageSkeleton>
  );
}

/**
 * One card per section, the way every other register in v2 reads: the card head
 * owns the title and its one line of context, a toolbar sits above the data
 * rather than inside it, and figures get their own padded band. A card carries
 * no padding of its own, so each band brings the house 18px gutter.
 */
type ReportRead = "loading" | "failed" | "ready";

function reportRead(loading: boolean, failed: boolean, data: unknown): ReportRead {
  if (loading) return "loading";
  if (failed || data === null) return "failed";
  return "ready";
}

function AnalyticsSections({
  analytics,
  loading,
  stacked,
  rangePreset,
  onRangeChange,
  recordedTimeRead,
  screenshotsRead,
  evidenceQualityRead,
}: {
  analytics: AnalyticsModel;
  loading: boolean;
  stacked: boolean;
  rangePreset: AnalyticsRangePreset;
  onRangeChange: (preset: AnalyticsRangePreset) => void;
  recordedTimeRead: ReportRead;
  screenshotsRead: ReportRead;
  evidenceQualityRead: ReportRead;
}) {
  if (analytics.kind !== "ready") {
    return (
      <section className="df-card" data-testid="v2-analytics-overview-card">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Workspace totals</h2>
          </div>
        </div>
        <p
          className="df-refusal"
          data-testid={analytics.kind === "refusal" ? "v2-analytics-refusal" : "v2-analytics-unreadable"}
        >
          {analytics.kind === "refusal" ? analytics.refusal : analytics.note}
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="df-card" data-testid="v2-analytics-overview-card">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Workspace totals</h2>
            <p className="df-card-sub">Recorded Workspace totals for {analytics.rangeLabel}.</p>
          </div>
        </div>
        <div className="df-toolbar">
          <V2FilterSelect
            label="RANGE"
            ariaLabel="Analytics range"
            value={rangePreset}
            options={ANALYTICS_RANGE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
            onChange={(next) => onRangeChange(next as AnalyticsRangePreset)}
            active={rangePreset !== "7d"}
            testId="v2-analytics-range"
          />
          <Button asChild variant="outline" className="df-btn">
            <a
              href={analytics.export.href}
              download={analytics.export.filename}
              data-testid="v2-analytics-export"
            >
              {analytics.export.label}
            </a>
          </Button>
        </div>
        {loading ? (
          <p className="df-empty">Reading analytics for this range…</p>
        ) : (
          <FigureBand figures={analytics.overview} testId="v2-analytics-overview" />
        )}
      </section>

      {loading ? null : (
        <>
          <section id="alerts" className="df-card df-analytics-register" data-testid="v2-analytics-alerts">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Warnings</h2>
                <p className="df-card-sub">
                  Operational warnings for this range, including any Device that has stopped reporting.
                </p>
              </div>
            </div>
            {analytics.alerts.empty ? (
              <p className="df-empty">{analytics.alerts.emptyCopy}</p>
            ) : (
              <>
                {analytics.alerts.stalledDevices.length > 0 ? (
                  <>
                    <p className="df-analytics-group-label">STALLED DEVICES</p>
                    <AnalyticsRegister
                      stacked={stacked}
                      head={["DEVICE", "MEMBER", "LAST SEEN"]}
                      rows={analytics.alerts.stalledDevices.map((row) => ({
                        id: row.id,
                        cells: [row.name, row.who, row.lastSeen],
                      }))}
                      empty={false}
                      emptyCopy=""
                      testId="v2-analytics-alert-device"
                    />
                  </>
                ) : null}
                {analytics.alerts.highIdle.length > 0 ? (
                  <>
                    <p className="df-analytics-group-label">HIGH IDLE</p>
                    <AnalyticsRegister
                      stacked={stacked}
                      head={["MEMBER", "TRACKED", "IDLE"]}
                      rows={analytics.alerts.highIdle.map((row) => ({
                        id: row.id,
                        cells: [row.who, row.tracked, row.idle],
                      }))}
                      empty={false}
                      emptyCopy=""
                      testId="v2-analytics-alert-idle"
                    />
                  </>
                ) : null}
                {analytics.alerts.runningWithoutEvidence.length > 0 ? (
                  <>
                    <p className="df-analytics-group-label">RUNNING WITHOUT EVIDENCE</p>
                    <AnalyticsRegister
                      stacked={stacked}
                      head={["MEMBER", "STARTED"]}
                      rows={analytics.alerts.runningWithoutEvidence.map((row) => ({
                        id: row.id,
                        cells: [row.who, row.started],
                      }))}
                      empty={false}
                      emptyCopy=""
                      testId="v2-analytics-alert-running"
                    />
                  </>
                ) : null}
              </>
            )}
          </section>

          {recordedTimeRead === "loading" ? null : (
            <RecordedTimeCard recordedTime={analytics.recordedTime} read={recordedTimeRead} stacked={stacked} />
          )}

          <section className="df-card df-analytics-register" data-testid="v2-analytics-activity">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Activity</h2>
                <p className="df-card-sub">{analytics.activity.footnote}</p>
              </div>
            </div>
            <AnalyticsRegister
              stacked={stacked}
              head={["MEMBER", "TRACKED", "IDLE", "IDLE EVENTS"]}
              rows={analytics.activity.rows.map((row) => ({
                id: row.userId,
                cells: [row.who, row.tracked, row.idle, row.idleEvents],
              }))}
              empty={analytics.activity.empty}
              emptyCopy={analytics.activity.emptyCopy}
              testId="v2-analytics-activity"
            />
          </section>

          <section className="df-card df-analytics-register" data-testid="v2-analytics-coverage">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Evidence coverage</h2>
                <p className="df-card-sub">
                  How much of the tracked time carries Activity Evidence. Observational only.
                </p>
              </div>
            </div>
            <FigureBand figures={analytics.coverage.summary} testId="v2-analytics-coverage" />
            <AnalyticsRegister
              stacked={stacked}
              head={["MEMBER", "TRACKED", "ENTRIES", "EVIDENCE", "COVERAGE"]}
              rows={analytics.coverage.rows.map((row) => ({
                id: row.userId,
                cells: [row.who, row.tracked, row.entries, row.evidence, row.coverage],
              }))}
              empty={analytics.coverage.empty}
              emptyCopy={analytics.coverage.emptyCopy}
              testId="v2-analytics-coverage-row"
            />
          </section>

          {evidenceQualityRead === "loading" ? null : (
            <section className="df-card df-analytics-register" data-testid="v2-analytics-evidence-quality">
              <div className="df-card-head">
                <div className="df-card-head-text">
                  <h2 className="df-card-title">Evidence quality</h2>
                  {evidenceQualityRead === "ready" ? (
                    <p className="df-card-sub">{analytics.evidenceQuality.footnote}</p>
                  ) : null}
                </div>
              </div>
              {evidenceQualityRead === "failed" ? (
                <p className="df-refusal">
                  Evidence quality could not be read for this range. Nothing here is a count of zero.
                </p>
              ) : (
                <AnalyticsRegister
                  stacked={stacked}
                  head={["MEMBER", "GRADE", "EVIDENCE", "EVENTS"]}
                  rows={analytics.evidenceQuality.rows.map((row) => ({
                    id: row.id,
                    cells: [row.who, row.grade, row.evidence, row.events],
                  }))}
                  empty={analytics.evidenceQuality.empty}
                  emptyCopy={analytics.evidenceQuality.emptyCopy}
                  testId="v2-analytics-evidence-quality"
                />
              )}
            </section>
          )}

          {screenshotsRead === "loading" ? null : (
            <section className="df-card df-analytics-register" data-testid="v2-analytics-screenshots">
              <div className="df-card-head">
                <div className="df-card-head-text">
                  <h2 className="df-card-title">Activity Evidence</h2>
                  <p className="df-card-sub">Captures in this range. Observational only.</p>
                </div>
              </div>
              {screenshotsRead === "failed" ? (
                <p className="df-refusal">
                  Activity Evidence could not be read for this range. Nothing here is a count of zero.
                </p>
              ) : (
                <>
                  <FigureBand figures={analytics.screenshots.summary} testId="v2-analytics-screenshots" />
                  {analytics.screenshots.empty ? (
                    <p className="df-empty">{analytics.screenshots.emptyCopy}</p>
                  ) : (
                    <>
                      <p className="df-analytics-group-label">BY MEMBER</p>
                      <AnalyticsRegister
                        stacked={stacked}
                        head={["MEMBER", "EVIDENCE"]}
                        rows={analytics.screenshots.byMember.map((row) => ({
                          id: row.id,
                          cells: [row.who, row.evidence],
                        }))}
                        empty={analytics.screenshots.byMember.length === 0}
                        emptyCopy="No Activity Evidence by Member in this range."
                        testId="v2-analytics-screenshot-member"
                      />
                      <p className="df-analytics-group-label">BY HOUR</p>
                      <AnalyticsRegister
                        stacked={stacked}
                        head={["HOUR", "EVIDENCE"]}
                        rows={analytics.screenshots.hours.map((row) => ({
                          id: row.id,
                          cells: [row.hour, row.evidence],
                        }))}
                        empty={analytics.screenshots.hours.length === 0}
                        emptyCopy="No hourly Activity Evidence in this range."
                        testId="v2-analytics-screenshot-hour"
                      />
                    </>
                  )}
                </>
              )}
            </section>
          )}

          <section className="df-card df-analytics-register" data-testid="v2-analytics-devices">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Workspace Devices</h2>
                <p className="df-card-sub">Every Device paired in this Workspace.</p>
              </div>
            </div>
            <AnalyticsRegister
              stacked={stacked}
              head={["DEVICE", "MEMBER", "PLATFORM", "LAST SEEN", "STATUS"]}
              rows={analytics.devices.rows.map((row) => ({
                id: row.id,
                cells: [row.name, row.who, row.platform, row.lastSeen, row.status],
              }))}
              empty={analytics.devices.empty}
              emptyCopy={analytics.devices.emptyCopy}
              testId="v2-analytics-device"
            />
          </section>
        </>
      )}
    </>
  );
}

/**
 * Recorded time says what it measures, over which range, and for whom before
 * any number (#281). The totals read as a sentence; each breakdown names whose
 * or where the hours are before its rows.
 */
function RecordedTimeCard({
  recordedTime,
  read,
  stacked,
}: {
  recordedTime: RecordedTimeModel;
  read: Exclude<ReportRead, "loading">;
  stacked: boolean;
}) {
  const { sections } = recordedTime;
  return (
    <section className="df-card df-analytics-register" data-testid="v2-analytics-recorded-time">
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">Recorded time</h2>
          <p className="df-card-sub">{recordedTime.measures}</p>
        </div>
      </div>
      {read === "failed" ? (
        <p className="df-refusal">
          Recorded time could not be read for this range. Nothing here is a count of zero.
        </p>
      ) : recordedTime.empty ? (
        <p className="df-empty">{recordedTime.emptyCopy}</p>
      ) : (
        <>
          <p className="df-recorded-sentence" data-testid="v2-analytics-recorded-time-sentence">
            {recordedTime.sentence}
          </p>
          <FigureBand figures={recordedTime.summary} testId="v2-analytics-recorded-time-summary" />
          <RecordedTimeBreakdown
            section={sections.members}
            stacked={stacked}
            rows={recordedTime.rows.map((row) => ({ id: row.id, cells: [row.who, row.tracked, row.idle, row.entries] }))}
            testId="v2-analytics-recorded-time-member"
          />
          <RecordedTimeBreakdown
            section={sections.projects}
            stacked={stacked}
            rows={recordedTime.projects.map((row) => ({ id: row.id, cells: [row.name, row.tracked, row.entries] }))}
            testId="v2-analytics-recorded-time-project"
          />
          <RecordedTimeBreakdown
            section={sections.tasks}
            stacked={stacked}
            rows={recordedTime.tasks.map((row) => ({ id: row.id, cells: [row.name, row.tracked] }))}
            testId="v2-analytics-recorded-time-task"
          />
          <RecordedTimeBreakdown
            section={sections.days}
            stacked={stacked}
            rows={recordedTime.days.map((row) => ({ id: row.id, cells: [row.day, row.tracked] }))}
            testId="v2-analytics-recorded-time-day"
          />
        </>
      )}
    </section>
  );
}

function RecordedTimeBreakdown({
  section,
  stacked,
  rows,
  testId,
}: {
  section: RecordedTimeSection;
  stacked: boolean;
  rows: Array<{ id: string; cells: string[] }>;
  testId: string;
}) {
  return (
    <>
      <p className="df-analytics-group-label">{section.label}</p>
      <p className="df-analytics-group-caption">{section.caption}</p>
      <AnalyticsRegister
        stacked={stacked}
        head={section.head}
        rows={rows}
        empty={rows.length === 0}
        emptyCopy={section.emptyCopy}
        testId={testId}
      />
    </>
  );
}

export function FigureBand({ figures, testId }: { figures: AnalyticsFigure[]; testId: string }) {
  if (figures.length === 0) return null;
  return (
    <div className="df-figure-band" data-testid={testId}>
      {figures.map((figure) => (
        <div key={figure.label} className="df-analytics-figure">
          <span className="df-analytics-figure-label">{figure.label}</span>
          <span className="df-analytics-figure-value">{figure.value}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsRegister({
  stacked,
  head,
  rows,
  empty,
  emptyCopy,
  testId,
}: {
  stacked: boolean;
  head: string[];
  rows: Array<{ id: string; cells: string[] }>;
  empty: boolean;
  emptyCopy: string;
  testId: string;
}) {
  if (empty) return <p className="df-empty">{emptyCopy}</p>;
  return (
    <>
      {stacked ? null : (
        <div className="df-register-head df-desktop-only" data-columns={head.length}>
          {head.map((label) => (
            <span key={label}>{label}</span>
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
                <div className="df-mono df-meta">{row.cells.slice(1).join(" · ")}</div>
              </span>
            </span>
          ) : (
            <>
              <span className="df-row-title">{row.cells[0]}</span>
              {row.cells.slice(1).map((cell, index) => (
                <span key={head[index + 1]} className="df-mono df-meta">
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
