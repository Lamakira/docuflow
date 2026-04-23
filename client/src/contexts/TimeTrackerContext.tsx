import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MultiTabCoordinator, type TabRole, type TimeTrackingSyncPayload } from "@/lib/MultiTabCoordinator";
import { ScreenCaptureWebService } from "@/lib/ScreenCaptureWebService";
import type { TimeEntry, CrmProjectWithDetails, Task } from "@shared/schema";

interface TimeTrackerState {
  activeEntry: TimeEntry | null;
  isLoadingActive: boolean;
  displayDuration: number;
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
  handleStart: (projectId?: string, taskId?: string) => void;
  handlePause: () => void;
  handleResume: () => void;
  handleStop: () => void;
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

export function TimeTrackerProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
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

  const { data: activeEntry, isLoading: isLoadingActive } = useQuery<TimeEntry | null>({
    queryKey: ["/api/time-tracking/active"],
    refetchInterval: 10000,
  });

  const { data: projectsResponse } = useQuery<{ data: CrmProjectWithDetails[] }>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500").then(r => r.json()),
  });

  const projects = projectsResponse?.data || [];

  const { data: capabilities } = useQuery<{ requiresTask: boolean }>({
    queryKey: ["/api/time-tracking/capabilities"],
    queryFn: () => apiRequest("GET", "/api/time-tracking/capabilities"),
    staleTime: 60_000,
  });
  const requiresTaskForStart = capabilities?.requiresTask ?? false;

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/active"] });
    queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/entries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/stats"] });
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
      invalidateAll();
      setDescription("");
      setSelectedTaskId("");
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to start timer";
      toast({ title: "Could not start timer", description: message, variant: "destructive" });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/time-tracking/${id}/pause`);
    },
    onSuccess: () => invalidateAll(),
  });

  const resumeMutation = useMutation({
    mutationFn: async (data: { id: string; discardIdleTime?: boolean }) => {
      return apiRequest("POST", `/api/time-tracking/${data.id}/resume`, { discardIdleTime: data.discardIdleTime });
    },
    onSuccess: () => invalidateAll(),
  });

  const stopMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/time-tracking/${id}/stop`);
    },
    onSuccess: () => {
      invalidateAll();
      setSelectedProjectId("");
      screenCaptureRef.current?.stop();
    },
  });

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

  // ─── Visibility change handling ───
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Tab became visible — resync with server
        invalidateAll();
      }
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
  const handleStart = useCallback((projectId?: string, taskId?: string) => {
    const pid = projectId || selectedProjectId;
    const tid = taskId || selectedTaskId;
    if (!pid) {
      toast({ title: "Select a project", description: "Choose a project before starting the timer.", variant: "destructive" });
      return;
    }
    if (requiresTaskForStart) {
      if (taskStartBlockedReason === "loading") return;
      if (taskStartBlockedReason === "no_tasks") {
        toast({
          title: "Create a task first",
          description: "This project has no tasks yet. Add a task in Time Tracking → Projects & Tasks before starting the timer.",
          variant: "destructive",
        });
        return;
      }
      if (taskStartBlockedReason === "no_task_selected" || !tid) {
        toast({
          title: "Select a task to start tracking",
          description: "Pick a task for this project, then start the timer.",
          variant: "destructive",
        });
        return;
      }
    }
    startMutation.mutate({
      crmProjectId: pid,
      taskId: requiresTaskForStart ? tid : tid || undefined,
      description: description || undefined,
    });
  }, [
    selectedProjectId,
    selectedTaskId,
    description,
    startMutation,
    requiresTaskForStart,
    taskStartBlockedReason,
    toast,
  ]);

  const handlePause = useCallback(() => {
    if (activeEntry) {
      pauseMutation.mutate(activeEntry.id);
    }
  }, [activeEntry, pauseMutation]);

  const handleResume = useCallback(() => {
    if (activeEntry) {
      resumeMutation.mutate({ id: activeEntry.id, discardIdleTime: false });
    }
  }, [activeEntry, resumeMutation]);

  const handleStop = useCallback(() => {
    if (activeEntry) {
      stopMutation.mutate(activeEntry.id);
    }
  }, [activeEntry, stopMutation]);

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

  const value: TimeTrackerContextType = {
    activeEntry: activeEntry ?? null,
    isLoadingActive,
    displayDuration,
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
