import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  composeStats,
  composeStatsCharts,
  platformStatsPath,
  platformStatsSeriesPath,
  platformWorkspacesPath,
  statsPeriods,
  type PlatformStats,
  type PlatformStatsSeries,
  type PlatformWorkspaceRow,
  type StatsGroup,
} from "./backOffice";
import {
  ActiveWorkspacesChart,
  ChartCard,
  ChartSkeleton,
  DistributionChart,
  GrowthChart,
  PaymentsChart,
} from "./V2BackOfficeCharts";
import { FigureGrid, QueryRefusal } from "./V2BackOfficeParts";
import { V2FilterSelect } from "./V2Select";
import { SkeletonBand } from "./V2Skeleton";

export function V2BackOfficeStats() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const path = platformStatsPath(Number(days));
  const seriesPath = platformStatsSeriesPath(Number(days));
  const { data, isLoading, error } = useQuery<PlatformStats>({
    queryKey: [path],
    queryFn: () => apiRequest("GET", path),
  });
  const seriesQuery = useQuery<PlatformStatsSeries>({
    queryKey: [seriesPath],
    queryFn: () => apiRequest("GET", seriesPath),
  });
  // The Workspaces register's own query: one fetch feeds both.
  const rowsQuery = useQuery<PlatformWorkspaceRow[]>({
    queryKey: [platformWorkspacesPath()],
    queryFn: () => apiRequest("GET", platformWorkspacesPath()),
  });
  const stats = data ? composeStats(data) : null;
  const charts = useMemo(
    () => composeStatsCharts(data ?? null, seriesQuery.data ?? null, rowsQuery.data ?? null),
    [data, seriesQuery.data, rowsQuery.data],
  );
  const group = (id: StatsGroup["id"]) => stats?.groups.find((item) => item.id === id);
  const seriesState = (content: React.ReactNode | null) =>
    seriesQuery.error ? <QueryRefusal error={seriesQuery.error} /> : content ?? <ChartSkeleton />;

  const growth = group("growth");
  const revenue = group("revenue");
  const payments = group("payments");
  const usage = group("usage");

  return (
    <div className="df-backoffice-section" data-testid="v2-backoffice-stats">
      <div className="df-platform-head">
        <h1 className="df-title">Stats</h1>
        <V2FilterSelect
          label="PERIOD"
          ariaLabel="Stats period"
          value={days}
          onChange={(next) => setDays(next as "7" | "30" | "90")}
          options={statsPeriods}
          testId="v2-backoffice-stats-period"
        />
      </div>

      {error ? (
        <section className="df-card">
          <QueryRefusal error={error} />
        </section>
      ) : (
        <section className="df-card" data-testid="v2-backoffice-stats-kpis">
          {isLoading || !growth ? <SkeletonBand tiles={4} /> : <FigureGrid figures={growth.tiles} />}
        </section>
      )}

      <ChartCard
        title="Growth"
        testId="v2-backoffice-stats-growth"
        table={charts.growth?.table ?? null}
      >
        {seriesState(charts.growth ? <GrowthChart growth={charts.growth} /> : null)}
      </ChartCard>
      <ChartCard
        title="Workspaces with tracked time, per day"
        testId="v2-backoffice-stats-active"
        table={charts.activeWorkspaces?.table ?? null}
      >
        {seriesState(charts.activeWorkspaces ? <ActiveWorkspacesChart active={charts.activeWorkspaces} /> : null)}
      </ChartCard>

      {!error ? (
        <section className="df-card" data-testid="v2-backoffice-stats-revenue">
          <div className="df-card-head">
            <h2 className="df-card-title">Revenue</h2>
          </div>
          {isLoading || !revenue ? (
            <SkeletonBand tiles={4} />
          ) : (
            <>
              {charts.mrr.length === 0 ? (
                <p className="df-card-note">{charts.mrrEmptyCopy}</p>
              ) : (
                <div className="df-mrr-grid" data-testid="v2-backoffice-mrr">
                  {/* One tile per currency: amounts in different currencies are never added. */}
                  {charts.mrr.map((tile) => (
                    <div key={tile.currency} className="df-analytics-figure" data-testid={`v2-backoffice-mrr-${tile.currency}`}>
                      <span className="df-analytics-figure-label">{tile.label}</span>
                      <span className="df-analytics-figure-value df-mrr-hero">{tile.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <FigureGrid figures={revenue.tiles} />
            </>
          )}
        </section>
      ) : null}

      <ChartCard
        title="Payments"
        testId="v2-backoffice-stats-payments"
        table={charts.payments?.table ?? null}
        summary={charts.payments?.totalsLabel}
        footer={
          payments ? (
            // The summary line already says how many payments failed.
            <FigureGrid figures={payments.tiles.filter((tile) => tile.label !== "FAILED PAYMENTS")} />
          ) : !error ? (
            <SkeletonBand tiles={1} />
          ) : null
        }
      >
        {seriesState(charts.payments ? <PaymentsChart payments={charts.payments} /> : null)}
      </ChartCard>

      <h2 className="df-card-title">Workspace distribution</h2>
      <div className="df-distribution-grid" data-testid="v2-backoffice-stats-distribution">
        {charts.distributions.map((distribution) => {
          const failed = distribution.id === "reason" ? error : rowsQuery.error;
          return (
            <ChartCard
              key={distribution.id}
              title={distribution.title}
              testId={`v2-backoffice-stats-distribution-${distribution.id}`}
              table={distribution.entries && !distribution.empty ? distribution.table : null}
            >
              {failed ? (
                <QueryRefusal error={failed} />
              ) : !distribution.entries ? (
                <ChartSkeleton />
              ) : distribution.empty ? (
                <p className="df-chart-note">{distribution.emptyCopy}</p>
              ) : (
                <DistributionChart entries={distribution.entries} />
              )}
            </ChartCard>
          );
        })}
      </div>

      {!error ? (
        <section className="df-card" data-testid="v2-backoffice-stats-usage">
          <div className="df-card-head">
            <h2 className="df-card-title">Usage</h2>
          </div>
          {isLoading || !usage ? <SkeletonBand tiles={3} /> : <FigureGrid figures={usage.tiles} />}
        </section>
      ) : null}
    </div>
  );
}
