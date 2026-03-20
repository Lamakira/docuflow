import { useState, useMemo, useEffect } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Camera, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import type { SafeUser } from "@shared/schema";

interface Screenshot {
  id: string;
  userId: string;
  timeEntryId: string;
  crmProjectId: string;
  storageKey: string;
  capturedAt: string;
}

interface ScreenshotsResponse {
  data: Screenshot[];
  total: number;
  limit: number;
  offset: number;
}

type DateFilter = "today" | "yesterday" | "week";

function formatHour(dateStr: string) {
  return format(new Date(dateStr), "h:00 a");
}

function formatTime(dateStr: string) {
  return format(new Date(dateStr), "h:mm a");
}

function displayName(u: SafeUser): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full || u.email || u.id;
}

export default function ScreencastsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  // undefined = "not yet initialised — waiting for user to load"
  // user.id   = filter to that specific user
  // "all"     = no user filter (admin only)
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Once the current user is known, default the filter to their own ID
  useEffect(() => {
    if (user?.id && selectedUserId === undefined) {
      setSelectedUserId(user.id);
    }
  }, [user?.id, selectedUserId]);

  // Resolved filter value used for queries and queryKey
  const effectiveUserId = selectedUserId ?? user?.id;

  const { start, end } = useMemo(() => {
    const now = new Date();
    if (dateFilter === "today") return { start: startOfDay(now), end: endOfDay(now) };
    if (dateFilter === "yesterday") {
      const y = subDays(now, 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
  }, [dateFilter]);

  const { data: usersData } = useQuery<SafeUser[]>({
    queryKey: ["/api/users"],
    enabled: isAdmin,
  });

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<ScreenshotsResponse>({
    // Include effectiveUserId and isAdmin in key so query refires when either changes
    queryKey: ["/api/time-tracking/screenshots", dateFilter, effectiveUserId, isAdmin],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: "50",
        offset: String(pageParam ?? 0),
      });
      // Admins can filter by a specific user; "all" means no userId param → backend returns all
      if (isAdmin && effectiveUserId && effectiveUserId !== "all") {
        params.set("userId", effectiveUserId);
      }
      const res = await fetch(`/api/time-tracking/screenshots?${params}`, {
        credentials: "include",
      });
      return res.json();
    },
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.data.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
    // Don't fetch until we know who the current user is
    enabled: !!effectiveUserId,
  });

  const allScreenshots = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  // Group screenshots by hour, sorted chronologically
  const grouped = useMemo(() => {
    const map = new Map<string, Screenshot[]>();
    for (const s of allScreenshots) {
      const hour = formatHour(s.capturedAt);
      if (!map.has(hour)) map.set(hour, []);
      map.get(hour)!.push(s);
    }
    return Array.from(map.entries()).sort(
      (a, b) =>
        new Date(a[1][0].capturedAt).getTime() -
        new Date(b[1][0].capturedAt).getTime()
    );
  }, [allScreenshots]);

  const previewScreenshot = previewIndex !== null ? allScreenshots[previewIndex] : null;

  return (
    <TimeTrackingLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Screencasts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isLoading
                ? "Loading…"
                : total > 0
                ? `${total} screenshot${total > 1 ? "s" : ""}`
                : "No screenshots for this period"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && user && (
              <Select value={effectiveUserId ?? ""} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Current user — always first */}
                  <SelectItem value={user.id}>
                    {displayName(user)} (me)
                  </SelectItem>
                  {/* Other users from current DB */}
                  {usersData
                    ?.filter((u) => u.id !== user.id)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {displayName(u)}
                      </SelectItem>
                    ))}
                  {/* All users */}
                  <SelectItem value="all">All users</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select
              value={dateFilter}
              onValueChange={(v) => setDateFilter(v as DateFilter)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="week">Last 7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-6">
            {[0, 1].map((g) => (
              <div key={g}>
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="h-4 w-16" />
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-video rounded-lg" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && allScreenshots.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Camera className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">No screenshots yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Screenshots are captured every 3–5 minutes while the timer is running.
            </p>
          </div>
        )}

        {/* Timeline grouped by hour */}
        {grouped.map(([hour, shots]) => (
          <div key={hour}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm font-semibold text-muted-foreground whitespace-nowrap">
                {hour}
              </span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {shots.length} screenshot{shots.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {shots.map((s) => {
                const idx = allScreenshots.indexOf(s);
                return (
                  <button
                    key={s.id}
                    onClick={() => setPreviewIndex(idx)}
                    className="group relative aspect-video rounded-lg overflow-hidden bg-muted border border-border hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    <img
                      src={`/api/time-tracking/screenshots/${s.id}/image`}
                      alt={`Screenshot at ${formatTime(s.capturedAt)}`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-white text-xs font-medium">
                        {formatTime(s.capturedAt)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Load more */}
        {hasNextPage && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {/* Preview modal */}
      <Dialog
        open={previewIndex !== null}
        onOpenChange={(open) => !open && setPreviewIndex(null)}
      >
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black border-0">
          {previewScreenshot && (
            <div className="relative">
              <img
                src={`/api/time-tracking/screenshots/${previewScreenshot.id}/image`}
                alt="Screenshot preview"
                className="w-full h-auto max-h-[80vh] object-contain"
              />

              {/* Info bar */}
              <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-black/60 flex items-center justify-between">
                <span className="text-white text-sm">
                  {format(new Date(previewScreenshot.capturedAt), "PPp")}
                </span>
                <span className="text-white/60 text-xs">
                  {previewIndex! + 1} / {allScreenshots.length}
                </span>
              </div>

              {/* Prev */}
              {previewIndex! > 0 && (
                <button
                  onClick={() => setPreviewIndex(previewIndex! - 1)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/75 transition-colors"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}

              {/* Next */}
              {previewIndex! < allScreenshots.length - 1 && (
                <button
                  onClick={() => setPreviewIndex(previewIndex! + 1)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/75 transition-colors"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TimeTrackingLayout>
  );
}
