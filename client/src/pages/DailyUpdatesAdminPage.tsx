import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, subDays } from "date-fns";
import { Search, Calendar, Users, Clock, Briefcase, Ban, BarChart3, ArrowLeft } from "lucide-react";
import { dailyUpdateStatusOptions } from "@shared/schema";
import type { ProjectDailyUpdateWithDetails } from "@shared/schema";

const STATUS_BADGES: Record<string, string> = Object.fromEntries(
  dailyUpdateStatusOptions.map((s) => [s.value, s.color])
);

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  dailyUpdateStatusOptions.map((s) => [s.value, s.label])
);

export default function DailyUpdatesAdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Redirect non-admin users
  if (user?.role !== "admin") {
    return (
      <div className="max-w-3xl mx-auto p-6 text-center">
        <h1 className="text-xl font-semibold">Access Denied</h1>
        <p className="text-muted-foreground mt-2">You need admin privileges to view this page.</p>
      </div>
    );
  }
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("7");
  const [statusFilter, setStatusFilter] = useState("all");

  const startDate = useMemo(() => {
    const days = parseInt(dateFilter);
    return subDays(new Date(), days);
  }, [dateFilter]);

  const endDate = useMemo(() => new Date(), []);

  const { data: updates = [], isLoading: updatesLoading } = useQuery<ProjectDailyUpdateWithDetails[]>({
    queryKey: ["/api/admin/daily-updates", startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("startDate", startDate.toISOString());
      params.set("endDate", endDate.toISOString());
      const res = await fetch(`/api/admin/daily-updates?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch daily updates");
      return res.json();
    },
  });

  const { data: kpis, isLoading: kpisLoading } = useQuery<{
    total: number;
    waitingOnClient: number;
    blocked: number;
    activeUsers: number;
    activeProjects: number;
    todayUpdates: number;
  }>({
    queryKey: ["/api/admin/daily-updates/kpis", startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("startDate", startDate.toISOString());
      params.set("endDate", endDate.toISOString());
      const res = await fetch(`/api/admin/daily-updates/kpis?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPIs");
      return res.json();
    },
  });

  const filteredUpdates = useMemo(() => {
    let rows = updates;
    if (statusFilter !== "all") rows = rows.filter((u) => u.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (u) =>
          (u.user?.firstName || "").toLowerCase().includes(q) ||
          (u.user?.lastName || "").toLowerCase().includes(q) ||
          (u.crmProject?.project?.name || "").toLowerCase().includes(q) ||
          (u.whatHappened || "").toLowerCase().includes(q) ||
          (u.nextSteps || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [updates, statusFilter, search]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()} data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Daily Updates Dashboard</h1>
          <p className="text-sm text-muted-foreground">Review all team submissions and track project health</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <BarChart3 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{kpisLoading ? "-" : kpis?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground">Total updates</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{kpisLoading ? "-" : kpis?.waitingOnClient ?? 0}</p>
              <p className="text-xs text-muted-foreground">Waiting on client</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-red-500/10 p-2">
              <Ban className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{kpisLoading ? "-" : kpis?.blocked ?? 0}</p>
              <p className="text-xs text-muted-foreground">Blocked</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <Users className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{kpisLoading ? "-" : kpis?.activeUsers ?? 0}</p>
              <p className="text-xs text-muted-foreground">Active contributors</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by project, user, or content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-daily-updates"
          />
        </div>
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-date-range">
            <Calendar className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Today</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {dailyUpdateStatusOptions.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submissions ({filteredUpdates.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {updatesLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : filteredUpdates.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No daily updates found for the selected filters.
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress Today</TableHead>
                    <TableHead>Next Steps</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUpdates.map((u) => (
                    <TableRow key={u.id} data-testid={`row-daily-update-${u.id}`}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(u.updateDate), "MMM d")}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2">
                          <Users className="w-3 h-3 text-muted-foreground" />
                          <span>{u.user?.firstName || ""} {u.user?.lastName || ""}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2">
                          <Briefcase className="w-3 h-3 text-muted-foreground" />
                          <span>{u.crmProject?.project?.name || "-"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_BADGES[u.status] || ""}>{STATUS_LABELS[u.status] || u.status}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm" title={u.whatHappened || ""}>
                        {u.whatHappened || "-"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm" title={u.nextSteps || ""}>
                        {u.nextSteps || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {u.waitingOnClient && (
                            <Badge variant="outline" className="text-amber-600 border-amber-200 text-xs">
                              Waiting on client
                            </Badge>
                          )}
                          {u.blockageType && (
                            <Badge variant="outline" className="text-red-600 border-red-200 text-xs capitalize">
                              {u.blockageType}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
