import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MultiTabCoordinator, type TabRole, type TimeTrackingSyncPayload } from "@/lib/MultiTabCoordinator";
import { ScreenCaptureWebService } from "@/lib/ScreenCaptureWebService";
import type { TimeEntry, CrmProjectWithDetails, Task } from "@shared/schema";

/** The active entry as `GET /api/time-tracking/active` serves it. */
type ActiveTimeEntry = TimeEntry & { taskAccumulatedToday?: number };

interface TimeTrackerState {
  activeEntry: ActiveTimeEntry | null;
  isLoadingActive: boolean;
  displayDuration: number;
  /** The Task's time today (stopped entries + the live one), as the desktop agent shows it. */
  taskTodayDuration: number;
  isRunning: boolean;
  isPaused: boolean;
  hasActiveEntry: boolean;
  projects: CrmProjectWithDetails[];
  tasks: Task[];
  selectedProjectId: string;
  selectedTaskId: string;
  description: string;
  isCapturing: boolean;
  captureError: string | null;
  startMutationPending: boolean;
  pauseMutationPending: boolean;
  resumeMutationPending: boolean;
  stopMutationPending: boolean;
  /** Whether this tab is the multi-tab leader (runs heartbeat/screenshots) */
  isTabLeader: boolean;
  /** When true, timer start must include a taskId (server has tasks migration). */
  requiresTaskForStart: boolean;
  /** Why web start is disabled, for inline UX (null = can start or tasks not required). */
  taskStartBlockedReason: "loading" | "no_project" | "no_tasks" | "no_task_selected" | null;
  /** Tasks for selected project are loading (requiresTask only). */
  isTasksListLoading: boolean;
}

interface TimeTrackerActions {
  setSelectedProjectId: (id: string) => void;
  setSelectedTaskId: (id: string) => void;
  setDescription: (desc: string) => void;
  // Each answers whether the server took it; a failure is already reported.
  handleStart: (projectId?: string, taskId?: string) => Promise<boolean>;
  handlePause: () => Promise<boolean>;
  handleResume: () => Promise<boolean>;
  handleStop: () => Promise<boolean>;
  handleToggleCapture: () => void;
}

type TimeTrackerContextType = TimeTrackerState & TimeTrackerActions;

const TimeTrackerContext = createContext<TimeTrackerContextType | null>(null);

export function useTimeTracker() {
  const ctx = useContext(TimeTrackerContext);
  if (!ctx) {
    throw new Error("useTimeTracker must be used within a TimeTrackerProvider");
  }
  return ctx;
}

const HEARTBEAT_INTERVAL_SECONDS = 60;

/** How the timer reports a refused or failed command: v1's toast unless the host passes its own. */
export type TimeTrackerReport = { failure: (title: string, description: string) => void };

export function TimeTrackerProvider({ children, report }: { children: ReactNode; report?: TimeTrackerReport }) {
  const { toast } = useToast();
  const notify = useMemo<TimeTrackerReport>(
    () => report ?? { failure: (title, description) => toast({ title, description, variant: "destructive" }) },
    [report, toast],
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [displayDuration, setDisplayDuration] = useState(0);
  const [isTabLeader, setIsTabLeader] = useState(false);

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Screen capture service (extracted — see ScreenCaptureWebService.ts)
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const screenCaptureRef = useRef<ScreenCaptureWebService | null>(null);
  const activeEntryRef = useRef<TimeEntry | null>(null);

  // ─── Multi-tab coordinator ───
  const coordinatorRef = useRef<MultiTabCoordinator | null>(null);

  const { data: activeEntry, isLoading: isLoadingActive } = useQuery<ActiveTimeEntry | null>({
    queryKey: ["/api/time-tracking/active"],
    refetchInterval: 10000,
  });

  const { data: projectsResponse } = useQuery<{ data: CrmProjectWithDetails[] }>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    // A refusal must not be cached as a list: the screens sharing this key could not tell.
    queryFn: () =>
      fetch("/api/crm/projects?pageSize=500").then((r) => {
        if (!r.ok) throw new Error("Failed to fetch Projects");
        return r.json();
      }),
  });

  const projects = projectsResponse?.data || [];

  const { data: capabilities } = useQuery<{ requiresTask: boolean }>({
    queryKey: ["/api/time-tracking/capabilities"],
    queryFn: () => apiRequest("GET", "/api/time-tracking/capabilities"),
    staleTime: 60_000,
  });
  const requiresTaskForStart = capabilities?.requiresTask ?? false;

  /** Resolves once the active entry is read again, so a command stays pending until the screen shows it. */
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/entries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/stats"] });
    return queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/active"] });
  }, []);

  const { data: tasksResponse, isLoading: isTasksListLoading } = useQuery<{ data: Task[] }>({
    queryKey: ["/api/tasks", selectedProjectId],
    queryFn: () =>
      selectedProjectId
        ? fetch(`/api/tasks?crmProjectId=${selectedProjectId}`).then((r) => r.json())
        : Promise.resolve({ data: [] }),
    enabled: !!selectedProjectId,
  });

  const tasks = tasksResponse?.data ?? [];

  const taskStartBlockedReason = useMemo(() => {
    if (!requiresTaskForStart) return null;
    if (!selectedProjectId) return "no_project";
    if (isTasksListLoading) return "loading";
    const openTasks = tasks.filter((t) => t.status !== "archived");
    if (openTasks.length === 0) return "no_tasks";
    if (!selectedTaskId) return "no_task_selected";
    return null;
  }, [requiresTaskForStart, selectedProjectId, isTasksListLoading, tasks, selectedTaskId]);

  const startMutation = useMutation({
    mutationFn: async (data: { crmProjectId: string; taskId?: string; description?: string }) => {
      return apiRequest("POST", "/api/time-tracking/start", data);
    },
    onSuccess: () => {
      setDescription("");
      setSelectedTaskId("");
      return invalidateAll();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to start timer";
      notify.failure("Could not start timer", message);
    },
  });

  function reportFailure(command: "pause" | "resume" | "stop", err: unknown) {
    const message = err instanceof Error && err.message ? err.message : `Failed to ${command} timer`;
    notify.failure(`Could not ${command} the timer`, message);
  }

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/time-tracking/${id}/pause`);
    },
    onSuccess: () => invalidateAll(),
    onError: (err: unknown) => reportFailure("pause", err),
  });

  const resumeMutation = useMutation({
    mutationFn: async (data: { id: string; discardIdleTime?: boolean }) => {
      return apiRequest("POST", `/api/time-tracking/${data.id}/resume`, { discardIdleTime: data.discardIdleTime });
    },
    onSuccess: () => invalidateAll(),
    onError: (err: unknown) => reportFailure("resume", err),
  });

  const stopMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/time-tracking/${id}/stop`);
    },
    onSuccess: () => {
      setSelectedProjectId("");
      setSelectedTaskId("");
      screenCaptureRef.current?.stop();
      return invalidateAll();
    },
    onError: (err: unknown) => reportFailure("stop", err),
  });

  // One command at a time. A ref, because `isPending` is stale within one tick.
  const commandRef = useRef(false);
  const runCommand = useCallback(async (command: () => Promise<unknown>): Promise<boolean> => {
    if (commandRef.current) return false;
    commandRef.current = true;
    try {
      await command();
      return true;
    } catch {
      return false;
    } finally {
      commandRef.current = false;
    }
  }, []);

  const activityMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/time-tracking/${id}/activity`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/active"] });
    },
  });

  // Keep activeEntryRef in sync
  useEffect(() => {
    activeEntryRef.current = activeEntry ?? null;
  }, [activeEntry]);

  // ─── Screen capture service init ───
  useEffect(() => {
    const service = new ScreenCaptureWebService({
      onStateChange: (state) => setIsCapturing(state.isCapturing),
      onError: (msg) => setCaptureError(msg),
      onErrorClear: () => setCaptureError(null),
    });
    screenCaptureRef.current = service;
    return () => {
      service.destroy();
      screenCaptureRef.current = null;
    };
  }, []);

  // ─── Multi-tab coordinator init ───
  useEffect(() => {
    const coordinator = new MultiTabCoordinator({
      onRoleChange: (role: TabRole) => {
        setIsTabLeader(role === "leader");
        if (role === "leader") {
          // Becoming leader: refetch to get fresh state
          invalidateAll();
        }
      },
      onStateSync: (payload: TimeTrackingSyncPayload) => {
        // Follower receives state from leader — update display duration
        setDisplayDuration(payload.displayDuration);
      },
    });

    coordinatorRef.current = coordinator;
    setIsTabLeader(coordinator.isLeader);

    // Release leadership on tab close/unload
    const handleBeforeUnload = () => {
      coordinator.releaseLeadership();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      coordinator.destroy();
      coordinatorRef.current = null;
    };
  }, [invalidateAll]);

  // ─── Duration display ───
  useEffect(() => {
    if (activeEntry) {
      setSelectedProjectId(activeEntry.crmProjectId);
      setSelectedTaskId(activeEntry.taskId ?? "");

      const calculateDuration = () => {
        let duration = activeEntry.duration || 0;
        if (activeEntry.status === "running" && activeEntry.lastActivityAt) {
          const elapsed = Math.floor((Date.now() - new Date(activeEntry.lastActivityAt).getTime()) / 1000);
          duration += elapsed;
        }
        return duration;
      };

      setDisplayDuration(calculateDuration());

      if (activeEntry.status === "running") {
        const interval = setInterval(() => {
          const dur = calculateDuration();
          setDisplayDuration(dur);

          // Leader broadcasts duration to followers
          if (coordinatorRef.current?.isLeader) {
            coordinatorRef.current.broadcastState({
              isRunning: true,
              isPaused: false,
              activeEntryId: activeEntry.id,
              crmProjectId: activeEntry.crmProjectId,
              isCapturing: screenCaptureRef.current?.capturing ?? false,
              displayDuration: dur,
            });
          }
        }, 1000);
        return () => clearInterval(interval);
      }
    } else {
      setDisplayDuration(0);
    }
  }, [activeEntry]);

  // ─── Heartbeat (LEADER ONLY) ───
  // Keeps lastActivityAt fresh on the server so duration display stays accurate.
  // Idle/machine-activity detection is the desktop agent's responsibility.
  useEffect(() => {
    if (!isTabLeader) return;

    if (!activeEntry?.id || activeEntry.status !== "running") {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      return;
    }

    heartbeatIntervalRef.current = setInterval(() => {
      if (activeEntry?.id && activeEntry.status === "running") {
        activityMutation.mutate(activeEntry.id);
      }
    }, HEARTBEAT_INTERVAL_SECONDS * 1000);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [activeEntry?.id, activeEntry?.status, isTabLeader]);

  // ─── Visibility change: resync only ───
  // A tab coming back resyncs with the server, and nothing more. It used to
  // pause a running Timer when the tab had been hidden for 3 minutes, which
  // paused the desktop agent's Timer while the Member worked in another window
  // (2026-10-22). A hidden tab says nothing about whether someone is working:
  // idle detection is the desktop agent's, from real keyboard and mouse input.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) invalidateAll();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [invalidateAll]);

  // ─── Screen Capture via service (LEADER ONLY for scheduling) ───
  const isRunning = activeEntry?.status === "running";

  useEffect(() => {
    const service = screenCaptureRef.current;
    if (!service) return;

    if (!isRunning) {
      service.pauseScheduling();
    } else if (isRunning && service.capturing) {
      service.resumeScheduling(activeEntry?.id ?? null, activeEntry?.crmProjectId ?? null);
    }
  }, [isRunning, activeEntry?.id, activeEntry?.crmProjectId]);

  // ─── Actions ───
  const handleStart = useCallback(async (projectId?: string, taskId?: string) => {
    const pid = projectId || selectedProjectId;
    // What is chosen in the Timer is about its own Project, not one named by the caller.
    const inTimer = pid === selectedProjectId;
    const tid = taskId || (inTimer ? selectedTaskId : "");
    if (!pid) {
      notify.failure("Select a project", "Choose a project before starting the timer.");
      return false;
    }
    if (requiresTaskForStart) {
      const blocked = inTimer && !taskId ? taskStartBlockedReason : null;
      if (blocked === "loading") return false;
      if (blocked === "no_tasks") {
        notify.failure(
          "Create a task first",
          "This project has no tasks yet. Add a task in Time Tracking → Projects & Tasks before starting the timer.",
        );
        return false;
      }
      if (blocked === "no_task_selected" || !tid) {
        notify.failure("Select a task to start tracking", "Pick a task for this project, then start the timer.");
        return false;
      }
    }
    return runCommand(() =>
      startMutation.mutateAsync({
        crmProjectId: pid,
        taskId: requiresTaskForStart ? tid : tid || undefined,
        description: description || undefined,
      }),
    );
  }, [
    selectedProjectId,
    selectedTaskId,
    description,
    startMutation,
    requiresTaskForStart,
    taskStartBlockedReason,
    notify,
    runCommand,
  ]);

  const handlePause = useCallback(async () => {
    if (!activeEntry) return false;
    return runCommand(() => pauseMutation.mutateAsync(activeEntry.id));
  }, [activeEntry, pauseMutation, runCommand]);

  const handleResume = useCallback(async () => {
    if (!activeEntry) return false;
    return runCommand(() => resumeMutation.mutateAsync({ id: activeEntry.id, discardIdleTime: false }));
  }, [activeEntry, resumeMutation, runCommand]);

  const handleStop = useCallback(async () => {
    if (!activeEntry) return false;
    return runCommand(() => stopMutation.mutateAsync(activeEntry.id));
  }, [activeEntry, stopMutation, runCommand]);

  const handleToggleCapture = useCallback(() => {
    const service = screenCaptureRef.current;
    if (!service) return;

    if (isCapturing) {
      service.stop();
    } else {
      service.start();
    }
  }, [isCapturing]);

  const isPaused = activeEntry?.status === "paused";
  const hasActiveEntry = !!activeEntry;

  const taskTodayDuration = useMemo(
    () => (activeEntry ? displayDuration + (activeEntry.taskAccumulatedToday ?? 0) : 0),
    [activeEntry, displayDuration],
  );

  const value: TimeTrackerContextType = {
    activeEntry: activeEntry ?? null,
    isLoadingActive,
    displayDuration,
    taskTodayDuration,
    isRunning: !!isRunning,
    isPaused: !!isPaused,
    hasActiveEntry,
    projects,
    tasks,
    selectedProjectId,
    selectedTaskId,
    description,
    isCapturing,
    captureError,
    isTabLeader,
    startMutationPending: startMutation.isPending,
    pauseMutationPending: pauseMutation.isPending,
    resumeMutationPending: resumeMutation.isPending,
    stopMutationPending: stopMutation.isPending,
    requiresTaskForStart,
    taskStartBlockedReason,
    isTasksListLoading,
    setSelectedProjectId,
    setSelectedTaskId,
    setDescription,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
    handleToggleCapture,
  };

  return (
    <TimeTrackerContext.Provider value={value}>
      {children}
    </TimeTrackerContext.Provider>
  );
}
