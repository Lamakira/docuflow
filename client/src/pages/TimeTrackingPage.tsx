import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock, Calendar, TrendingUp, Timer, Filter, X, ChevronDown, ChevronRight, LayoutList, Table2, Monitor, ImageIcon, Play, Pause, Square, ChevronLeft, Download, Check, LayoutGrid, Grid2x2, Rows3 } from "lucide-react";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import type { TimeEntry, CrmProjectWithDetails, User } from "@shared/schema";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatDetailedDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

type DateFilter = "today" | "week" | "month" | "all" | "day" | "custom";

type ViewMode = "grouped" | "table";
type PageTab = "entries" | "screenshots";

interface Screenshot {
  id: string;
  timeEntryId: string;
  userId: string;
  crmProjectId: string;
  storageKey: string;
  contentHash: string | null;
  capturedAt: string;
  createdAt: string;
  entryDuration: number | null;
  entryIdleTime: number | null;
}

export default function TimeTrackingPage() {
  const [activeTab, setActiveTab] = useState<PageTab>("entries");
  const [dateFilter, setDateFilter] = useState<DateFilter>("week");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [screenshotDateFilter, setScreenshotDateFilter] = useState<DateFilter>("week");
  const [screenshotPage, setScreenshotPage] = useState(1);
  const SCREENSHOT_PAGE_SIZE = 24;
  const [selectedScreenshotIds, setSelectedScreenshotIds] = useState<Set<string>>(new Set());
  const [userFilterOpen, setUserFilterOpen] = useState(false);
  const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
  const [lowActivityFilter, setLowActivityFilter] = useState(false);
  const [identicalFilter, setIdenticalFilter] = useState(false);
  const [includeArchivedUsers, setIncludeArchivedUsers] = useState(false);
  const [thumbnailSize, setThumbnailSize] = useState<"compact" | "default" | "large">("default");

  const browserTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const today = format(new Date(), "yyyy-MM-dd");
  const [customDayDate, setCustomDayDate] = useState<string>(today);
  const [customDateFrom, setCustomDateFrom] = useState<string>(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  const [customDateTo, setCustomDateTo] = useState<string>(today);

  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  // ─── Single Source of Truth: same context as Sidebar ───
  const {
    activeEntry: ctxActiveEntry,
    displayDuration: ctxDisplayDuration,
    isRunning: ctxIsRunning,
    isPaused: ctxIsPaused,
    hasActiveEntry: ctxHasActiveEntry,
    projects: ctxProjects,
    handlePause,
    handleResume,
    handleStop,
    pauseMutationPending,
    resumeMutationPending,
    stopMutationPending,
  } = useTimeTracker();

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      return newSet;
    });
  };

  // Historical data queries (read-only, for the entries table + stats)
  const { data: entriesData, isLoading: isLoadingEntries } = useQuery<{ data: TimeEntry[] }>({
    queryKey: ["/api/time-tracking/entries"],
  });

  const { data: statsData, isLoading: isLoadingStats } = useQuery<{
    totalDuration: number;
    totalIdleTime: number;
    entriesCount: number;
    averageDuration: number;
  }>({
    queryKey: ["/api/time-tracking/stats"],
  });

  // Use projects from context (same source as Sidebar) instead of a duplicate query
  const projects = ctxProjects;

  const { data: usersData = [] } = useQuery<User[]>({
    queryKey: ["/api/users", includeArchivedUsers],
    queryFn: async () => {
      const params = includeArchivedUsers ? "?includeArchived=true" : "";
      const res = await fetch(`/api/users${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const screenshotDateRange = useMemo(() => {
    const now = new Date();
    if (screenshotDateFilter === "today") {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (screenshotDateFilter === "week") {
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    }
    if (screenshotDateFilter === "month") {
      return { start: startOfMonth(now), end: endOfMonth(now) };
    }
    if (screenshotDateFilter === "day" && customDayDate) {
      const start = parseISO(customDayDate); start.setHours(0, 0, 0, 0);
      const end = parseISO(customDayDate); end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (screenshotDateFilter === "custom" && customDateFrom && customDateTo) {
      const start = parseISO(customDateFrom); start.setHours(0, 0, 0, 0);
      const end = parseISO(customDateTo); end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    return null;
  }, [screenshotDateFilter, customDayDate, customDateFrom, customDateTo]);

  const screenshotQueryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (projectFilter !== "all") p.set("crmProjectId", projectFilter);
    if (userFilter !== "all") p.set("userId", userFilter);
    if (screenshotDateRange) {
      p.set("startDate", screenshotDateRange.start.toISOString());
      p.set("endDate", screenshotDateRange.end.toISOString());
    }
    return p;
  }, [projectFilter, userFilter, screenshotDateRange]);

  const { data: screenshotsData, isLoading: isLoadingScreenshots } = useQuery<{ data: Screenshot[] }>({
    queryKey: ["/api/time-tracking/screenshots", projectFilter, userFilter, screenshotDateFilter, customDayDate, customDateFrom, customDateTo],
    queryFn: () => fetch(`/api/time-tracking/screenshots?${screenshotQueryParams.toString()}`).then(r => r.json()),
    enabled: activeTab === "screenshots",
  });

  const entries = entriesData?.data || [];
  const users = usersData || [];
  const stats = statsData;

  const filteredEntries = useMemo(() => {
    const now = new Date();
    
    return entries.filter((entry) => {
      const entryDate = new Date(entry.startTime);
      
      if (dateFilter === "today") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (!isWithinInterval(entryDate, { start: today, end: tomorrow })) {
          return false;
        }
      } else if (dateFilter === "week") {
        const weekStart = startOfWeek(now, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
        if (!isWithinInterval(entryDate, { start: weekStart, end: weekEnd })) {
          return false;
        }
      } else if (dateFilter === "month") {
        const monthStart = startOfMonth(now);
        const monthEnd = endOfMonth(now);
        if (!isWithinInterval(entryDate, { start: monthStart, end: monthEnd })) {
          return false;
        }
      }

      if (projectFilter !== "all" && entry.crmProjectId !== projectFilter) {
        return false;
      }

      if (userFilter !== "all" && entry.userId !== userFilter) {
        return false;
      }

      return true;
    });
  }, [entries, dateFilter, projectFilter, userFilter]);

  const filteredStats = useMemo(() => {
    const totalDuration = filteredEntries.reduce((sum, e) => sum + (e.duration || 0), 0);
    const totalIdleTime = filteredEntries.reduce((sum, e) => sum + (e.idleTime || 0), 0);
    const completedEntries = filteredEntries.filter((e) => e.status === "stopped");
    const avgDuration = completedEntries.length > 0 
      ? Math.round(totalDuration / completedEntries.length) 
      : 0;

    return {
      totalDuration,
      totalIdleTime,
      entriesCount: filteredEntries.length,
      averageDuration: avgDuration,
    };
  }, [filteredEntries]);

  const groupedByProject = useMemo(() => {
    const groups: Record<string, {
      projectId: string;
      projectName: string;
      totalDuration: number;
      totalIdleTime: number;
      entriesCount: number;
      entries: TimeEntry[];
      latestEntry: TimeEntry | null;
    }> = {};

    for (const entry of filteredEntries) {
      const projectId = entry.crmProjectId;
      if (!groups[projectId]) {
        groups[projectId] = {
          projectId,
          projectName: "",
          totalDuration: 0,
          totalIdleTime: 0,
          entriesCount: 0,
          entries: [],
          latestEntry: null,
        };
      }
      groups[projectId].totalDuration += entry.duration || 0;
      groups[projectId].totalIdleTime += entry.idleTime || 0;
      groups[projectId].entriesCount += 1;
      groups[projectId].entries.push(entry);
      
      if (!groups[projectId].latestEntry || new Date(entry.startTime) > new Date(groups[projectId].latestEntry.startTime)) {
        groups[projectId].latestEntry = entry;
      }
    }

    return Object.values(groups).map(group => ({
      ...group,
      projectName: projects.find(p => p.id === group.projectId)?.project?.name || "Unknown Project",
    })).sort((a, b) => {
      const aTime = a.latestEntry ? new Date(a.latestEntry.startTime).getTime() : 0;
      const bTime = b.latestEntry ? new Date(b.latestEntry.startTime).getTime() : 0;
      return bTime - aTime;
    });
  }, [filteredEntries, projects]);

  const allScreenshots = screenshotsData?.data ?? [];

  // Identical screenshots: same contentHash appears ≥2 times in the current result set
  const identicalIds = useMemo(() => {
    const hashCount: Record<string, number> = {};
    for (const s of allScreenshots) {
      if (s.contentHash) hashCount[s.contentHash] = (hashCount[s.contentHash] ?? 0) + 1;
    }
    return new Set(
      allScreenshots
        .filter((s) => s.contentHash && hashCount[s.contentHash] > 1)
        .map((s) => s.id)
    );
  }, [allScreenshots]);

  // Low-activity filter: idle > 50% of total tracked time for the entry
  const filteredScreenshots = useMemo(() => {
    let result = allScreenshots;
    if (lowActivityFilter) {
      result = result.filter((s) => {
        const dur = s.entryDuration ?? 0;
        const idle = s.entryIdleTime ?? 0;
        const total = dur + idle;
        return total > 0 && idle / total > 0.5;
      });
    }
    if (identicalFilter) {
      result = result.filter((s) => identicalIds.has(s.id));
    }
    return result;
  }, [allScreenshots, lowActivityFilter, identicalFilter, identicalIds]);

  const screenshotTotalPages = Math.max(1, Math.ceil(filteredScreenshots.length / SCREENSHOT_PAGE_SIZE));
  const paginatedScreenshots = filteredScreenshots.slice(
    (screenshotPage - 1) * SCREENSHOT_PAGE_SIZE,
    screenshotPage * SCREENSHOT_PAGE_SIZE,
  );

  const hourlyGroups = useMemo(() => {
    const byHour: Record<string, { key: string; hourLabel: string; dateLabel: string; screenshots: Screenshot[] }> = {};
    for (const s of paginatedScreenshots) {
      const d = new Date(s.capturedAt);
      const rawKey = `${format(d, "yyyy-MM-dd")}_${d.getHours()}`;
      if (!byHour[rawKey]) {
        byHour[rawKey] = {
          key: rawKey,
          hourLabel: format(d, "h a"),          // "12 PM"
          dateLabel: format(d, "MMM d, yyyy"),   // "Mar 24, 2026"
          screenshots: [],
        };
      }
      byHour[rawKey].screenshots.push(s);
    }
    return Object.entries(byHour)
      .sort(([a], [b]) => {
        const [da, ha] = a.split("_");
        const [db, hb] = b.split("_");
        if (da !== db) return db.localeCompare(da);
        return parseInt(hb) - parseInt(ha);
      })
      .map(([, group]) => group);
  }, [paginatedScreenshots]);

  const thumbnailGridClass = {
    compact: "grid-cols-3 md:grid-cols-5 lg:grid-cols-7",
    default: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
    large:   "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  }[thumbnailSize];

  const hasActiveScreenshotFilters = screenshotDateFilter !== "week" || projectFilter !== "all" || userFilter !== "all" || lowActivityFilter || identicalFilter;

  const clearScreenshotFilters = () => {
    setScreenshotDateFilter("week");
    setProjectFilter("all");
    setUserFilter("all");
    setLowActivityFilter(false);
    setIdenticalFilter(false);
    setScreenshotPage(1);
    setSelectedScreenshotIds(new Set());
  };

  // Reset selection when filters or tab change
  useEffect(() => {
    setSelectedScreenshotIds(new Set());
  }, [screenshotDateFilter, projectFilter, userFilter, customDayDate, customDateFrom, customDateTo, activeTab, lowActivityFilter, identicalFilter]);

  async function downloadScreenshot(id: string, capturedAt: string) {
    try {
      const res = await fetch(`/api/time-tracking/screenshots/${id}/image`, { credentials: "include" });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `screenshot-${format(new Date(capturedAt), "yyyy-MM-dd_HH-mm-ss")}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed", e);
    }
  }

  async function downloadSelectedScreenshots() {
    setIsDownloadingBatch(true);
    const toDownload = filteredScreenshots.filter((s) => selectedScreenshotIds.has(s.id));
    for (const s of toDownload) {
      await downloadScreenshot(s.id, s.capturedAt);
      await new Promise((r) => setTimeout(r, 200));
    }
    setIsDownloadingBatch(false);
  }

  const getProjectName = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    return project?.project?.name || "Unknown Project";
  };

  const getUserName = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    return user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email : "Unknown User";
  };

  // "idle" is a UI-only state (client-side), not a DB status.
  // DB statuses are: "running" | "paused" | "stopped"
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge variant="default" className="bg-green-600">Running</Badge>;
      case "paused":
        return <Badge variant="secondary">Paused</Badge>;
      case "stopped":
        return <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50 dark:bg-green-950">Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const clearFilters = () => {
    setDateFilter("week");
    setProjectFilter("all");
    setUserFilter("all");
  };

  const hasActiveFilters = dateFilter !== "week" || projectFilter !== "all" || userFilter !== "all";

  if (isLoadingEntries) {
    return (
      <TimeTrackingLayout>
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </TimeTrackingLayout>
    );
  }

  return (
    <TimeTrackingLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Time Tracking</h1>
          <p className="text-muted-foreground">Track and analyze your team's time across projects</p>
        </div>
        <div className="flex items-center border rounded-md">
          <Button
            variant="ghost"
            size="sm"
            className={`gap-2 rounded-r-none ${activeTab === "entries" ? "bg-muted" : ""}`}
            onClick={() => setActiveTab("entries")}
            data-testid="tab-entries"
          >
            <Clock className="h-4 w-4" />
            Entries
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`gap-2 rounded-l-none ${activeTab === "screenshots" ? "bg-muted" : ""}`}
            onClick={() => setActiveTab("screenshots")}
            data-testid="tab-screenshots"
          >
            <Monitor className="h-4 w-4" />
            Screenshots
          </Button>
        </div>
      </div>

      {/* ─── Active Timer Banner (from context — same source as Sidebar) ─── */}
      {ctxHasActiveEntry && ctxActiveEntry && (
        <Card className={`border-2 ${ctxIsRunning ? "border-green-500/50" : "border-amber-500/50"}`}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`h-2.5 w-2.5 rounded-full ${ctxIsRunning ? "bg-green-500 animate-pulse" : "bg-amber-500"}`} />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">
                    {projects.find(p => p.id === ctxActiveEntry.crmProjectId)?.project?.name || "Unknown Project"}
                  </div>
                  {ctxActiveEntry.description && (
                    <div className="text-xs text-muted-foreground truncate">{ctxActiveEntry.description}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`font-mono text-xl font-semibold ${ctxIsRunning ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                  {formatDetailedDuration(ctxDisplayDuration)}
                </span>
                <div className="flex gap-1.5">
                  {ctxIsRunning ? (
                    <Button size="sm" variant="secondary" onClick={handlePause} disabled={pauseMutationPending}>
                      <Pause className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleResume} disabled={resumeMutationPending}>
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={handleStop} disabled={stopMutationPending}>
                    <Square className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "entries" && (
      <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-stat-total-time">
          <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(filteredStats.totalDuration)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {filteredStats.entriesCount} entries
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-avg-session">
          <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Session</CardTitle>
            <Timer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(filteredStats.averageDuration)}</div>
            <p className="text-xs text-muted-foreground mt-1">per completed entry</p>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-idle-time">
          <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Idle Time</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(filteredStats.totalIdleTime)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {filteredStats.totalDuration > 0 
                ? `${Math.round((filteredStats.totalIdleTime / (filteredStats.totalDuration + filteredStats.totalIdleTime)) * 100)}% of tracked time`
                : "0% of tracked time"}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-productivity">
          <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Productivity</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {filteredStats.totalDuration > 0 
                ? `${Math.round((filteredStats.totalDuration / (filteredStats.totalDuration + filteredStats.totalIdleTime)) * 100)}%`
                : "0%"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">active vs total time</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Time Entries
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
                <SelectTrigger className="w-32" data-testid="select-date-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>

              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-40" data-testid="select-project-filter">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.project?.name || "Unnamed"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger className="w-40" data-testid="select-user-filter">
                  <SelectValue placeholder="All Users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {users.map((user) => {
                    const name = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;
                    const initials = [user.firstName, user.lastName]
                      .filter(Boolean)
                      .map((n) => n![0].toUpperCase())
                      .join("") || user.email[0].toUpperCase();
                    return (
                      <SelectItem key={user.id} value={user.id}>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                            {initials}
                          </span>
                          {name}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                  <X className="h-3 w-3" />
                  Clear
                </Button>
              )}

              <div className="flex items-center border rounded-md">
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 rounded-r-none ${viewMode === "grouped" ? "bg-muted" : ""}`}
                  onClick={() => setViewMode("grouped")}
                  data-testid="button-view-grouped"
                >
                  <LayoutList className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 rounded-l-none ${viewMode === "table" ? "bg-muted" : ""}`}
                  onClick={() => setViewMode("table")}
                  data-testid="button-view-table"
                >
                  <Table2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredEntries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground p-6">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No time entries found</p>
              <p className="text-sm mt-1">Start tracking from the sidebar timer: pick a project and a task, then Start — or use the Desktop Agent.</p>
            </div>
          ) : viewMode === "grouped" ? (
            <div className="space-y-3 p-6">
              {groupedByProject.map((group) => {
                const isExpanded = expandedProjects.has(group.projectId);
                return (
                  <div key={group.projectId} className="rounded-lg border overflow-hidden">
                    <div
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover-elevate gap-3 cursor-pointer"
                      data-testid={`time-entry-group-${group.projectId}`}
                      onClick={() => toggleProjectExpanded(group.projectId)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          <span className="font-medium truncate">{group.projectName}</span>
                          <Badge variant="secondary" className="text-xs">{group.entriesCount} {group.entriesCount === 1 ? "session" : "sessions"}</Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2 ml-6">
                          {group.latestEntry && (
                            <>
                              <span>Last tracked: {format(new Date(group.latestEntry.startTime), "MMM d, yyyy")}</span>
                              <span className="hidden sm:inline">{getUserName(group.latestEntry.userId)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-mono font-medium text-lg">{formatDetailedDuration(group.totalDuration)}</div>
                          {group.totalIdleTime > 0 && (
                            <div className="text-xs text-muted-foreground">+{formatDuration(group.totalIdleTime)} idle</div>
                          )}
                        </div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t bg-muted/30 divide-y">
                        {group.entries.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()).map((entry) => (
                          <div
                            key={entry.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between p-3 px-4 gap-2"
                            data-testid={`time-entry-${entry.id}`}
                          >
                            <div className="flex-1 min-w-0 ml-6">
                              <div className="flex items-center gap-2 flex-wrap">
                                {getStatusBadge(entry.status)}
                                {entry.description && (
                                  <span className="text-sm text-muted-foreground truncate">{entry.description}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                                <span>{format(new Date(entry.startTime), "MMM d, yyyy")}</span>
                                <span>{format(new Date(entry.startTime), "h:mm a")}</span>
                                {entry.endTime && (
                                  <span>- {format(new Date(entry.endTime), "h:mm a")}</span>
                                )}
                                <span className="hidden sm:inline">{getUserName(entry.userId)}</span>
                              </div>
                            </div>
                            <div className="text-right ml-6 sm:ml-0">
                              <div className="font-mono text-sm">{formatDetailedDuration(entry.duration || 0)}</div>
                              {entry.idleTime && entry.idleTime > 0 && (
                                <div className="text-xs text-muted-foreground">+{formatDuration(entry.idleTime)} idle</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted">
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Project</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Time</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">User</th>
                    <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Duration</th>
                    <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Idle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredEntries
                    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                    .map((entry) => (
                      <tr key={entry.id} className="hover:bg-muted/50" data-testid={`table-time-entry-${entry.id}`}>
                        <td className="px-4 py-3">
                          <span className="font-medium text-sm">{getProjectName(entry.crmProjectId)}</span>
                          {entry.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{entry.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">{getStatusBadge(entry.status)}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(entry.startTime), "MMM d, yyyy")}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(entry.startTime), "h:mm a")}
                          {entry.endTime && ` - ${format(new Date(entry.endTime), "h:mm a")}`}
                        </td>
                        <td className="px-4 py-3 text-sm">{getUserName(entry.userId)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-sm font-medium">{formatDetailedDuration(entry.duration || 0)}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                          {entry.idleTime && entry.idleTime > 0 ? formatDuration(entry.idleTime) : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {activeTab === "screenshots" && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Screenshots
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={screenshotDateFilter}
                  onValueChange={(v) => { setScreenshotDateFilter(v as DateFilter); setScreenshotPage(1); }}
                >
                  <SelectTrigger className="w-32" data-testid="select-screenshot-date-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">This Week</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                  </SelectContent>
                </Select>
                {screenshotDateFilter === "day" && (
                  <Input
                    type="date"
                    className="h-9 w-36"
                    value={customDayDate}
                    onChange={(e) => { setCustomDayDate(e.target.value); setScreenshotPage(1); }}
                  />
                )}
                {screenshotDateFilter === "custom" && (
                  <div className="flex items-center gap-1">
                    <Input
                      type="date"
                      className="h-9 w-36"
                      value={customDateFrom}
                      onChange={(e) => { setCustomDateFrom(e.target.value); setScreenshotPage(1); }}
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="date"
                      className="h-9 w-36"
                      value={customDateTo}
                      onChange={(e) => { setCustomDateTo(e.target.value); setScreenshotPage(1); }}
                    />
                  </div>
                )}

                <Select value={projectFilter} onValueChange={(v) => { setProjectFilter(v); setScreenshotPage(1); }}>
                  <SelectTrigger className="w-40" data-testid="select-screenshot-project-filter">
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.project?.name || "Unnamed"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {isAdmin && (
                  <Popover open={userFilterOpen} onOpenChange={setUserFilterOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 w-40 justify-between font-normal"
                        data-testid="select-screenshot-user-filter"
                      >
                        <span className="truncate">
                          {userFilter === "all" ? "All Users" : getUserName(userFilter)}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search users…" />
                        <CommandEmpty>No users found</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="all"
                            onSelect={() => { setUserFilter("all"); setScreenshotPage(1); setUserFilterOpen(false); }}
                          >
                            <Check className={`mr-2 h-4 w-4 shrink-0 ${userFilter === "all" ? "opacity-100" : "opacity-0"}`} />
                            All Users
                          </CommandItem>
                          {users.map((u) => {
                            const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email;
                            const initials = [u.firstName, u.lastName]
                              .filter(Boolean)
                              .map((n) => n![0].toUpperCase())
                              .join("") || u.email[0].toUpperCase();
                            // Detect display-name duplicates to show email as disambiguator
                            const hasDuplicate = users.filter((x) => {
                              const xn = `${x.firstName || ""} ${x.lastName || ""}`.trim() || x.email;
                              return xn === name && x.id !== u.id;
                            }).length > 0;
                            return (
                              <CommandItem
                                key={u.id}
                                // value must be unique — cmdk uses it for both filtering AND active state.
                                // Appending the id prevents multiple items sharing the same value
                                // while still allowing name-based search (cmdk does substring match).
                                value={`${name} ${u.id}`}
                                onSelect={() => { setUserFilter(u.id); setScreenshotPage(1); setUserFilterOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 shrink-0 ${userFilter === u.id ? "opacity-100" : "opacity-0"}`} />
                                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium mr-1.5">
                                  {initials}
                                </span>
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate">{name}</span>
                                  {hasDuplicate && (
                                    <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>
                                  )}
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                        <div className="border-t px-2 py-1.5">
                          <button
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            onClick={() => { setIncludeArchivedUsers((v) => !v); setScreenshotPage(1); }}
                            data-testid="toggle-include-archived-users"
                          >
                            <Check className={`h-3 w-3 shrink-0 ${includeArchivedUsers ? "opacity-100" : "opacity-0"}`} />
                            Include archived users
                          </button>
                        </div>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}

                <Button
                  variant={lowActivityFilter ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { setLowActivityFilter((v) => !v); setScreenshotPage(1); }}
                  title="Show only screenshots from sessions where idle time exceeded 50% of total time"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  Low Activity
                </Button>

                <Button
                  variant={identicalFilter ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { setIdenticalFilter((v) => !v); setScreenshotPage(1); }}
                  title="Show only screenshots that appear more than once (same content hash)"
                  disabled={identicalIds.size === 0}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Identical{identicalIds.size > 0 ? ` (${identicalIds.size})` : ""}
                </Button>

                {/* Density controls */}
                <div className="flex items-center border rounded-md">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 rounded-r-none rounded-l-md ${thumbnailSize === "compact" ? "bg-muted" : ""}`}
                    onClick={() => setThumbnailSize("compact")}
                    title="Compact"
                  >
                    <Grid2x2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 rounded-none border-x ${thumbnailSize === "default" ? "bg-muted" : ""}`}
                    onClick={() => setThumbnailSize("default")}
                    title="Default"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 rounded-l-none rounded-r-md ${thumbnailSize === "large" ? "bg-muted" : ""}`}
                    onClick={() => setThumbnailSize("large")}
                    title="Large"
                  >
                    <Rows3 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {hasActiveScreenshotFilters && (
                  <Button variant="ghost" size="sm" onClick={clearScreenshotFilters} className="gap-1">
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {!isLoadingScreenshots && (
              <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground pt-1">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>
                    {filteredScreenshots.length === 0
                      ? "No screenshots"
                      : `${filteredScreenshots.length} screenshot${filteredScreenshots.length === 1 ? "" : "s"}`}
                    {screenshotDateFilter !== "all" && (
                      <span className="ml-1">
                        · {screenshotDateFilter === "today"
                          ? "today"
                          : screenshotDateFilter === "week"
                          ? "this week"
                          : screenshotDateFilter === "month"
                          ? "this month"
                          : screenshotDateFilter === "day"
                          ? customDayDate
                          : screenshotDateFilter === "custom"
                          ? `${customDateFrom} – ${customDateTo}`
                          : ""}
                      </span>
                    )}
                  </span>
                </div>
                <span className="text-xs opacity-60" title="Times displayed in your local timezone">
                  {browserTimezone}
                </span>
              </div>
            )}
          </CardHeader>

          <CardContent>
            {isLoadingScreenshots ? (
              <div className={`grid ${thumbnailGridClass} gap-4`}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <Skeleton key={i} className="aspect-video rounded-lg" />
                ))}
              </div>
            ) : filteredScreenshots.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>{hasActiveScreenshotFilters ? "No screenshots match your filters" : "No screenshots captured yet"}</p>
                <p className="text-sm mt-1">
                  {hasActiveScreenshotFilters
                    ? "Try adjusting the date range or clearing filters"
                    : "Enable screen sharing in the time tracker to start capturing screenshots"}
                </p>
                {hasActiveScreenshotFilters && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={clearScreenshotFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Multi-select toolbar */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={
                        paginatedScreenshots.length > 0 &&
                        paginatedScreenshots.every((s) => selectedScreenshotIds.has(s.id))
                          ? true
                          : paginatedScreenshots.some((s) => selectedScreenshotIds.has(s.id))
                          ? "indeterminate"
                          : false
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedScreenshotIds(new Set(paginatedScreenshots.map((s) => s.id)));
                        } else {
                          setSelectedScreenshotIds(new Set());
                        }
                      }}
                    />
                    <span className="text-sm text-muted-foreground">
                      {selectedScreenshotIds.size > 0
                        ? `${selectedScreenshotIds.size} selected`
                        : "Select all"}
                    </span>
                  </div>
                  {selectedScreenshotIds.size > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={downloadSelectedScreenshots}
                      disabled={isDownloadingBatch}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download{selectedScreenshotIds.size > 1 ? ` (${selectedScreenshotIds.size})` : ""}
                    </Button>
                  )}
                </div>

                {/* Hourly groups */}
                <div className="space-y-8">
                  {hourlyGroups.map((group) => (
                    <div key={group.key} className="flex gap-6">
                      {/* Left: time label column */}
                      <div className="w-20 shrink-0 pt-1 select-none">
                        <div className="text-xl font-bold leading-tight">{group.hourLabel}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{group.dateLabel}</div>
                      </div>
                      {/* Right: screenshot grid */}
                      <div className="flex-1 min-w-0">
                      <div className={`grid ${thumbnailGridClass} gap-4`}>
                        {group.screenshots.map((screenshot) => {
                          const project = projects.find((p) => p.id === screenshot.crmProjectId);
                          const isSelected = selectedScreenshotIds.has(screenshot.id);
                          const isDuplicate = identicalIds.has(screenshot.id);
                          return (
                            <div
                              key={screenshot.id}
                              className={`group relative rounded-lg border overflow-visible hover-elevate cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`}
                              onClick={() => setSelectedScreenshot(screenshot)}
                              data-testid={`screenshot-${screenshot.id}`}
                            >
                              {/* Checkbox overlay */}
                              <div
                                className="absolute top-2 left-2 z-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedScreenshotIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(screenshot.id)) next.delete(screenshot.id);
                                    else next.add(screenshot.id);
                                    return next;
                                  });
                                }}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  className="bg-white/90 border-gray-300 shadow-sm"
                                />
                              </div>
                              <div className="aspect-video bg-muted overflow-hidden rounded-t-lg">
                                <img
                                  src={`/api/time-tracking/screenshots/${screenshot.id}/image`}
                                  alt={`Screenshot at ${format(new Date(screenshot.capturedAt), "h:mm a")}`}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                              <div className={thumbnailSize === "compact" ? "p-1" : "p-2 space-y-0.5"}>
                                <div className="flex items-center justify-between gap-1">
                                  <div className="text-xs font-medium truncate">
                                    {thumbnailSize !== "compact" && (project?.project?.name || "Unknown Project")}
                                    {thumbnailSize === "compact" && format(new Date(screenshot.capturedAt), "h:mm a")}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {isDuplicate && (
                                      <span
                                        className="text-[10px] px-1 rounded font-medium bg-blue-500/15 text-blue-700 dark:text-blue-400"
                                        title="Identical screenshot captured multiple times"
                                      >
                                        dup
                                      </span>
                                    )}
                                    {(() => {
                                      const dur = screenshot.entryDuration ?? 0;
                                      const idle = screenshot.entryIdleTime ?? 0;
                                      const total = dur + idle;
                                      if (total === 0) return null;
                                      const idlePct = Math.round((idle / total) * 100);
                                      if (idlePct < 20) return null;
                                      return (
                                        <span
                                          className={`text-[10px] px-1 rounded font-medium ${idlePct > 50 ? "bg-orange-500/15 text-orange-700 dark:text-orange-400" : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"}`}
                                          title={`${idlePct}% idle in this session`}
                                        >
                                          {idlePct}% idle
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </div>
                                {thumbnailSize !== "compact" && (
                                  <>
                                    <div className="text-xs text-muted-foreground">
                                      {format(new Date(screenshot.capturedAt), "MMM d, h:mm a")}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {getUserName(screenshot.userId)}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      </div>{/* flex-1 */}
                    </div>
                  ))}
                </div>

                {screenshotTotalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t mt-4">
                    <p className="text-sm text-muted-foreground">
                      Page {screenshotPage} of {screenshotTotalPages} · showing {(screenshotPage - 1) * SCREENSHOT_PAGE_SIZE + 1}–{Math.min(screenshotPage * SCREENSHOT_PAGE_SIZE, filteredScreenshots.length)} of {filteredScreenshots.length}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setScreenshotPage(p => Math.max(1, p - 1))}
                        disabled={screenshotPage === 1}
                        data-testid="button-screenshot-prev"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setScreenshotPage(p => Math.min(screenshotTotalPages, p + 1))}
                        disabled={screenshotPage === screenshotTotalPages}
                        data-testid="button-screenshot-next"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedScreenshot} onOpenChange={(open) => !open && setSelectedScreenshot(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Screenshot Details
            </DialogTitle>
          </DialogHeader>
          {selectedScreenshot && (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden border bg-muted">
                <img
                  src={`/api/time-tracking/screenshots/${selectedScreenshot.id}/image`}
                  alt="Screenshot"
                  className="w-full h-auto"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <span>{format(new Date(selectedScreenshot.capturedAt), "MMMM d, yyyy 'at' h:mm:ss a")}</span>
                  <span>{getUserName(selectedScreenshot.userId)}</span>
                  <span>{projects.find(p => p.id === selectedScreenshot.crmProjectId)?.project?.name || "Unknown Project"}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  onClick={() => downloadScreenshot(selectedScreenshot.id, selectedScreenshot.capturedAt)}
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </TimeTrackingLayout>
  );
}
