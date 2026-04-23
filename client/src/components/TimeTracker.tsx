import { useState } from "react";
import { Link } from "wouter";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Pause, Square, Clock, ChevronDown, ChevronUp, AlertCircle, Monitor, Loader2 } from "lucide-react";

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
    isCapturing,
    captureError,
    startMutationPending,
    pauseMutationPending,
    resumeMutationPending,
    stopMutationPending,
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
  } = useTimeTracker();

  const activeProject = projects.find(p => p.id === activeEntry?.crmProjectId);

  function projectLabel(p: { id: string; project?: { name?: string | null } | null; name?: string | null }) {
    return p.project?.name || p.name || "Unnamed project";
  }

  if (isLoadingActive) {
    return null;
  }

  return (
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

          {!hasActiveEntry && !requiresTaskForStart && (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <Monitor className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">Start tracking from the desktop app</p>
              <p className="text-xs text-muted-foreground">
                Open the DocuFlow Desktop Agent, select a project and task, and start tracking there.
              </p>
            </div>
          )}
          {!hasActiveEntry && requiresTaskForStart && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Project</Label>
                <Select
                  value={selectedProjectId || undefined}
                  onValueChange={(id) => {
                    setSelectedProjectId(id);
                    setSelectedTaskId("");
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {projectLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Task</Label>
                <Select
                  value={selectedTaskId || undefined}
                  onValueChange={setSelectedTaskId}
                  disabled={!selectedProjectId || isTasksListLoading || taskStartBlockedReason === "no_tasks"}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={isTasksListLoading ? "Loading tasks…" : "Select a task"} />
                  </SelectTrigger>
                  <SelectContent>
                    {tasks
                      .filter((t) => t.status !== "archived")
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Description (optional)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What are you working on?"
                  className="h-9"
                />
              </div>
              {taskStartBlockedReason === "no_tasks" && selectedProjectId && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Create a task before starting the timer.{" "}
                  <Link href="/time-tracking/projects" className="text-primary underline underline-offset-2">
                    Open Projects &amp; Tasks
                  </Link>
                </p>
              )}
              {taskStartBlockedReason === "no_task_selected" && (
                <p className="text-xs text-muted-foreground">Select a task to start tracking.</p>
              )}
              {taskStartBlockedReason === "loading" && selectedProjectId && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading tasks…
                </p>
              )}
              <Button
                className="w-full"
                onClick={() => handleStart()}
                disabled={!!taskStartBlockedReason || startMutationPending || !selectedProjectId}
                data-testid="button-start-tracking-web"
              >
                {startMutationPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start
                  </>
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                You can also start from the{" "}
                <span className="font-medium text-foreground/80">Desktop Agent</span> after picking the same project and task.
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
  );
}
