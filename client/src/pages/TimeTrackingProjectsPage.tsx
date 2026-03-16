import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TimeTrackingLayout } from "@/components/TimeTrackingLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Plus, Pencil, Trash2, Check, X, Archive, FolderOpen } from "lucide-react";

interface CrmProject {
  id: string;
  project?: { name: string } | null;
  name?: string;
}

interface Task {
  id: string;
  name: string;
  crmProjectId: string;
  status: string;
  createdAt: string | null;
}

function getProjectName(p: CrmProject): string {
  return p.project?.name || p.name || "Unnamed Project";
}

export default function TimeTrackingProjectsPage() {
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  const { data: projectsData, isLoading: projectsLoading } = useQuery<any>({
    queryKey: ["/api/crm/projects"],
  });

  const projects: CrmProject[] = Array.isArray(projectsData)
    ? projectsData
    : projectsData?.data ?? [];

  const { data: tasksData, isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks", selectedProjectId],
    queryFn: () =>
      apiRequest("GET", `/api/tasks?crmProjectId=${selectedProjectId}`).then((r) => r.json?.() ?? r),
    enabled: !!selectedProjectId,
  });

  const tasks = Array.isArray(tasksData) ? tasksData : [];
  const activeTasks = tasks.filter((t) => t.status !== "archived");
  const archivedTasks = tasks.filter((t) => t.status === "archived");

  const createTaskMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/tasks", { crmProjectId: selectedProjectId, name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", selectedProjectId] });
      setNewTaskName("");
      toast({ title: "Task created" });
    },
    onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Task> }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", selectedProjectId] });
      setEditingTaskId(null);
    },
    onError: () => toast({ title: "Failed to update task", variant: "destructive" }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", selectedProjectId] });
      setDeleteTaskId(null);
      toast({ title: "Task deleted" });
    },
    onError: () => toast({ title: "Failed to delete task", variant: "destructive" }),
  });

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  function handleCreateTask() {
    const name = newTaskName.trim();
    if (!name || !selectedProjectId) return;
    createTaskMutation.mutate(name);
  }

  function startEdit(task: Task) {
    setEditingTaskId(task.id);
    setEditingName(task.name);
  }

  function saveEdit(id: string) {
    const name = editingName.trim();
    if (!name) return;
    updateTaskMutation.mutate({ id, data: { name } });
  }

  function archiveTask(id: string) {
    updateTaskMutation.mutate({ id, data: { status: "archived" } });
  }

  function restoreTask(id: string) {
    updateTaskMutation.mutate({ id, data: { status: "active" } });
  }

  return (
    <TimeTrackingLayout>
      <div className="flex h-full overflow-hidden">
        {/* Left: Projects */}
        <div className="w-64 border-r flex flex-col shrink-0">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Projects</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {projectsLoading ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : projects.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
                No projects found
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedProjectId === project.id
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted text-foreground"
                    }`}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    {getProjectName(project)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Tasks */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedProjectId ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Select a project</p>
                <p className="text-sm mt-1">Choose a project to view and manage its tasks</p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold">
                  {selectedProject ? getProjectName(selectedProject) : ""}
                </h2>
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <Input
                    placeholder="New task name…"
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateTask()}
                    className="h-8 text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleCreateTask}
                    disabled={!newTaskName.trim() || createTaskMutation.isPending}
                    className="h-8 px-3 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {tasksLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : activeTasks.length === 0 && archivedTasks.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    No tasks yet. Add one above.
                  </div>
                ) : (
                  <>
                    {activeTasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-md border hover:bg-muted/50 group"
                      >
                        {editingTaskId === task.id ? (
                          <>
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(task.id);
                                if (e.key === "Escape") setEditingTaskId(null);
                              }}
                              className="h-7 text-sm flex-1"
                              autoFocus
                            />
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(task.id)}>
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingTaskId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm">{task.name}</span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(task)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => archiveTask(task.id)}>
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTaskId(task.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}

                    {archivedTasks.length > 0 && (
                      <>
                        <div className="pt-4 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Archived ({archivedTasks.length})
                        </div>
                        {archivedTasks.map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-md border opacity-50 hover:opacity-75 group"
                          >
                            <span className="flex-1 text-sm line-through">{task.name}</span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => restoreTask(task.id)}>
                                <Check className="h-3.5 w-3.5 text-green-600" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTaskId(task.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={!!deleteTaskId} onOpenChange={(open) => !open && setDeleteTaskId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The task will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTaskId && deleteTaskMutation.mutate(deleteTaskId)}
              disabled={deleteTaskMutation.isPending}
            >
              {deleteTaskMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TimeTrackingLayout>
  );
}
