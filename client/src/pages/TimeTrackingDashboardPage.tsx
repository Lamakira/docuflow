import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Activity, Camera, Timer, TrendingUp, Coffee } from "lucide-react";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
} from "date-fns";

type Period = "today" | "week" | "month" | "30d" | "all";

interface TimeStats {
  totalDuration: number;
  totalIdleTime: number;
  entriesCount: number;
  screenshotCount: number;
  byProject: Array<{ crmProjectId: string; projectName: string; totalDuration: number }>;
  byUser: Array<{ userId: string; userName: string; totalDuration: number }>;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  "30d": "Last 30 days",
  all: "All time",
};

export default function TimeTrackingDashboardPage() {
  const [period, setPeriod] = useState<Period>("week");

  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    switch (period) {
      case "today":
        return { startDate: startOfDay(now), endDate: endOfDay(now) };
      case "week":
        return { startDate: startOfWeek(now, { weekStartsOn: 1 }), endDate: endOfWeek(now, { weekStartsOn: 1 }) };
      case "month":
        return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
      case "30d":
        return { startDate: startOfDay(subDays(now, 29)), endDate: endOfDay(now) };
      case "all":
      default:
        return { startDate: undefined, endDate: undefined };
    }
  }, [period]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (startDate) p.set("startDate", startDate.toISOString());
    if (endDate) p.set("endDate", endDate.toISOString());
    return p.toString();
  }, [startDate, endDate]);

  const { data: stats, isLoading } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", period],
    queryFn: async () => {
      const url = queryParams ? `/api/time-tracking/stats?${queryParams}` : "/api/time-tracking/stats";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const totalSeconds = stats?.totalDuration ?? 0;
  const totalIdleSeconds = stats?.totalIdleTime ?? 0;
  const entriesCount = stats?.entriesCount ?? 0;
  const screenshotCount = stats?.screenshotCount ?? 0;
  const avgSession = entriesCount > 0 ? Math.round(totalSeconds / entriesCount) : 0;

  // Productivity = active / (active + idle) × 100
  // Only meaningful if there's actual tracked time
  const productivityPct: number | null =
    totalSeconds + totalIdleSeconds > 0
      ? Math.round((totalSeconds / (totalSeconds + totalIdleSeconds)) * 100)
      : null;

  const kpis = [
    {
      label: "Total tracked",
      value: isLoading ? "…" : formatDuration(totalSeconds),
      sub: "Active time (excl. idle)",
      icon: Clock,
      color: "bg-primary/10",
      iconColor: "text-primary",
    },
    {
      label: "Sessions",
      value: isLoading ? "…" : entriesCount.toString(),
      sub: "Completed time entries",
      icon: Activity,
      color: "bg-blue-500/10",
      iconColor: "text-blue-600",
    },
    {
      label: "Avg. session",
      value: isLoading ? "…" : (entriesCount > 0 ? formatDuration(avgSession) : "—"),
      sub: "Per completed entry",
      icon: Timer,
      color: "bg-indigo-500/10",
      iconColor: "text-indigo-600",
    },
    {
      label: "Idle time",
      value: isLoading ? "…" : (totalIdleSeconds > 0 ? formatDuration(totalIdleSeconds) : "0m"),
      sub: "Detected idle / break time",
      icon: Coffee,
      color: "bg-orange-500/10",
      iconColor: "text-orange-600",
    },
    {
      label: "Productivity",
      value: isLoading ? "…" : (productivityPct !== null ? `${productivityPct}%` : "—"),
      sub: "Active ÷ (active + idle)",
      icon: TrendingUp,
      color: "bg-green-500/10",
      iconColor: "text-green-600",
    },
    {
      label: "Screenshots",
      value: isLoading ? "…" : screenshotCount.toString(),
      sub: "Captured by desktop agent",
      icon: Camera,
      color: "bg-purple-500/10",
      iconColor: "text-purple-600",
    },
  ];

  return (
    <TimeTrackingLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Overview of your time tracking activity.
            </p>
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpis.map(({ label, value, sub, icon: Icon, color, iconColor }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col gap-2">
                  <div className={`rounded-lg ${color} p-2 w-fit`}>
                    <Icon className={`h-4 w-4 ${iconColor}`} />
                  </div>
                  <div>
                    <p className="text-xl font-bold leading-tight">{value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Activity by project */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity by project</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.byProject && stats.byProject.length > 0 ? (
              <div className="space-y-3">
                {stats.byProject
                  .sort((a, b) => b.totalDuration - a.totalDuration)
                  .map((p) => {
                    const pct =
                      totalSeconds > 0
                        ? Math.round((p.totalDuration / totalSeconds) * 100)
                        : 0;
                    return (
                      <div key={p.crmProjectId} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium truncate">{p.projectName}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            {formatDuration(p.totalDuration)} · {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">
                {isLoading ? "Loading…" : `No data for ${PERIOD_LABELS[period].toLowerCase()}.`}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </TimeTrackingLayout>
  );
}
