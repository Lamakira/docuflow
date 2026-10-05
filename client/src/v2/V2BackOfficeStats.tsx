import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { composeStats, platformStatsPath, statsPeriods, type PlatformStats } from "./backOffice";
import { FigureGrid } from "./V2BackOfficeParts";
import { V2FilterSelect } from "./V2Select";
import { SkeletonBand } from "./V2Skeleton";

export function V2BackOfficeStats() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const path = platformStatsPath(Number(days));
  const { data, isLoading } = useQuery<PlatformStats>({
    queryKey: [path],
    queryFn: () => apiRequest("GET", path),
  });
  const stats = data ? composeStats(data) : null;

  return (
    <div className="df-backoffice-section" data-testid="v2-backoffice-stats">
      <div className="df-filter-bar">
        <V2FilterSelect
          label="PERIOD"
          ariaLabel="Stats period"
          value={days}
          onChange={(next) => setDays(next as "7" | "30" | "90")}
          options={statsPeriods}
          testId="v2-backoffice-stats-period"
        />
      </div>
      {isLoading || !stats ? (
        <section className="df-card">
          <SkeletonBand tiles={4} />
        </section>
      ) : (
        stats.groups.map((group) => (
          <section key={group.id} className="df-card" data-testid={`v2-backoffice-stats-${group.id}`}>
            <div className="df-card-head">
              <h2 className="df-card-title">{group.title}</h2>
            </div>
            <FigureGrid figures={group.tiles} />
            {group.lists.map((list) => (
              <div key={list.title} className="df-backoffice-lines">
                <span className="df-analytics-figure-label">{list.title.toUpperCase()}</span>
                {list.lines.length === 0 ? <p className="df-empty df-flush">{list.emptyCopy}</p> : null}
                {list.lines.map((line) => (
                  <div key={line.label} className="df-backoffice-line">
                    <span>{line.label}</span>
                    <span className="df-mono">{line.value}</span>
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
