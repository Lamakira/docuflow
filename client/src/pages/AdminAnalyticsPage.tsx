import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowLeft, Clock, Users, Camera, AlertTriangle, TrendingUp, Activity,
  Monitor, Download, Wifi, WifiOff, BarChart2,
} from "lucide-react";

// ─── Helpers ───

function fmtHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtHoursDecimal(seconds: number): string {
  return (seconds / 3600).toFixed(1) + "h";
}

type Preset = "today" | "week" | "month" | "last7" | "last30" | "custom";

function computeRange(preset: Preset, customStart: string, customEnd: string): { start: Date; end: Date } {
  const now = new Date();
  if (preset === "today") return { start: startOfDay(now), end: endOfDay(now) };
  if (preset === "week") return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  if (preset === "month") return { start: startOfMonth(now), end: endOfMonth(now) };
  if (preset === "last7") return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
  if (preset === "last30") return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
  if (preset === "custom" && customStart && customEnd) {
    return { start: startOfDay(new Date(customStart)), end: endOfDay(new Date(customEnd)) };
  }
  return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
}

function buildUrl(base: string, params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

// ─── Stat card ───

function StatCard({ icon: Icon, label, value, sub, color = "text-primary" }: {
  icon: React.ComponentType<any>;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg bg-muted ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Idle ratio bar ───

function IdleBar({ ratio }: { ratio: number }) {
  const color = ratio > 60 ? "bg-red-500" : ratio > 30 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(ratio, 100)}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{ratio}%</span>
    </div>
  );
}

// ─── Date range controls ───

function DateRangeBar({
  preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd,
  userFilter, setUserFilter, projectFilter, setProjectFilter,
  users, projects,
}: {
  preset: Preset; setPreset: (p: Preset) => void;
  customStart: string; setCustomStart: (s: string) => void;
  customEnd: string; setCustomEnd: (s: string) => void;
  userFilter: string; setUserFilter: (s: string) => void;
  projectFilter: string; setProjectFilter: (s: string) => void;
  users: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }>;
  projects: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="week">This week</SelectItem>
          <SelectItem value="month">This month</SelectItem>
          <SelectItem value="last7">Last 7 days</SelectItem>
          <SelectItem value="last30">Last 30 days</SelectItem>
          <SelectItem value="custom">Custom…</SelectItem>
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <>
          <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-36" />
          <span className="text-muted-foreground text-sm">→</span>
          <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-36" />
        </>
      )}

      {users.length > 0 && (
        <Select value={userFilter || "_all"} onValueChange={v => setUserFilter(v === "_all" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All users" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All users</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={u.id}>
                {`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {projects.length > 0 && (
        <Select value={projectFilter || "_all"} onValueChange={v => setProjectFilter(v === "_all" ? "" : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All projects</SelectItem>
            {projects.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

// ─── Overview tab ───

function OverviewTab({ startISO, endISO }: { startISO: string; endISO: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/overview", startISO, endISO],
    queryFn: () => fetch(buildUrl("/api/admin/analytics/overview", { start: startISO, end: endISO })).then(r => r.json()),
  });

  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (!data) return null;

  const idleRatio = (data.totalTrackedSeconds + data.totalIdleSeconds) > 0
    ? Math.round((data.totalIdleSeconds / (data.totalTrackedSeconds + data.totalIdleSeconds)) * 100)
    : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard icon={Clock} label="Tracked hours" value={fmtHours(data.totalTrackedSeconds)} sub={`${data.entriesCount} entries`} />
      <StatCard icon={Activity} label="Idle time" value={fmtHours(data.totalIdleSeconds)} sub={`${idleRatio}% idle ratio`} color="text-amber-500" />
      <StatCard icon={Wifi} label="Running now" value={data.runningNow} sub="active timers" color="text-green-500" />
      <StatCard icon={Users} label="Active users today" value={data.activeUsersToday} />
      <StatCard icon={Camera} label="Screenshots" value={data.screenshotsInWindow} sub="in selected range" />
      <StatCard icon={AlertTriangle} label="Low activity entries" value={data.lowActivityEntries} sub=">50% idle" color="text-amber-500" />
      <StatCard icon={WifiOff} label="Revoked devices" value={data.revokedDevices} color="text-red-500" />
      <StatCard icon={Monitor} label="Entries in range" value={data.entriesCount} />
    </div>
  );
}

// ─── Productivity tab ───

function ProductivityTab({ startISO, endISO, userFilter, projectFilter }: {
  startISO: string; endISO: string; userFilter: string; projectFilter: string;
}) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/productivity", startISO, endISO, userFilter, projectFilter],
    queryFn: () => fetch(buildUrl("/api/admin/analytics/productivity", {
      start: startISO, end: endISO,
      userId: userFilter || undefined,
      crmProjectId: projectFilter || undefined,
    })).then(r => r.json()),
  });

  if (isLoading) return <div className="space-y-4">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (!data) return null;

  const trendData = (data.dailyTrend || []).map((d: any) => ({
    date: d.date?.slice(5) ?? "", // MM-DD
    hours: parseFloat((d.totalSeconds / 3600).toFixed(1)),
  }));

  return (
    <div className="space-y-6">
      {/* Daily trend */}
      {trendData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Daily Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trendData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="h" width={36} />
                <Tooltip formatter={(v: any) => [`${v}h`, "Tracked"]} />
                <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* By user */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> By User</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Tracked</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Idle</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Entries</th>
                </tr>
              </thead>
              <tbody>
                {(data.byUser || []).map((row: any) => (
                  <tr key={row.userId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium truncate max-w-[140px]">{row.userName}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtHoursDecimal(row.totalSeconds)}</td>
                    <td className="px-4 py-2 text-right font-mono text-amber-600">{fmtHoursDecimal(row.idleSeconds)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{row.entriesCount}</td>
                  </tr>
                ))}
                {(data.byUser || []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-xs">No data for this period</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* By project */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><BarChart2 className="w-4 h-4" /> By Project</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Project</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Tracked</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Entries</th>
                </tr>
              </thead>
              <tbody>
                {(data.byProject || []).map((row: any) => (
                  <tr key={row.crmProjectId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium truncate max-w-[180px]">{row.projectName}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtHoursDecimal(row.totalSeconds)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{row.entriesCount}</td>
                  </tr>
                ))}
                {(data.byProject || []).length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground text-xs">No data for this period</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* By task */}
      {(data.byTask || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Tasks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Task</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Tracked</th>
                </tr>
              </thead>
              <tbody>
                {(data.byTask || []).map((row: any, i: number) => (
                  <tr key={row.taskId ?? i} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 truncate max-w-xs">{row.taskName}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtHoursDecimal(row.totalSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Activity tab ───

function ActivityTab({ startISO, endISO, userFilter }: { startISO: string; endISO: string; userFilter: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/activity", startISO, endISO, userFilter],
    queryFn: () => fetch(buildUrl("/api/admin/analytics/activity", {
      start: startISO, end: endISO,
      userId: userFilter || undefined,
    })).then(r => r.json()),
  });

  if (isLoading) return <Skeleton className="h-48" />;
  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> Idle Ratio by User</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Tracked</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Idle</th>
              <th className="px-4 py-2 font-medium text-muted-foreground w-48">Idle ratio</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Idle events</th>
            </tr>
          </thead>
          <tbody>
            {(data.byUser || []).map((row: any) => (
              <tr key={row.userId} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2 font-medium truncate max-w-[160px]">{row.userName}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtHoursDecimal(row.totalSeconds)}</td>
                <td className="px-4 py-2 text-right font-mono text-amber-600">{fmtHoursDecimal(row.idleSeconds)}</td>
                <td className="px-4 py-2"><IdleBar ratio={row.idleRatio} /></td>
                <td className="px-4 py-2 text-right text-muted-foreground">{row.idleEventCount}</td>
              </tr>
            ))}
            {(data.byUser || []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">No data for this period</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Screenshots tab ───

function ScreenshotsTab({ startISO, endISO, userFilter }: { startISO: string; endISO: string; userFilter: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/screenshots", startISO, endISO, userFilter],
    queryFn: () => fetch(buildUrl("/api/admin/analytics/screenshots", {
      start: startISO, end: endISO,
      userId: userFilter || undefined,
    })).then(r => r.json()),
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>;
  if (!data) return null;

  const hourlyData = (data.hourlyDistribution || []).map((h: any) => ({
    hour: `${String(h.hour).padStart(2, "0")}h`,
    count: h.count,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon={Camera} label="Total screenshots" value={data.totalCount} />
        <StatCard icon={AlertTriangle} label="Duplicate hashes" value={data.duplicates?.length ?? 0} sub="same content" color="text-amber-500" />
      </div>

      {hourlyData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Hourly Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={hourlyData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                <YAxis tick={{ fontSize: 11 }} width={32} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">By User</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Count</th>
                </tr>
              </thead>
              <tbody>
                {(data.byUser || []).map((row: any) => (
                  <tr key={row.userId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{row.userName}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.count}</td>
                  </tr>
                ))}
                {(data.byUser || []).length === 0 && (
                  <tr><td colSpan={2} className="px-4 py-6 text-center text-muted-foreground text-xs">No screenshots</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {(data.duplicates || []).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Duplicate Screenshots
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Hash (truncated)</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Occurrences</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.duplicates || []).map((row: any) => (
                    <tr key={row.contentHash} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.contentHash.slice(0, 16)}…</td>
                      <td className="px-4 py-2 text-right">
                        <Badge variant="secondary">{row.count}×</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Alerts tab ───

function AlertsTab({ startISO, endISO }: { startISO: string; endISO: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/alerts", startISO, endISO],
    queryFn: () => fetch(buildUrl("/api/admin/analytics/alerts", { start: startISO, end: endISO })).then(r => r.json()),
  });

  if (isLoading) return <div className="space-y-4">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (!data) return null;

  const noAlerts =
    data.highIdleUsers?.length === 0 &&
    data.stalledDevices?.length === 0 &&
    data.runningWithoutScreenshots?.length === 0;

  if (noAlerts) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>No alerts for this period.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {(data.highIdleUsers || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> High Idle Ratio (&gt;50%)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Tracked</th>
                  <th className="px-4 py-2 font-medium text-muted-foreground w-40">Idle ratio</th>
                </tr>
              </thead>
              <tbody>
                {(data.highIdleUsers || []).map((row: any) => (
                  <tr key={row.userId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{row.userName}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtHoursDecimal(row.totalSeconds)}</td>
                    <td className="px-4 py-2"><IdleBar ratio={row.idleRatio} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {(data.runningWithoutScreenshots || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="w-4 h-4 text-red-500" /> Running Without Recent Screenshot
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Started</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Entry ID</th>
                </tr>
              </thead>
              <tbody>
                {(data.runningWithoutScreenshots || []).map((row: any) => (
                  <tr key={row.entryId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{row.userName}</td>
                    <td className="px-4 py-2 text-muted-foreground">{format(new Date(row.startedAt), "MMM d, HH:mm")}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.entryId.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {(data.stalledDevices || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="w-4 h-4 text-muted-foreground" /> Stalled Devices (&gt;7 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Device</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {(data.stalledDevices || []).map((d: any) => (
                  <tr key={d.deviceId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{d.deviceName}</td>
                    <td className="px-4 py-2 text-muted-foreground">{d.userName}</td>
                    <td className="px-4 py-2 text-right">
                      <Badge variant="outline">{d.daysSinceLastSeen}d ago</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Export tab ───

function ExportTab({ startISO, endISO, userFilter, projectFilter }: {
  startISO: string; endISO: string; userFilter: string; projectFilter: string;
}) {
  const url = buildUrl("/api/admin/analytics/export", {
    start: startISO, end: endISO,
    userId: userFilter || undefined,
    crmProjectId: projectFilter || undefined,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Download className="w-4 h-4" /> CSV Export</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Exports all <strong>stopped</strong> time entries for the selected date range and filters.
          Columns: Date, User, Project, Task, Description, Duration (h), Idle (h).
        </p>
        <div className="bg-muted rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground">
          {startISO.slice(0, 10)} → {endISO.slice(0, 10)}
          {userFilter && " · filtered by user"}
          {projectFilter && " · filtered by project"}
        </div>
        <a href={url} download>
          <Button className="gap-2">
            <Download className="w-4 h-4" />
            Download CSV
          </Button>
        </a>
      </CardContent>
    </Card>
  );
}

// ─── Main page ───

export default function AdminAnalyticsPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const [preset, setPreset] = useState<Preset>("last7");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  const { start, end } = useMemo(
    () => computeRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // Users and projects for filters
  const { data: usersData } = useQuery<any>({
    queryKey: ["/api/admin/users"],
    queryFn: () => fetch("/api/admin/users").then(r => r.json()),
  });
  const { data: projectsData } = useQuery<any>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500").then(r => r.json()),
  });

  const users = usersData ?? [];
  const projects = (projectsData?.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.project?.name ?? "Unknown Project",
  }));

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Access denied — admin only.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BarChart2 className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-sm text-muted-foreground">Time tracking data — admin view</p>
          </div>
        </div>
        <Button size="icon" variant="outline" onClick={() => setLocation("/admin")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
      </div>

      {/* Filters */}
      <DateRangeBar
        preset={preset} setPreset={setPreset}
        customStart={customStart} setCustomStart={setCustomStart}
        customEnd={customEnd} setCustomEnd={setCustomEnd}
        userFilter={userFilter} setUserFilter={setUserFilter}
        projectFilter={projectFilter} setProjectFilter={setProjectFilter}
        users={users}
        projects={projects}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 sm:grid-cols-6 max-w-2xl">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="productivity" className="text-xs sm:text-sm">Productivity</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs sm:text-sm">Activity</TabsTrigger>
          <TabsTrigger value="screenshots" className="text-xs sm:text-sm">Screenshots</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs sm:text-sm">Alerts</TabsTrigger>
          <TabsTrigger value="export" className="text-xs sm:text-sm">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab startISO={startISO} endISO={endISO} />
        </TabsContent>
        <TabsContent value="productivity" className="mt-6">
          <ProductivityTab startISO={startISO} endISO={endISO} userFilter={userFilter} projectFilter={projectFilter} />
        </TabsContent>
        <TabsContent value="activity" className="mt-6">
          <ActivityTab startISO={startISO} endISO={endISO} userFilter={userFilter} />
        </TabsContent>
        <TabsContent value="screenshots" className="mt-6">
          <ScreenshotsTab startISO={startISO} endISO={endISO} userFilter={userFilter} />
        </TabsContent>
        <TabsContent value="alerts" className="mt-6">
          <AlertsTab startISO={startISO} endISO={endISO} />
        </TabsContent>
        <TabsContent value="export" className="mt-6">
          <ExportTab startISO={startISO} endISO={endISO} userFilter={userFilter} projectFilter={projectFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
