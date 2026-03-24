import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Play, Pause, Square, Clock, ChevronDown, ChevronUp, AlertCircle, Check, ChevronsUpDown, Timer, Monitor, Plus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

interface TimeTrackerProps {
  testId?: string;
  iconOnly?: boolean;
}

export function TimeTracker({ testId = "button-time-tracker-toggle", iconOnly = false }: TimeTrackerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);
  const [taskSelectorOpen, setTaskSelectorOpen] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const {
    activeEntry,
    isLoadingActive,
    displayDuration,
    isRunning,
    isPaused,
    hasActiveEntry,
    projects,
    tasks,
    selectedProjectId,
    selectedTaskId,
    description,
    showIdleDialog,
    idleCountdown,
    isCapturing,
    captureError,
    startMutationPending,
    pauseMutationPending,
    resumeMutationPending,
    stopMutationPending,
    setSelectedProjectId,
    setSelectedTaskId,
    setDescription,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
    handleStillWorking,
    handleNotWorking,
    handleToggleCapture,
    setShowIdleDialog,
  } = useTimeTracker();

  const createTaskMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/tasks", { crmProjectId: selectedProjectId, name }),
    onSuccess: (task: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", selectedProjectId] });
      setSelectedTaskId(task.id);
      setNewTaskName("");
      setIsCreatingTask(false);
      setTaskSelectorOpen(false);
    },
  });

  const handleCreateTask = () => {
    const name = newTaskName.trim();
    if (!name || !selectedProjectId) return;
    createTaskMutation.mutate(name);
  };

  const activeProject = projects.find(p => p.id === activeEntry?.crmProjectId);

  if (isLoadingActive) {
    return null;
  }

  return (
    <>
    <Popover open={isExpanded} onOpenChange={setIsExpanded}>
      <PopoverTrigger asChild>
        <Button
          variant={hasActiveEntry ? (isRunning ? "default" : "secondary") : "ghost"}
          size={iconOnly ? "icon" : "sm"}
          className={`${iconOnly ? "h-8 w-8" : "gap-2"} ${isRunning ? "animate-pulse" : ""}`}
          data-testid={testId}
        >
          <Clock className="h-4 w-4" />
          {!iconOnly && (
            <>
              {hasActiveEntry ? (
                <span className="font-mono text-sm">{formatDuration(displayDuration)}</span>
              ) : (
                <span>Track Time</span>
              )}
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Time Tracker</h4>
            {hasActiveEntry && (
              <span className={`text-2xl font-mono ${isRunning ? "text-primary" : "text-muted-foreground"}`}>
                {formatDuration(displayDuration)}
              </span>
            )}
          </div>

          {!hasActiveEntry && (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <Monitor className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">Start tracking from the desktop app</p>
              <p className="text-xs text-muted-foreground">
                Open the DocuFlow Desktop Agent, select a project and task, and start tracking there.
              </p>
            </div>
          )}
          {hasActiveEntry && activeEntry && (
            <>
              {activeEntry.status === "paused" && (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Timer is paused</span>
                </div>
              )}
              {/* Idle is a UI-only state (showIdleDialog), not a DB status */}
              {showIdleDialog && activeEntry.status === "running" && (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Inactivity detected — are you still working?</span>
                </div>
              )}

              <div className="bg-muted rounded-lg p-3">
                <div className="text-sm text-muted-foreground">Working on</div>
                <div className="font-medium truncate">
                  {activeProject?.project?.name || "Unknown Project"}
                </div>
                {activeEntry.description && (
                  <div className="text-sm text-muted-foreground truncate mt-1">
                    {activeEntry.description}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {isRunning ? (
                  <Button
                    onClick={handlePause}
                    variant="secondary"
                    className="flex-1 gap-2"
                    disabled={pauseMutationPending}
                    data-testid="button-pause-tracking"
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                ) : (
                  <Button
                    onClick={handleResume}
                    className="flex-1 gap-2"
                    disabled={resumeMutationPending}
                    data-testid="button-resume-tracking"
                  >
                    <Play className="h-4 w-4" />
                    Resume
                  </Button>
                )}
                <Button
                  onClick={handleStop}
                  variant="destructive"
                  className="flex-1 gap-2"
                  disabled={stopMutationPending}
                  data-testid="button-stop-tracking"
                >
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              </div>

              {isPaused && (
                <div className="text-sm text-center text-muted-foreground">
                  Timer is paused
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>

    <AlertDialog open={showIdleDialog} onOpenChange={setShowIdleDialog}>
      <AlertDialogContent data-testid="dialog-idle-check">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-amber-500" />
            Are you still working?
          </AlertDialogTitle>
          <AlertDialogDescription>
            No activity detected for the last 3 minutes. The timer will stop automatically in {idleCountdown} seconds if there's no response.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={handleNotWorking}
            data-testid="button-idle-no"
          >
            No, stop timer
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleStillWorking}
            data-testid="button-idle-yes"
          >
            Yes, still working
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
