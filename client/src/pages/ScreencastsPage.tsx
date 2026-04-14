import { useState, useMemo, useEffect } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Mouse,
  LayoutGrid,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { startOfDay, endOfDay, subDays } from "date-fns";
import type { SafeUser } from "@shared/schema";

interface Screenshot {
  id: string;
  userId: string;
  timeEntryId: string;
  crmProjectId: string;
  storageKey: string;
  capturedAt: string;
  entryDuration: number | null;
  entryIdleTime: number | null;
  keyboardActivityPercent: number | null;
  mouseActivityPercent: number | null;
  keyboardCount: number | null;
  mouseCount: number | null;
}

interface ScreenshotsResponse {
  data: Screenshot[];
  total: number;
  limit: number;
  offset: number;
}

type DateFilter = "today" | "yesterday" | "week";

/** Format the hour portion of a date in the given IANA timezone, e.g. "2:00 PM". */
function formatHour(dateStr: string, tz: string): string {
  const d = new Date(dateStr);
  // "numeric" hour gives "2 PM" in en-US; replace the space to produce "2:00 PM"
  const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true, timeZone: tz }).format(d);
  return h.replace(" ", ":00 ");
}

/** Format time as h:mm a in the given IANA timezone, e.g. "2:34 PM". */
function formatTime(dateStr: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(new Date(dateStr));
}

function displayName(u: SafeUser): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full || u.email || u.id;
}

/** Tailwind grid-cols class from column count (must be static strings for purge). */
const COLS_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

export default function ScreencastsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Thumbnail density: 2–8 columns (default 5)
  const [thumbnailCols, setThumbnailCols] = useState(5);

  // Timezone selector — driven by admin-configured allow-list
  const localTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [selectedTz, setSelectedTz] = useState<string>(localTz);

  const { data: tzData } = useQuery<{ allowedTimezones: string[] }>({
    queryKey: ["/api/screencasts/timezones"],
    queryFn: async () => {
      const res = await fetch("/api/screencasts/timezones", { credentials: "include" });
      return res.json();
    },
  });
  const allowedTimezones = tzData?.allowedTimezones ?? [];

  // When the allow-list loads, keep selectedTz if it's in the list; else reset to browser tz
  useEffect(() => {
    if (allowedTimezones.length > 0 && !allowedTimezones.includes(selectedTz)) {
      setSelectedTz(allowedTimezones.includes(localTz) ? localTz : allowedTimezones[0]);
    }
  }, [allowedTimezones, localTz]);

  // Once the current user is known, default the filter to their own ID
  useEffect(() => {
    if (user?.id && selectedUserId === undefined) {
      setSelectedUserId(user.id);
    }
  }, [user?.id, selectedUserId]);

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

  const { data: usersData = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdmin,
  });

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<ScreenshotsResponse>({
    queryKey: ["/api/time-tracking/screenshots", dateFilter, effectiveUserId, isAdmin],
    queryFn: async ({ pageParam }): Promise<ScreenshotsResponse> => {
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: "50",
        offset: String(pageParam ?? 0),
      });
      if (isAdmin && effectiveUserId && effectiveUserId !== "all") {
        params.set("userId", effectiveUserId);
      }
      const res = await fetch(`/api/time-tracking/screenshots?${params}`, {
        credentials: "include",
      });
      if (!res.ok) {
        // Normalize error responses to an empty page so getNextPageParam never
        // receives a payload without data / offset.
        return { data: [], total: 0, limit: 50, offset: Number(pageParam ?? 0) };
      }
      const json = await res.json();
      // Defensive normalisation: backend may omit fields in edge cases
      return {
        data:   Array.isArray(json?.data)   ? json.data   : [],
        total:  typeof json?.total  === "number" ? json.total  : 0,
        limit:  typeof json?.limit  === "number" ? json.limit  : 50,
        offset: typeof json?.offset === "number" ? json.offset : Number(pageParam ?? 0),
      };
    },
    getNextPageParam: (lastPage) => {
      const items      = lastPage?.data   ?? [];
      const pageOffset = lastPage?.offset ?? 0;
      const pageTotal  = lastPage?.total  ?? 0;
      const nextOffset = pageOffset + items.length;
      return nextOffset < pageTotal ? nextOffset : undefined;
    },
    initialPageParam: 0,
    enabled: !!effectiveUserId,
  });

  const allScreenshots = data?.pages.flatMap((p) => p.data ?? []) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  // Selection helpers
  const allIds = allScreenshots.map((s) => s.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && allIds.some((id) => selectedIds.has(id));

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected || someSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  }

  // Group screenshots by hour in the selected timezone, sorted newest-first
  const grouped = useMemo(() => {
    const map = new Map<string, Screenshot[]>();
    for (const s of allScreenshots) {
      const hour = formatHour(s.capturedAt, selectedTz);
      if (!map.has(hour)) map.set(hour, []);
      map.get(hour)!.push(s);
    }
    return Array.from(map.entries()).sort(
      (a, b) =>
        new Date(b[1][0].capturedAt).getTime() -
        new Date(a[1][0].capturedAt).getTime()
    );
  }, [allScreenshots]);

  const previewScreenshot = previewIndex !== null ? allScreenshots[previewIndex] : null;
  const gridClass = COLS_CLASS[10 - thumbnailCols] ?? "grid-cols-5";

  return (
    <TimeTrackingLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-4">

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
                  <SelectItem value={user.id}>
                    {displayName(user)} (me)
                  </SelectItem>
                  {usersData
                    ?.filter((u) => u.id !== user.id)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {displayName(u)}
                      </SelectItem>
                    ))}
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
            {/* Timezone selector — only shown when admin has configured an allow-list */}
            {allowedTimezones.length > 0 && (
              <Select value={selectedTz} onValueChange={setSelectedTz}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedTimezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}{tz === localTz ? " (yours)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Toolbar: select-all + density slider */}
        {!isLoading && allScreenshots.length > 0 && (
          <div className="flex items-center justify-between gap-4 py-1">
            {/* Left: select all */}
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all screenshots"
              />
              <span className="text-sm text-muted-foreground select-none">
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : "Select all"}
              </span>
            </div>

            {/* Right: density slider */}
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-muted-foreground shrink-0" />
              <Slider
                min={2}
                max={8}
                step={1}
                value={[thumbnailCols]}
                onValueChange={([v]) => setThumbnailCols(v)}
                className="w-28"
                aria-label="Thumbnail size"
              />
            </div>
          </div>
        )}

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
              Screenshots are captured while the timer is running.
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
            <div className={`grid ${gridClass} gap-3`}>
              {shots.map((s) => {
                const idx = allScreenshots.indexOf(s);
                const isChecked = selectedIds.has(s.id);

                // Activity ratio from time entry (entry-level approximation)
                const dur = s.entryDuration ?? 0;
                const idle = s.entryIdleTime ?? 0;
                const total = dur + idle;
                const actPct = total > 0 ? Math.round((dur / total) * 100) : null;

                return (
                  <div
                    key={s.id}
                    className={`group rounded-lg border overflow-hidden transition-all hover:shadow-md ${
                      isChecked
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {/* Image area */}
                    <div
                      className="relative aspect-video bg-muted cursor-pointer"
                      onClick={() => setPreviewIndex(idx)}
                    >
                      <img
                        src={`/api/time-tracking/screenshots/${s.id}/image`}
                        alt={`Screenshot at ${formatTime(s.capturedAt, selectedTz)}`}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      {/* Checkbox — top-left */}
                      <div
                        className="absolute top-1.5 left-1.5 z-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleId(s.id);
                        }}
                      >
                        <Checkbox
                          checked={isChecked}
                          className="bg-white/90 border-gray-300 shadow-sm data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          aria-label={`Select screenshot at ${formatTime(s.capturedAt, selectedTz)}`}
                        />
                      </div>
                    </div>

                    {/* Meta block */}
                    <div className="bg-muted/30 border-t border-border px-2 py-2 space-y-1.5">
                      {/* Time */}
                      <div className="text-xs font-medium text-foreground">
                        {formatTime(s.capturedAt, selectedTz)}
                      </div>

                      {/* Keyboard + Mouse — side by side, no percentage text */}
                      <div className="flex items-center gap-2">
                        {/* Keyboard */}
                        <div
                          className="flex items-center gap-1.5 flex-1 min-w-0"
                          title={
                            s.keyboardActivityPercent !== null
                              ? s.keyboardCount !== null
                                ? `Keyboard: ${s.keyboardActivityPercent}% — ${s.keyboardCount} keystroke${s.keyboardCount !== 1 ? "s" : ""} in last 60s`
                                : `Keyboard: ${s.keyboardActivityPercent}% active in last 60s`
                              : "Keyboard — no data (update desktop agent)"
                          }
                        >
                          <Keyboard className="h-3 w-3 text-muted-foreground shrink-0" />
                          <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${s.keyboardActivityPercent ?? 0}%` }}
                            />
                          </div>
                        </div>
                        {/* Mouse */}
                        <div
                          className="flex items-center gap-1.5 flex-1 min-w-0"
                          title={
                            s.mouseActivityPercent !== null
                              ? s.mouseCount !== null
                                ? `Mouse: ${s.mouseActivityPercent}% — ${s.mouseCount} event${s.mouseCount !== 1 ? "s" : ""} (clicks, moves, scroll) in last 60s`
                                : `Mouse: ${s.mouseActivityPercent}% active in last 60s`
                              : "Mouse — no data (update desktop agent)"
                          }
                        >
                          <Mouse className="h-3 w-3 text-muted-foreground shrink-0" />
                          <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${s.mouseActivityPercent ?? 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
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
                  {new Intl.DateTimeFormat("en-US", {
                    year: "numeric", month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit", hour12: true,
                    timeZone: selectedTz,
                  }).format(new Date(previewScreenshot.capturedAt))}
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
