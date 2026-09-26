import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  CrmProjectStageHistoryWithUser,
  CrmTag,
  CrmProjectWithDetails,
  CrmProjectNoteWithCreator,
  CrmModuleField,
  Document,
  ProjectDailyUpdateWithDetails,
  SafeUser,
  Task,
  TimeEntryWithDetails,
  Reminder,
} from "@shared/schema";
import { V2AudioRecorder, V2NoteAudioPlayer } from "./V2NoteAudio";
import { chromeRefusal } from "./chrome";
import {
  composeDossier,
  DOSSIER_FIELD,
  documentDuplicatePath,
  documentsReorderPath,
  projectClonePath,
  projectDocumentationPath,
  projectMemberPath,
  projectStageHistoryPath,
  projectTagPath,
  projectTagsPath,
  tagPath,
  tagsPath,
  type DossierDailyUpdate,
  type DossierDocument,
  type DossierEmptyState,
  type DossierInput,
  type DossierModel,
  type DossierProject,
  type DossierSettingRow,
  type DossierTask,
  type DossierTimeEntry,
} from "./dossier";
import { TaskCheckIcon, type EmptyStateIconId } from "./icons";
import { motionForSurface } from "./motion";
import { meterTone, swatchStyle } from "./palette";
import { matchV2Route } from "./presentation";
import { composeBudgetForm, projectBudgetDraft, type ProjectBudgetDraft } from "./projects";
import { TASK_STATUS_OPTIONS } from "./tasks";
import { memberName } from "./today";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2EmptyState } from "./V2EmptyState";
import { V2FormDialog } from "./V2FormDialog";
import { V2RowMenu } from "./V2RowMenu";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SkeletonRecordHead, SkeletonSection } from "./V2Skeleton";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type TimeStats = { totalDuration: number };
type TimeEntriesResponse = { data: TimeEntryWithDetails[] };
type ScreenshotRow = {
  id: string;
  capturedAt: Date | string | null;
  userId: string;
  deletedAt?: Date | string | null;
};
type DailyUpdatesQuery = {
  capabilityMiss: boolean;
  latest: ProjectDailyUpdateWithDetails | null;
  rows: ProjectDailyUpdateWithDetails[];
};

type NoteAttachment = { url: string; filename: string; filesize: number; filetype: string };

/** The note route stores what v1's note composer uploaded: a `/public-objects/…` path per File. */
async function uploadNoteAttachment(file: File): Promise<NoteAttachment> {
  const slot = await apiRequest("POST", "/api/objects/upload-public");
  const { uploadURL, publicPath } = slot as { uploadURL: string; publicPath: string };
  const filetype = file.type || "application/octet-stream";
  const uploaded = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": filetype } });
  if (!uploaded.ok) throw new Error(`Failed to upload ${file.name}`);
  return { url: publicPath, filename: file.name, filesize: file.size, filetype };
}

const LIVE_PROJECT_STATUSES = new Set(["active", "on_hold", "in_review", "completed"]);
const TAB_MOTION = motionForSurface("dossier-tab-swap").enterExit;
const FILE_OPEN_MOTION = motionForSurface("dossier-file-open").enterExit;
function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function statsUrl(crmProjectId: string, start: Date, end: Date): string {
  const params = new URLSearchParams({
    crmProjectId,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  });
  return `/api/time-tracking/stats?${params.toString()}`;
}

function toDossierProject(project: CrmProjectWithDetails): DossierProject {
  return {
    id: project.id,
    projectStatus: project.projectStatus,
    projectType: project.projectType,
    budgetedHours: project.budgetedHours,
    budgetedMinutes: project.budgetedMinutes,
    actualHours: project.actualHours,
    updatedAt: project.updatedAt,
    startDate: project.startDate,
    dueDate: project.dueDate,
    documentationEnabled: project.documentationEnabled,
    project: project.project ? { id: project.project.id, name: project.project.name } : null,
    client: project.client
      ? {
          id: project.client.id,
          name: project.client.name,
          contacts: (project.client.contacts ?? []).map((contact) => ({
            id: contact.id,
            name: contact.name,
            role: contact.role,
          })),
        }
      : null,
    assignee: project.assignee
      ? {
          id: project.assignee.id,
          firstName: project.assignee.firstName,
          lastName: project.assignee.lastName,
          email: project.assignee.email,
        }
      : null,
    members: (project.members ?? []).map((member) => ({
      user: member.user
        ? {
            id: member.user.id,
            firstName: member.user.firstName,
            lastName: member.user.lastName,
            email: member.user.email,
          }
        : null,
    })),
  };
}

function toDossierTask(task: Task): DossierTask {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function toDossierDocument(document: Document): DossierDocument {
  return {
    id: document.id,
    title: document.title,
    updatedAt: document.updatedAt,
    projectId: document.projectId,
    parentId: document.parentId,
    position: document.position,
    access: "access" in document ? ((document as { access?: string | null }).access ?? null) : null,
  };
}

function toDossierDailyUpdate(update: ProjectDailyUpdateWithDetails): DossierDailyUpdate {
  return {
    id: update.id,
    whatHappened: update.whatHappened,
    whatWasDone: update.whatWasDone,
    nextSteps: update.nextSteps,
    blockageType: update.blockageType,
    waitingOnClient: update.waitingOnClient,
    updateDate: update.updateDate,
    createdAt: update.createdAt,
    user: update.user
      ? {
          id: update.user.id,
          firstName: update.user.firstName,
          lastName: update.user.lastName,
          email: update.user.email,
        }
      : null,
  };
}

function toDossierTimeEntry(entry: TimeEntryWithDetails): DossierTimeEntry {
  return {
    id: entry.id,
    duration: entry.duration ?? 0,
    startTime: entry.startTime,
    userId: entry.userId,
    taskId: entry.taskId,
    status: entry.status,
    description: entry.description,
    user: entry.user
      ? {
          id: entry.user.id,
          firstName: entry.user.firstName,
          lastName: entry.user.lastName,
          email: entry.user.email,
        }
      : null,
  };
}

function filesFromNotes(notes: CrmProjectNoteWithCreator[]) {
  return notes.flatMap((note) => {
    if (!note.attachments) return [];
    try {
      const attachments = JSON.parse(note.attachments) as Array<{ url: string; filename: string }>;
      return attachments.map((attachment, index) => ({
        id: `${note.id}-${index}`,
        title: attachment.filename,
        updatedAt: note.createdAt,
        href: attachment.url,
      }));
    } catch {
      return [];
    }
  });
}

export function V2DossierPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const projectId = match.kind === "dossier" ? match.projectId : "";
  const tab = match.kind === "dossier" ? match.tab : "overview";
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { memberships } = useV2Chrome();
  const { isRunning, activeEntry, handleStart, setSelectedProjectId } = useTimeTracker();
  const monthStart = useMemo(() => startOfMonth(now), [now]);
  const dayEnd = useMemo(() => endOfDay(now), [now]);
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
  const [taskName, setTaskName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [recordingNote, setRecordingNote] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderDueAt, setReminderDueAt] = useState("");
  const [noteAttachments, setNoteAttachments] = useState<NoteAttachment[]>([]);
  const [attachingNote, setAttachingNote] = useState(false);
  const [tagName, setTagName] = useState("");
  const [budgetDraft, setBudgetDraft] = useState<ProjectBudgetDraft>(projectBudgetDraft(null));
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [documentName, setDocumentName] = useState("");
  const [creatingNote, setCreatingNote] = useState(false);
  const [creatingReminder, setCreatingReminder] = useState(false);
  const [, navigate] = useLocation();

  const { data: project, isLoading: projectLoading } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects/${projectId}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch Project");
      return res.json();
    },
  });

  const { data: tasksResponse } = useQuery<{ data: Task[] }>({
    queryKey: ["/api/tasks", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      fetch(`/api/tasks?crmProjectId=${projectId}`, { credentials: "include" }).then((res) => res.json()),
  });

  const projectRecordId = project?.project?.id;
  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["/api/projects", projectRecordId, "documents"],
    enabled: Boolean(projectRecordId),
    queryFn: () =>
      fetch(`/api/projects/${projectRecordId}/documents`, { credentials: "include" }).then((res) =>
        res.json(),
      ),
  });

  const { data: dailyUpdates } = useQuery<DailyUpdatesQuery>({
    queryKey: ["/api/admin/daily-updates", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/admin/daily-updates?crmProjectId=${projectId}`, {
        credentials: "include",
      });
      if (res.status === 401 || res.status === 403) return { capabilityMiss: true, latest: null, rows: [] };
      if (!res.ok) return { capabilityMiss: false, latest: null, rows: [] };
      const rows = (await res.json()) as ProjectDailyUpdateWithDetails[];
      const sorted = [...rows].sort((a, b) => {
        const aTime = new Date(a.updateDate ?? a.createdAt ?? 0).getTime();
        const bTime = new Date(b.updateDate ?? b.createdAt ?? 0).getTime();
        return bTime - aTime;
      });
      return { capabilityMiss: false, latest: sorted[0] ?? null, rows: sorted };
    },
  });

  const { data: monthStats } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", "dossier", projectId, monthStart.toISOString()],
    enabled: Boolean(projectId),
    queryFn: () =>
      fetch(statsUrl(projectId, monthStart, dayEnd), { credentials: "include" }).then((res) => res.json()),
  });

  const screenshotLimit = tab === "activity" ? 50 : 8;
  const { data: screenshotPage } = useQuery<{ data: ScreenshotRow[] }>({
    queryKey: ["/api/time-tracking/screenshots", projectId, screenshotLimit],
    enabled: Boolean(projectId),
    queryFn: () =>
      fetch(`/api/time-tracking/screenshots?crmProjectId=${projectId}&limit=${screenshotLimit}`, {
        credentials: "include",
      }).then((res) => res.json()),
  });

  const { data: timeEntriesResponse } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time-tracking/entries", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      fetch(`/api/time-tracking/entries?crmProjectId=${projectId}`, { credentials: "include" }).then((res) =>
        res.json(),
      ),
  });

  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: projectsResponse } = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500", { credentials: "include" }).then((res) => res.json()),
  });
  const { data: notes = [] } = useQuery<CrmProjectNoteWithCreator[]>({
    queryKey: ["/api/crm/projects", projectId, "notes"],
    enabled: Boolean(projectId),
    queryFn: () => apiRequest("GET", `/api/crm/projects/${projectId}/notes`),
  });
  const { data: reminders = [] } = useQuery<Reminder[]>({
    queryKey: ["/api/crm/projects", projectId, "reminders"],
    enabled: Boolean(projectId),
    queryFn: () => apiRequest("GET", `/api/crm/projects/${projectId}/reminders`),
  });
  const { data: stageHistory = [] } = useQuery<CrmProjectStageHistoryWithUser[]>({
    queryKey: [projectStageHistoryPath(projectId)],
    enabled: Boolean(projectId),
    queryFn: () => apiRequest("GET", projectStageHistoryPath(projectId)),
  });
  const { data: projectTags = [] } = useQuery<CrmTag[]>({
    queryKey: [projectTagsPath(projectId)],
    enabled: Boolean(projectId),
    queryFn: () => apiRequest("GET", projectTagsPath(projectId)),
  });
  const { data: workspaceTags = [] } = useQuery<CrmTag[]>({
    queryKey: [tagsPath()],
    queryFn: () => apiRequest("GET", tagsPath()),
  });
  useEffect(() => {
    setProjectName(project?.project?.name ?? "");
    setWriteRefusal(null);
  }, [project?.id, project?.project?.name]);
  useEffect(() => {
    setBudgetDraft(projectBudgetDraft(project));
  }, [project?.id, project?.budgetedHours, project?.budgetedMinutes]);

  const ownerName = useWorkspaceOwnerName();

  function refuseWrite(errorMessage?: string, capability = "Manage Projects") {
    if (readOnly) {
      setWriteRefusal(
        chromeRefusal({
          kind: "workspace-condition",
          workspaceName,
          condition: "Read-only",
        }),
      );
      return true;
    }
    if (errorMessage) {
      setWriteRefusal(
        /permission denied|not authorized|access denied|forbidden/i.test(errorMessage)
          ? chromeRefusal({ kind: "capability", capability, ownerName })
          : chromeRefusal({ kind: "generic", message: errorMessage }),
      );
    }
    return false;
  }

  const completeTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", projectId] });
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      refuseWrite(error.message, "Manage Tasks");
    },
  });

  const createTask = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/tasks", { crmProjectId: projectId, name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", projectId] });
      setTaskName("");
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      refuseWrite(error.message, "Manage Tasks");
    },
  });

  const patchProject = useMutation({
    mutationFn: (data: { projectName?: string; assigneeId?: string | null }) =>
      apiRequest("PATCH", `/api/crm/projects/${projectId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId] });
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  const saveBudget = useMutation({
    mutationFn: (budget: { budgetedHours: number | null; budgetedMinutes: number }) =>
      apiRequest("PATCH", `/api/crm/projects/${projectId}`, budget),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      invalidateProject();
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  const deleteProject = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/crm/projects/${projectId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      invalidateProject();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all-kanban"] });
      setWriteRefusal(null);
      navigate("/projects");
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const createDocument = useMutation({
    mutationFn: (title: string) => {
      if (!projectRecordId) throw new Error("This Project has no Documents yet.");
      return apiRequest("POST", `/api/projects/${projectRecordId}/documents`, {
        title,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      });
    },
    onSuccess: (created: { id?: string }) => {
      invalidateDocuments();
      setCreatingDocument(false);
      setDocumentName("");
      setWriteRefusal(null);
      if (created?.id) navigate(`/document/${created.id}`);
    },
    onError: (error: Error) => refuseWrite(error.message, "Manage Project Documents"),
  });

  const addMember = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("POST", `/api/crm/projects/${projectId}/members`, { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId] });
      setMemberId("");
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      refuseWrite(error.message);
    },
  });

  const createNote = useMutation({
    mutationFn: (body: {
      content: string;
      audioUrl?: string;
      audioRecordingId?: string;
      transcriptStatus?: string;
      attachments?: NoteAttachment[];
    }) =>
      apiRequest("POST", `/api/crm/projects/${projectId}/notes`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId, "notes"] });
      setNoteContent("");
      setNoteAttachments([]);
      setRecordingNote(false);
      setWriteRefusal(null);
      setCreatingNote(false);
    },
    onError: (error: Error) => refuseWrite(error.message, "Manage Project Notes"),
  });
  const deleteNote = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/projects/${projectId}/notes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId, "notes"] }),
    onError: (error: Error) => refuseWrite(error.message, "Manage Project Notes"),
  });
  const createReminder = useMutation({
    mutationFn: () => apiRequest("POST", `/api/crm/projects/${projectId}/reminders`, {
      title: reminderTitle.trim(),
      note: reminderNote.trim() || null,
      dueAt: new Date(reminderDueAt).toISOString(),
      taskId: null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId, "reminders"] });
      setReminderTitle(""); setReminderNote(""); setReminderDueAt(""); setWriteRefusal(null);
      setCreatingReminder(false);
    },
    onError: (error: Error) => refuseWrite(error.message, "Manage Reminders"),
  });
  const setReminderStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiRequest("PATCH", `/api/reminders/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId, "reminders"] }),
    onError: (error: Error) => refuseWrite(error.message, "Manage Reminders"),
  });
  const updateReminder = useMutation({
    mutationFn: ({ id, title, note, dueAt }: { id: string; title: string; note: string; dueAt: string }) =>
      apiRequest("PATCH", `/api/reminders/${id}`, { title, note, dueAt: new Date(dueAt).toISOString() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId, "reminders"] }),
    onError: (error: Error) => refuseWrite(error.message, "Manage Reminders"),
  });
  const deleteReminder = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/reminders/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId, "reminders"] }),
    onError: (error: Error) => refuseWrite(error.message, "Manage Reminders"),
  });

  function invalidateProject() {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", projectId] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all"] });
  }

  const removeMember = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", projectMemberPath(projectId, userId)),
    onSuccess: () => {
      invalidateProject();
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const toggleDocumentation = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("PATCH", projectDocumentationPath(projectId), { enabled }),
    onSuccess: () => {
      invalidateProject();
      queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"] });
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const cloneProject = useMutation({
    mutationFn: () => apiRequest("POST", projectClonePath(projectId)),
    onSuccess: (created: { crmProject?: { id?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all-kanban"] });
      setWriteRefusal(null);
      if (created?.crmProject?.id) navigate(`/projects/${created.crmProject.id}/settings`);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  function invalidateTags() {
    queryClient.invalidateQueries({ queryKey: [tagsPath()] });
    queryClient.invalidateQueries({ queryKey: [projectTagsPath(projectId)] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all"] });
  }

  const setTagAttached = useMutation({
    mutationFn: ({ id, attached }: { id: string; attached: boolean }) =>
      apiRequest(attached ? "POST" : "DELETE", projectTagPath(projectId, id)),
    onSuccess: () => {
      invalidateTags();
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  // A new Tag is made for this Project, so it is attached as it is created.
  const createTag = useMutation({
    mutationFn: async (name: string) => {
      const created = (await apiRequest("POST", tagsPath(), { name })) as CrmTag;
      await apiRequest("POST", projectTagPath(projectId, created.id));
      return created;
    },
    onSuccess: () => {
      invalidateTags();
      setTagName("");
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const updateTag = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name: string; color: string }) =>
      apiRequest("PATCH", tagPath(id), { name, color }),
    onSuccess: () => {
      invalidateTags();
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const deleteTag = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", tagPath(id)),
    onSuccess: () => {
      invalidateTags();
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  function invalidateDocuments() {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectRecordId, "documents"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"] });
  }

  const duplicateDocument = useMutation({
    mutationFn: (documentId: string) => apiRequest("POST", documentDuplicatePath(documentId)),
    onSuccess: () => {
      invalidateDocuments();
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message, "Manage Project Documents"),
  });

  const reorderDocument = useMutation({
    mutationFn: (move: { documentId: string; newParentId: string | null; newPosition: number }) => {
      if (!projectRecordId) throw new Error("This Project has no Documents yet.");
      return apiRequest("POST", documentsReorderPath(projectRecordId), move);
    },
    onSuccess: () => {
      invalidateDocuments();
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message, "Manage Project Documents"),
  });

  async function attachNoteFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (refuseWrite()) return;
    setAttachingNote(true);
    try {
      const uploaded: NoteAttachment[] = [];
      for (const file of Array.from(files)) uploaded.push(await uploadNoteAttachment(file));
      setNoteAttachments((current) => [...current, ...uploaded]);
      setWriteRefusal(null);
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Failed to upload File");
    } finally {
      setAttachingNote(false);
    }
  }

  async function uploadAudioNote(audioBlob: Blob) {
    if (refuseWrite()) return;
    setUploadingAudio(true);
    try {
      const uploadSlot = await apiRequest("POST", "/api/objects/upload");
      const uploaded = await fetch(uploadSlot.uploadURL, { method: "PUT", body: audioBlob, headers: { "Content-Type": "audio/webm" }, credentials: "include" });
      if (!uploaded.ok) throw new Error("Failed to upload audio");
      const audio = await apiRequest("POST", "/api/audio/upload", { audioUrl: uploadSlot.objectPath });
      createNote.mutate({ content: "Voice note", audioUrl: audio.audioUrl, audioRecordingId: audio.id, transcriptStatus: audio.transcriptStatus });
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Failed to upload audio");
    } finally {
      setUploadingAudio(false);
    }
  }

  const clientId = project?.clientId;
  const clientActiveProjectCount = (projectsResponse?.data ?? []).filter(
    (row) => row.clientId && row.clientId === clientId && LIVE_PROJECT_STATUSES.has(row.projectStatus),
  ).length;

  const input: DossierInput = {
    now,
    currentUserId: user?.id ?? "",
    tab,
    project: project ? toDossierProject(project) : null,
    tasks: (tasksResponse?.data ?? []).map(toDossierTask),
    documents: documents.map(toDossierDocument),
    dailyUpdate: dailyUpdates?.latest ? toDossierDailyUpdate(dailyUpdates.latest) : null,
    dailyUpdateCapabilityMiss: dailyUpdates?.capabilityMiss === true,
    ownerName,
    monthSeconds: monthStats?.totalDuration ?? 0,
    screenshots: screenshotPage?.data ?? [],
    users: users.map((member) => ({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
    })),
    trackingTaskId:
      isRunning && activeEntry?.crmProjectId === projectId ? (activeEntry.taskId ?? null) : null,
    timerRunningHere: isRunning && activeEntry?.crmProjectId === projectId,
    clientActiveProjectCount,
    timeEntries: (timeEntriesResponse?.data ?? []).map(toDossierTimeEntry),
    dailyUpdates: (dailyUpdates?.rows ?? []).map(toDossierDailyUpdate),
    files: filesFromNotes(notes),
    reminders,
    notes,
    stageHistory: stageHistory.map((change) => ({
      id: change.id,
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      changedAt: change.changedAt,
      changedBy: change.changedBy ?? null,
    })),
    tags: projectTags,
    workspaceTags,
  };
  const dossier = composeDossier(input);
  const firstTodoTask = dossier.nextActions.rows.find((row) => !row.done);

  function onStartTimer() {
    if (!projectId) return;
    setSelectedProjectId(projectId);
    handleStart(projectId, firstTodoTask?.id);
  }

  function onCreateTask(event: FormEvent) {
    event.preventDefault();
    const name = taskName.trim();
    if (!name) return;
    if (refuseWrite()) return;
    createTask.mutate(name);
  }

  function onSaveName(event: FormEvent) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name || name === project?.project?.name) return;
    if (refuseWrite()) return;
    patchProject.mutate({ projectName: name });
  }

  function onAssignLead(assigneeId: string) {
    if (refuseWrite()) return;
    patchProject.mutate({ assigneeId: assigneeId || null });
  }

  function onAddMember(event: FormEvent) {
    event.preventDefault();
    if (!memberId) return;
    if (refuseWrite()) return;
    addMember.mutate(memberId);
  }

  function onSaveBudget(event: FormEvent) {
    event.preventDefault();
    const form = composeBudgetForm(budgetDraft, dossier.settings.budget.saved);
    if (!form.canSave || !form.payload) return;
    if (refuseWrite()) return;
    saveBudget.mutate(form.payload);
  }

  function onNewDocument() {
    if (refuseWrite()) return;
    setDocumentName("");
    setWriteRefusal(null);
    setCreatingDocument(true);
  }

  function onCreateDocument() {
    const title = documentName.trim();
    if (!title || refuseWrite()) return;
    createDocument.mutate(title);
  }

  function onNewNote() {
    if (refuseWrite()) return;
    setWriteRefusal(null);
    setCreatingNote(true);
  }

  function onCreateNote() {
    const content = noteContent.trim();
    if (!content || refuseWrite()) return;
    createNote.mutate({
      content,
      ...(noteAttachments.length > 0 ? { attachments: noteAttachments } : {}),
    });
  }

  function onNewReminder() {
    if (refuseWrite()) return;
    setWriteRefusal(null);
    setCreatingReminder(true);
  }

  function onCreateReminder() {
    if (!reminderTitle.trim() || !reminderDueAt || refuseWrite()) return;
    createReminder.mutate();
  }

  if (match.kind !== "dossier") {
    return null;
  }

  if (projectLoading) {
    return (
      <div data-testid="v2-dossier" aria-busy="true">
        <SkeletonRecordHead />
        <p className="df-sr-only" role="status">
          Loading this Project.
        </p>
        <div className="df-dossier-body">
          <div className="df-overview">
            <div className="df-stack">
              <SkeletonSection title="Next actions" lines={4} />
              <SkeletonSection title="Latest Daily Update" lines={3} />
            </div>
            <div className="df-stack">
              <SkeletonSection title="Budget & time" lines={3} />
              <SkeletonSection title="Project Documents" lines={3} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="v2-dossier">
      <header className="df-dossier-head">
        <div className="df-dossier-identity">
          <div className="df-dossier-copy">
            {dossier.identity ? (
              <>
                <div className="df-dossier-meta">
                  {dossier.identity.clientLabel ? (
                    <span className="df-mono df-meta">{dossier.identity.clientLabel}</span>
                  ) : null}
                  <span className="df-status">{dossier.identity.kindLabel}</span>
                </div>
                <div className="df-dossier-title-row">
                  <h1 className="df-record-title">{dossier.identity.title}</h1>
                  <span className="df-status" data-status={dossier.identity.status} data-swatch="" style={swatchStyle(dossier.identity.statusColor)}>
                    {dossier.identity.status}
                  </span>
                  {dossier.identity.tags.map((tag) => (
                    <span key={tag.id} className="df-tag-chip" data-testid={`v2-dossier-tag-${tag.id}`}>
                      {/* Per-instance: the swatch is this Tag's own colour. */}
                      <span className="df-tag-swatch" style={{ background: tag.color }} aria-hidden />
                      {tag.name}
                    </span>
                  ))}
                </div>
                <div className="df-dossier-provenance">
                  {dossier.identity.lead ? (
                    <span className="df-prov">
                      <span className="df-mono df-meta">PROJECT MANAGER</span>
                      <span className="df-avatar" data-self={dossier.identity.lead.self ? "true" : "false"}>
                        {dossier.identity.lead.initials}
                      </span>
                      <span>{dossier.identity.lead.name}</span>
                    </span>
                  ) : null}
                  {dossier.identity.team.length > 0 ? (
                    <span className="df-prov">
                      <span className="df-mono df-meta">TEAM</span>
                      <span className="df-avatar-stack">
                        {dossier.identity.team.map((member) => (
                          <span key={member.name} className="df-avatar" title={member.name}>
                            {member.initials}
                          </span>
                        ))}
                      </span>
                    </span>
                  ) : null}
                  {dossier.identity.updatedLabel ? (
                    <span className="df-mono df-meta">{dossier.identity.updatedLabel}</span>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h1 className="df-record-title">Project not found</h1>
                <p className="df-subhead">This Project is not in this Workspace.</p>
              </>
            )}
          </div>
          {dossier.identity ? (
            <div className="df-dossier-stats">
              <div className="df-stat">
                <div className="df-mono df-meta">BUDGET</div>
                <div className="df-stat-value">
                  {dossier.stats.budgetPercent == null ? "—" : `${dossier.stats.budgetPercent}%`}
                </div>
                {dossier.stats.budgetPercent != null ? (
                  <span className="df-meter df-meter-wide">
                    {/* Per-instance: the fill width is this project's budget share. */}
                    <span
                      className="df-meter-fill"
                      data-tone={meterTone(dossier.stats.budgetPercent)}
                      style={{ width: `${Math.min(100, dossier.stats.budgetPercent)}%` }}
                    />
                  </span>
                ) : null}
              </div>
              <div className="df-stat">
                <div className="df-mono df-meta">TRACKED MTD</div>
                <div className="df-stat-value">{dossier.stats.trackedMtd}</div>
                {dossier.stats.planHours ? (
                  <div className="df-mono df-meta">OF {dossier.stats.planHours} PLAN</div>
                ) : null}
              </div>
              <div className="df-dossier-actions">
                <Button variant="outline" type="button" onClick={onStartTimer} className="df-btn">
                  Start Timer
                </Button>
                <Button asChild variant="default" className="df-btn"><Link href={`/projects/${projectId}/tasks`}>
                  New Task
                </Link></Button>
              </div>
            </div>
          ) : null}
        </div>
        {dossier.tabs.length > 0 ? (
          <nav className="df-tabs" aria-label="Project Dossier">
            {dossier.tabs.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="df-tab"
                data-active={item.active ? "true" : "false"}
              >
                {item.label}
                {item.count ? <span className="df-mono df-tab-count">{item.count}</span> : null}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <V2FormDialog
        open={creatingDocument}
        onOpenChange={(open) => {
          setCreatingDocument(open);
          if (!open) setWriteRefusal(null);
        }}
        title="New Document"
        description="A Project Document belongs to this Project and opens in the editor once created."
        submitLabel="Create Document"
        pending={createDocument.isPending}
        canSubmit={Boolean(documentName.trim())}
        onSubmit={onCreateDocument}
        refusal={writeRefusal}
        testId="v2-dossier-new-document"
      >
        <label className="df-daily-field">
          NAME
          <input
            type="text"
            value={documentName}
            autoFocus
            onChange={(event) => setDocumentName(event.target.value)}
            placeholder="Document name"
            aria-label="Document name"
          />
        </label>
      </V2FormDialog>

      <V2FormDialog
        open={creatingNote}
        onOpenChange={(open) => {
          setCreatingNote(open);
          if (!open) {
            setRecordingNote(false);
            setWriteRefusal(null);
          }
        }}
        title="New Note"
        description="A note keeps what was said or decided on this Project: typed, recorded as audio, or with Files attached."
        submitLabel="Add note"
        pending={createNote.isPending}
        canSubmit={Boolean(noteContent.trim()) && !attachingNote && !recordingNote}
        onSubmit={onCreateNote}
        refusal={writeRefusal}
        testId="v2-dossier-new-note"
      >
        {recordingNote ? (
          <V2AudioRecorder onRecordingComplete={uploadAudioNote} onCancel={() => setRecordingNote(false)} isUploading={uploadingAudio} />
        ) : (
          <label className="df-daily-field">
            NOTE
            <textarea
              id={DOSSIER_FIELD.note}
              value={noteContent}
              autoFocus
              onChange={(event) => setNoteContent(event.target.value)}
              aria-label="Project note"
            />
          </label>
        )}
        <div className="df-cluster">
          <Button variant="outline" type="button" onClick={() => setRecordingNote(true)} disabled={recordingNote} className="df-btn">
            Record audio
          </Button>
          {/* A File attached here lands on the Files tab once the note is added (#260). */}
          <Button asChild variant="outline" className="df-btn" aria-disabled={attachingNote}>
            <label>
              {attachingNote ? "Attaching…" : "Attach file"}
              <input
                type="file"
                multiple
                hidden
                disabled={attachingNote}
                aria-label="Attach file to note"
                onChange={(event) => {
                  attachNoteFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        {noteAttachments.length > 0 ? (
          <div className="df-note-attachments" data-testid="v2-dossier-note-attachments">
            {noteAttachments.map((attachment) => (
              <span key={attachment.url} className="df-tag-chip">
                {attachment.filename}
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="df-chip-remove"
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() =>
                    setNoteAttachments((current) => current.filter((item) => item.url !== attachment.url))
                  }
                >
                  ×
                </Button>
              </span>
            ))}
          </div>
        ) : null}
      </V2FormDialog>

      <V2FormDialog
        open={creatingReminder}
        onOpenChange={(open) => {
          setCreatingReminder(open);
          if (!open) setWriteRefusal(null);
        }}
        title="New Reminder"
        description="A Reminder brings something on this Project back at the time you choose: a call to make, a signature to chase."
        submitLabel="Add reminder"
        pending={createReminder.isPending}
        canSubmit={Boolean(reminderTitle.trim() && reminderDueAt)}
        onSubmit={onCreateReminder}
        refusal={writeRefusal}
        testId="v2-dossier-new-reminder"
      >
        <label className="df-daily-field">
          TITLE
          <input
            id={DOSSIER_FIELD.reminderTitle}
            type="text"
            value={reminderTitle}
            autoFocus
            onChange={(event) => setReminderTitle(event.target.value)}
            aria-label="Reminder title"
          />
        </label>
        <label className="df-daily-field">
          NOTE
          <textarea value={reminderNote} onChange={(event) => setReminderNote(event.target.value)} aria-label="Reminder note" />
        </label>
        <label className="df-daily-field">
          DUE
          <input
            type="datetime-local"
            value={reminderDueAt}
            onChange={(event) => setReminderDueAt(event.target.value)}
            aria-label="Reminder due date"
          />
        </label>
      </V2FormDialog>

      <div className="df-dossier-body">
        {writeRefusal && !creatingDocument && !creatingNote && !creatingReminder ? (
          <p className="df-refusal">{writeRefusal}</p>
        ) : null}
        {dossier.identity ? (
          <div
            key={dossier.tab}
            className={`df-dossier-pane df-dossier-${dossier.tab}`}
            data-motion={TAB_MOTION}
            data-testid={`v2-dossier-${dossier.tab}`}
          >
            {renderDossierTab({
              dossier,
              taskName,
              setTaskName,
              onCreateTask,
              createPending: createTask.isPending,
              onComplete: (id, status) => {
                if (refuseWrite()) return;
                completeTask.mutate({ id, status });
              },
              onStartTask: (taskId) => {
                setSelectedProjectId(projectId);
                handleStart(projectId, taskId);
              },
              onStartTimer,
              onNewDocument,
              budgetDraft,
              setBudgetDraft,
              onSaveBudget,
              budgetPending: saveBudget.isPending,
              onDeleteProject: () => { if (!refuseWrite()) deleteProject.mutate(); },
              deletePending: deleteProject.isPending,
              projectName,
              setProjectName,
              onSaveName,
              onAssignLead,
              memberId,
              setMemberId,
              onAddMember,
              users,
              memberPending: addMember.isPending,
              onNewNote,
              onDeleteNote: (id) => { if (!refuseWrite()) deleteNote.mutate(id); },
              onNewReminder,
              onSetReminderStatus: (id, status) => { if (!refuseWrite()) setReminderStatus.mutate({ id, status }); },
              onEditReminder: (id, draft) => { if (!refuseWrite()) updateReminder.mutate({ id, ...draft }); },
              onDeleteReminder: (id) => { if (!refuseWrite()) deleteReminder.mutate(id); },
              onRemoveMember: (id) => { if (!refuseWrite()) removeMember.mutate(id); },
              onToggleDocumentation: (enabled) => { if (!refuseWrite()) toggleDocumentation.mutate(enabled); },
              onClone: () => { if (!refuseWrite()) cloneProject.mutate(); },
              clonePending: cloneProject.isPending,
              tagName,
              setTagName,
              onCreateTag: (event) => {
                event.preventDefault();
                const name = tagName.trim();
                if (!name || refuseWrite()) return;
                createTag.mutate(name);
              },
              onSetTagAttached: (id, attached) => { if (!refuseWrite()) setTagAttached.mutate({ id, attached }); },
              onEditTag: (id, draft) => { if (!refuseWrite()) updateTag.mutate({ id, ...draft }); },
              onDeleteTag: (id) => { if (!refuseWrite()) deleteTag.mutate(id); },
              onDuplicateDocument: (id) => { if (!refuseWrite()) duplicateDocument.mutate(id); },
              onMoveDocument: (id, parentId, position) => {
                if (refuseWrite()) return;
                reorderDocument.mutate({ documentId: id, newParentId: parentId, newPosition: position });
              },
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderDossierTab(props: {
  dossier: DossierModel;
  taskName: string;
  setTaskName: (value: string) => void;
  onCreateTask: (event: FormEvent) => void;
  createPending: boolean;
  onComplete: (id: string, status: string) => void;
  onStartTask: (taskId: string) => void;
  onStartTimer: () => void;
  onNewDocument: () => void;
  budgetDraft: ProjectBudgetDraft;
  setBudgetDraft: (draft: ProjectBudgetDraft) => void;
  onSaveBudget: (event: FormEvent) => void;
  budgetPending: boolean;
  onDeleteProject: () => void;
  deletePending: boolean;
  projectName: string;
  setProjectName: (value: string) => void;
  onSaveName: (event: FormEvent) => void;
  onAssignLead: (assigneeId: string) => void;
  memberId: string;
  setMemberId: (value: string) => void;
  onAddMember: (event: FormEvent) => void;
  users: SafeUser[];
  memberPending: boolean;
  onNewNote: () => void;
  onDeleteNote: (id: string) => void;
  onNewReminder: () => void;
  onSetReminderStatus: (id: string, status: string) => void;
  onEditReminder: (id: string, draft: { title: string; note: string; dueAt: string }) => void;
  onDeleteReminder: (id: string) => void;
  onRemoveMember: (id: string) => void;
  onToggleDocumentation: (enabled: boolean) => void;
  onClone: () => void;
  clonePending: boolean;
  tagName: string;
  setTagName: (value: string) => void;
  onCreateTag: (event: FormEvent) => void;
  onSetTagAttached: (id: string, attached: boolean) => void;
  onEditTag: (id: string, draft: { name: string; color: string }) => void;
  onDeleteTag: (id: string) => void;
  onDuplicateDocument: (id: string) => void;
  onMoveDocument: (id: string, parentId: string | null, position: number) => void;
}): ReactNode {
  const { dossier } = props;
  if (dossier.tab === "tasks") return <DossierTasks {...props} />;
  if (dossier.tab === "time") return <DossierTime dossier={dossier} onStartTimer={props.onStartTimer} />;
  if (dossier.tab === "activity") return <DossierActivity dossier={dossier} onStartTimer={props.onStartTimer} />;
  if (dossier.tab === "updates") return <DossierUpdates dossier={dossier} />;
  if (dossier.tab === "notes") return <DossierNotes {...props} />;
  if (dossier.tab === "reminders") return <DossierReminders {...props} />;
  if (dossier.tab === "documents") return <DossierDocuments {...props} />;
  if (dossier.tab === "files") return <DossierFiles dossier={dossier} />;
  if (dossier.tab === "settings") return <DossierSettings {...props} />;
  return <DossierOverview {...props} />;
}

function DossierOverview({
  dossier,
  onComplete,
}: {
  dossier: DossierModel;
  onComplete: (id: string, status: string) => void;
}) {
  return (
    <div className="df-overview">
      <div className="df-stack">
        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Next actions</h2>
            <span className="df-mono df-meta">
              {dossier.nextActions.openCount} TO DO · {dossier.nextActions.blockedCount} BLOCKED
            </span>
          </div>
          {dossier.nextActions.empty ? (
            <p className="df-empty">{dossier.nextActions.emptyCopy}</p>
          ) : (
            dossier.nextActions.rows.map((row) => (
              <div key={row.id} className="df-task-row" data-done={row.done ? "true" : "false"}>
                <button
                  type="button"
                  className="df-check"
                  data-checked={row.done ? "true" : "false"}
                  aria-label={row.done ? "Mark Task as To do" : "Mark Task as Done"}
                  onClick={() => onComplete(row.id, row.done ? "open" : "done")}
                >
                  {row.done ? <TaskCheckIcon /> : null}
                </button>
                <span className="df-task-title">{row.title}</span>
                {row.flag ? (
                  <span className="df-flag" data-flag={row.flag}>
                    {row.flag}
                  </span>
                ) : null}
                {row.meta ? (
                  <span className="df-mono" style={{ fontSize: 11, color: row.done ? "var(--df-green-700)" : "var(--df-archive-slate)" }}>
                    {row.meta}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </section>

        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Latest Daily Update</h2>
            {dossier.dailyUpdate.meta ? (
              <span className="df-mono df-meta">{dossier.dailyUpdate.meta}</span>
            ) : null}
          </div>
          {dossier.dailyUpdate.kind === "refusal" ? (
            <p className="df-refusal">{dossier.dailyUpdate.copy}</p>
          ) : dossier.dailyUpdate.kind === "empty" ? (
            <p className="df-empty">{dossier.dailyUpdate.copy}</p>
          ) : (
            <div className="df-update-body">
              {dossier.dailyUpdate.prose ? <p className="df-prose">{dossier.dailyUpdate.prose}</p> : null}
              {dossier.dailyUpdate.blocker ? (
                <div className="df-blocker">
                  <div className="df-mono df-meta">BLOCKER</div>
                  <p className="df-prose">
                    {dossier.dailyUpdate.blocker}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Recent Activity Evidence</h2>
          </div>
          {dossier.evidence.empty ? (
            <p className="df-empty">{dossier.evidence.emptyCopy}</p>
          ) : (
            <div className="df-evidence-grid">
              {dossier.evidence.tiles.map((tile) => (
                <EvidenceTile key={tile.id} tile={tile} />
              ))}
            </div>
          )}
          <p className="df-empty" data-edge="end">
            {dossier.evidence.footnote}
          </p>
        </section>
      </div>

      <div className="df-stack">
        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Budget & time</h2>
          </div>
          <div className="df-card-body-stack">
            <div className="df-mono df-meta">CONSUMED {dossier.budgetTime.consumedLabel}</div>
            <span className="df-meter df-meter-lg">
              {/* Per-instance: the fill width is this project's budget share. */}
              <span
                className="df-meter-fill"
                data-tone={meterTone(dossier.budgetTime.percent)}
                style={{ width: `${Math.min(100, dossier.budgetTime.percent ?? 0)}%` }}
              />
            </span>
            <div className="df-spread">
              <span className="df-mono df-meta">
                {dossier.budgetTime.percent == null ? "—" : `${dossier.budgetTime.percent}% USED`}
              </span>
            </div>
            <div className="df-kv">
              <span>TRACKED THIS MONTH</span>
              <span>{dossier.budgetTime.trackedThisMonth}</span>
            </div>
            <div className="df-kv">
              <span>UNAPPROVED</span>
              <span>{dossier.budgetTime.unapproved ?? "—"}</span>
            </div>
          </div>
        </section>

        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Project Documents</h2>
            <span className="df-count-chip">{dossier.documents.count} DOCS</span>
          </div>
          {dossier.documents.empty ? (
            <p className="df-empty">{dossier.documents.emptyCopy}</p>
          ) : (
            dossier.documents.rows.map((row) => (
              <Link key={row.id} href={row.href} className="df-doc-row">
                <span className="df-row-title">{row.title}</span>
                <span className="df-mono df-meta">{row.meta}</span>
              </Link>
            ))
          )}
        </section>

        <section className="df-card" data-testid="v2-dossier-status-history">
          <div className="df-card-head">
            <h2 className="df-card-title">Status history</h2>
          </div>
          {dossier.history.empty ? (
            <p className="df-empty">{dossier.history.emptyCopy}</p>
          ) : (
            dossier.history.rows.map((row) => (
              <div key={row.id} className="df-history-row">
                <div className="df-history-move">
                  {row.from && row.fromColor ? (
                    <>
                      <span className="df-status" data-swatch="" style={swatchStyle(row.fromColor)}>{row.from}</span>
                      <span className="df-mono df-meta">→</span>
                    </>
                  ) : null}
                  <span className="df-status" data-swatch="" style={swatchStyle(row.toColor)}>{row.to}</span>
                </div>
                <div className="df-mono df-meta">
                  {row.when} · {row.who.toUpperCase()} · HELD {row.held.toUpperCase()}
                </div>
              </div>
            ))
          )}
        </section>

        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Client</h2>
          </div>
          {!dossier.client ? (
            <p className="df-empty">This is an Internal Project.</p>
          ) : (
            <div className="df-card-body-stack">
              <div className="df-cluster">
                <span className="df-tile" style={{ width: 30, height: 30, borderRadius: 6, fontSize: 11 }}>
                  {dossier.client.initials}
                </span>
                <div>
                  <div className="df-client-name">{dossier.client.name}</div>
                  <div className="df-mono df-meta">{dossier.client.meta}</div>
                </div>
              </div>
              {dossier.client.contacts.map((contact) => (
                <div key={contact.name} className="df-contact-row">
                  <span>{contact.name}</span>
                  {contact.role ? <span className="df-status">{contact.role}</span> : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Filed under this Project</h2>
          </div>
          <div className="df-filed">
            {dossier.filed.map((chip) => (
              <span key={chip.label} className="df-filed-chip">
                {chip.value} {chip.label}
              </span>
            ))}
          </div>
          {dossier.identity ? (
            <p className="df-empty">Every record above resolves to this Project in this Workspace.</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function DossierTasks({
  dossier,
  taskName,
  setTaskName,
  onCreateTask,
  createPending,
  onComplete,
  onStartTask,
}: {
  dossier: DossierModel;
  taskName: string;
  setTaskName: (value: string) => void;
  onCreateTask: (event: FormEvent) => void;
  createPending: boolean;
  onComplete: (id: string, status: string) => void;
  onStartTask: (taskId: string) => void;
}) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Tasks</h2>
        <span className="df-count-chip">{dossier.tasks.rows.length}</span>
      </div>
      <form className="df-filter-bar df-inset-bar" onSubmit={onCreateTask}>
        <label className="df-filter-input">
          <input
            id={DOSSIER_FIELD.taskName}
            type="text"
            value={taskName}
            onChange={(event) => setTaskName(event.target.value)}
            placeholder="Task name"
            aria-label="Task name"
          />
        </label>
        <Button variant="default" type="submit" disabled={createPending || !taskName.trim()} className="df-btn">
          Create
        </Button>
      </form>
      {dossier.tasks.assignees.length > 0 ? (
        <p className="df-mono df-meta df-inset-meta">
          PROJECT ASSIGNMENT · {dossier.tasks.assignees.map((member) => member.name).join(" · ")}
        </p>
      ) : null}
      {dossier.tasks.empty ? (
        <DossierEmptyStateView state={dossier.tasks.emptyState} icon="tasks" testId="v2-dossier-tasks-empty" />
      ) : (
        dossier.tasks.rows.map((row) => (
          <div key={row.id} className="df-task-row" data-done={row.done ? "true" : "false"}>
            <button
              type="button"
              className="df-check"
              data-checked={row.done ? "true" : "false"}
              aria-label={row.done ? "Mark Task as To do" : "Mark Task as Done"}
              onClick={() => onComplete(row.id, row.done ? "open" : "done")}
            >
              {row.done ? <TaskCheckIcon /> : null}
            </button>
            <span className="df-task-title">{row.title}</span>
            <span className="df-task-controls">
              <V2FilterSelect
                label=""
                ariaLabel={`Task status for ${row.title}`}
                value={row.statusValue}
                options={TASK_STATUS_OPTIONS}
                onChange={(status) => onComplete(row.id, status)}
              />
              {row.flag ? (
                <span className="df-flag" data-flag={row.flag}>
                  {row.flag}
                </span>
              ) : (
                <Button variant="outline" type="button" onClick={() => onStartTask(row.id)} className="df-btn">
                  Start Timer
                </Button>
              )}
            </span>
          </div>
        ))
      )}
    </section>
  );
}

/** Turns an empty tab's composed action into the one Button it offers. */
function DossierEmptyStateView({
  state,
  icon,
  testId,
  onStartTimer,
  onNewDocument,
  onCompose,
}: {
  state: DossierEmptyState;
  icon: EmptyStateIconId;
  testId: string;
  onStartTimer?: () => void;
  onNewDocument?: () => void;
  onCompose?: () => void;
}) {
  const { action } = state;
  let control: ReactNode = null;
  if (action?.kind === "compose" && onCompose) {
    control = (
      <Button variant="default" type="button" className="df-btn" onClick={onCompose}>
        {action.label}
      </Button>
    );
  } else if (action?.kind === "focus") {
    // The tab's own add form sits above and owns the primary fill.
    control = (
      <Button
        variant="outline"
        type="button"
        className="df-btn"
        onClick={() => document.getElementById(action.target)?.focus()}
      >
        {action.label}
      </Button>
    );
  } else if (action?.kind === "link") {
    control = (
      <Button asChild variant="default" className="df-btn">
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  } else if (action?.kind === "start-timer" && onStartTimer) {
    control = (
      <Button variant="default" type="button" className="df-btn" onClick={onStartTimer}>
        {action.label}
      </Button>
    );
  } else if (action?.kind === "new-document" && onNewDocument) {
    control = (
      <Button variant="default" type="button" className="df-btn" onClick={onNewDocument}>
        {action.label}
      </Button>
    );
  }
  return <V2EmptyState icon={icon} title={state.title} copy={state.copy} action={control} testId={testId} />;
}

function DossierTime({ dossier, onStartTimer }: { dossier: DossierModel; onStartTimer: () => void }) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Time Entries</h2>
        <span className="df-count-chip">{dossier.time.rows.length}</span>
      </div>
      {dossier.time.empty ? (
        <DossierEmptyStateView
          state={dossier.time.emptyState}
          icon="time"
          testId="v2-dossier-time-empty"
          onStartTimer={onStartTimer}
        />
      ) : (
        dossier.time.rows.map((row) => (
          <div key={row.id} className="df-register-row">
            <span className="df-row-title">{row.task}</span>
            <span className="df-mono df-meta">{row.who}</span>
            <span className="df-mono df-meta">{row.when}</span>
            <span className="df-mono df-meta">{row.duration}</span>
            <span className="df-status">{row.status}</span>
          </div>
        ))
      )}
    </section>
  );
}

function DossierActivity({ dossier, onStartTimer }: { dossier: DossierModel; onStartTimer: () => void }) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Activity Evidence</h2>
        <span className="df-count-chip">{dossier.evidence.tiles.length}</span>
      </div>
      {dossier.evidence.empty ? (
        <DossierEmptyStateView
          state={dossier.evidence.emptyState}
          icon="activity"
          testId="v2-dossier-activity-empty"
          onStartTimer={onStartTimer}
        />
      ) : (
        <>
          <div className="df-evidence-grid">
            {dossier.evidence.tiles.map((tile) => (
              <EvidenceTile key={tile.id} tile={tile} />
            ))}
          </div>
          <p className="df-empty" data-edge="end">
            {dossier.evidence.footnote}
          </p>
        </>
      )}
    </section>
  );
}

function DossierUpdates({ dossier }: { dossier: DossierModel }) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Daily Updates</h2>
        {dossier.updates.kind === "records" ? (
          <span className="df-count-chip">{dossier.updates.rows.length}</span>
        ) : null}
      </div>
      {dossier.updates.kind === "refusal" ? (
        <p className="df-refusal">{dossier.updates.copy}</p>
      ) : dossier.updates.kind === "empty" ? (
        <DossierEmptyStateView state={dossier.updates.emptyState} icon="updates" testId="v2-dossier-updates-empty" />
      ) : (
        dossier.updates.rows.map((row) => (
          <div key={row.id} className="df-update-body" style={{ borderBottom: "1px solid var(--df-divider-light)" }}>
            {row.meta ? <div className="df-mono df-meta">{row.meta}</div> : null}
            {row.prose ? <p className="df-prose">{row.prose}</p> : null}
            {row.blocker ? (
              <div className="df-blocker">
                <div className="df-mono df-meta">BLOCKER</div>
                <p className="df-prose">
                  {row.blocker}
                </p>
              </div>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

/** Notes are written in the New Note dialog; the tab lists them. */
function DossierNotes({
  dossier,
  onNewNote,
  onDeleteNote,
}: {
  dossier: DossierModel;
  onNewNote: () => void;
  onDeleteNote: (id: string) => void;
}) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Project notes</h2>
        <span className="df-cluster">
          <span className="df-count-chip">{dossier.notes.rows.length}</span>
          {!dossier.notes.empty ? (
            <Button variant="outline" type="button" onClick={onNewNote} className="df-btn">
              New Note
            </Button>
          ) : null}
        </span>
      </div>
      {dossier.notes.empty ? (
        <DossierEmptyStateView
          state={dossier.notes.emptyState}
          icon="notes"
          testId="v2-dossier-notes-empty"
          onCompose={onNewNote}
        />
      ) : null}
      {dossier.notes.rows.map((note) => (
        <article key={note.id} className="df-update-body">
          <div className="df-mono df-meta">{note.meta}</div>
          <p className="df-prose">{note.content}</p>
          {note.audioUrl ? <V2NoteAudioPlayer audioUrl={note.audioUrl} audioRecordingId={note.audioRecordingId ?? undefined} transcriptStatus={note.transcriptStatus ?? undefined} audioTranscript={note.audioTranscript ?? undefined} /> : null}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructiveOutline" type="button" className="df-btn" data-testid={`v2-dossier-delete-note-${note.id}`}>
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="df-v2 df-alert">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete note</AlertDialogTitle>
                <AlertDialogDescription>{note.deleteConsequence}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="df-btn" autoFocus>
                  Keep note
                </AlertDialogCancel>
                <AlertDialogAction
                  className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => onDeleteNote(note.id)}
                >
                  Delete note
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </article>
      ))}
    </section>
  );
}

/**
 * A Reminder is editable, not only completable: `PATCH /api/reminders/:id`
 * already takes title, note and dueAt, and a done one can go back to upcoming.
 * The row keeps its own draft so the panel does not carry per-row state.
 */
function ReminderRow({
  reminder,
  onSetStatus,
  onEdit,
  onDelete,
}: {
  reminder: DossierModel["reminders"]["rows"][number];
  onSetStatus: (id: string, status: string) => void;
  onEdit: (id: string, draft: { title: string; note: string; dueAt: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reminder.draft);

  function open() {
    setDraft(reminder.draft);
    setEditing(true);
  }

  if (editing) {
    return (
      <div className="df-register-row df-reminder-edit" data-testid={`v2-dossier-reminder-edit-${reminder.id}`}>
        <form
          className="df-admin-form df-daily-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.title.trim() || !draft.dueAt) return;
            onEdit(reminder.id, draft);
            setEditing(false);
          }}
        >
          <label className="df-daily-field">
            Title
            <input
              type="text"
              value={draft.title}
              aria-label="Reminder title"
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label className="df-daily-field">
            Note
            <input
              type="text"
              value={draft.note}
              aria-label="Reminder note"
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            />
          </label>
          <label className="df-daily-field">
            Due
            <input
              type="datetime-local"
              value={draft.dueAt}
              aria-label="Reminder due date"
              onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
            />
          </label>
          <div className="df-form-actions">
            <Button variant="outline" type="button" onClick={() => setEditing(false)} className="df-btn">
              Cancel
            </Button>
            <Button variant="default" type="submit" disabled={!draft.title.trim() || !draft.dueAt} className="df-btn">
              Save Reminder
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="df-register-row" data-done={reminder.done ? "true" : "false"}>
      <span>
        <span className="df-row-title">{reminder.title}</span>
        {reminder.note ? <span className="df-mono df-meta">{reminder.note}</span> : null}
      </span>
      <span className="df-mono df-meta">{reminder.due}</span>
      <span className="df-status">{reminder.status}</span>
      <span className="df-people-action">
        {reminder.canComplete ? (
          <Button variant="outline" type="button" onClick={() => onSetStatus(reminder.id, "done")} className="df-btn">
            Done
          </Button>
        ) : null}
        {reminder.canReopen ? (
          <Button variant="outline" type="button" onClick={() => onSetStatus(reminder.id, "upcoming")} className="df-btn">
            Reopen
          </Button>
        ) : null}
        <Button variant="outline" type="button" onClick={open} className="df-btn">
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructiveOutline" type="button" className="df-btn" data-testid={`v2-dossier-delete-reminder-${reminder.id}`}>
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="df-v2 df-alert">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Reminder</AlertDialogTitle>
              <AlertDialogDescription>{reminder.deleteConsequence}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="df-btn" autoFocus>
                Keep Reminder
              </AlertDialogCancel>
              <AlertDialogAction
                className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onDelete(reminder.id)}
              >
                Delete Reminder
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>
    </div>
  );
}

/** Reminders are added in the New Reminder dialog; the tab lists them. */
function DossierReminders({
  dossier,
  onNewReminder,
  onSetReminderStatus,
  onEditReminder,
  onDeleteReminder,
}: {
  dossier: DossierModel;
  onNewReminder: () => void;
  onSetReminderStatus: (id: string, status: string) => void;
  onEditReminder: (id: string, draft: { title: string; note: string; dueAt: string }) => void;
  onDeleteReminder: (id: string) => void;
}) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Reminders</h2>
        <span className="df-cluster">
          <span className="df-count-chip">{dossier.reminders.rows.length}</span>
          {!dossier.reminders.empty ? (
            <Button variant="outline" type="button" onClick={onNewReminder} className="df-btn">
              New Reminder
            </Button>
          ) : null}
        </span>
      </div>
      {dossier.reminders.empty ? (
        <DossierEmptyStateView
          state={dossier.reminders.emptyState}
          icon="reminders"
          testId="v2-dossier-reminders-empty"
          onCompose={onNewReminder}
        />
      ) : null}
      {dossier.reminders.rows.map((reminder) => (
        <ReminderRow
          key={reminder.id}
          reminder={reminder}
          onSetStatus={onSetReminderStatus}
          onEdit={onEditReminder}
          onDelete={onDeleteReminder}
        />
      ))}
    </section>
  );
}

/**
 * Duplicate and reorder sit in the row's overflow menu (#214): opening the
 * Document stays the row's primary action (#260).
 */
function DossierDocuments({
  dossier,
  onDuplicateDocument,
  onMoveDocument,
  onNewDocument,
}: {
  dossier: DossierModel;
  onDuplicateDocument: (id: string) => void;
  onMoveDocument: (id: string, parentId: string | null, position: number) => void;
  onNewDocument: () => void;
}) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Project Documents</h2>
        <span className="df-cluster">
          <span className="df-count-chip">{dossier.documents.count} DOCS</span>
          {dossier.documents.canCreate && !dossier.documents.empty ? (
            <Button variant="outline" type="button" onClick={onNewDocument} className="df-btn">
              New Document
            </Button>
          ) : null}
        </span>
      </div>
      {dossier.documents.empty ? (
        <DossierEmptyStateView
          state={dossier.documents.emptyState}
          icon="documents"
          testId="v2-dossier-documents-empty"
          onNewDocument={onNewDocument}
        />
      ) : (
        dossier.documents.rows.map((row) => {
          const { parentId, up, down } = row.order;
          return (
            <div key={row.id} className="df-doc-row" data-testid={`v2-dossier-document-${row.id}`}>
              <Link href={row.href} className="df-row-title df-doc-link">
                {row.title}
              </Link>
              <span className="df-mono df-meta">{row.meta}</span>
              <V2RowMenu
                ariaLabel={`Actions on ${row.title}`}
                testId={`v2-dossier-document-menu-${row.id}`}
                items={[
                  { label: "Duplicate", onSelect: () => onDuplicateDocument(row.id) },
                  {
                    label: "Move up",
                    disabled: up == null,
                    onSelect: () => { if (up != null) onMoveDocument(row.id, parentId, up); },
                  },
                  {
                    label: "Move down",
                    disabled: down == null,
                    onSelect: () => { if (down != null) onMoveDocument(row.id, parentId, down); },
                  },
                ]}
              />
            </div>
          );
        })
      )}
    </section>
  );
}

function DossierFiles({ dossier }: { dossier: DossierModel }) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Files</h2>
        <span className="df-count-chip">{dossier.files.rows.length}</span>
      </div>
      {dossier.files.empty ? (
        <DossierEmptyStateView state={dossier.files.emptyState} icon="files" testId="v2-dossier-files-empty" />
      ) : (
        dossier.files.rows.map((row) => {
          const body = (
            <>
              <span className="df-row-title">{row.title}</span>
              <span className="df-mono df-meta">{row.meta}</span>
            </>
          );
          // An object path is served by the backend, not routed by wouter:
          // <Link> would client-route it into the placeholder (#213).
          if (row.target === "file") {
            return (
              <a
                key={row.id}
                href={row.href}
                target="_blank"
                rel="noreferrer"
                className="df-doc-row df-file-row"
                data-motion={FILE_OPEN_MOTION}
                data-testid={`v2-dossier-file-${row.id}`}
              >
                {body}
              </a>
            );
          }
          if (row.target === "app") {
            return (
              <Link key={row.id} href={row.href} className="df-doc-row df-file-row" data-motion={FILE_OPEN_MOTION}>
                {body}
              </Link>
            );
          }
          return (
            <div key={row.id} className="df-doc-row" data-testid={`v2-dossier-file-${row.id}`}>
              {body}
            </div>
          );
        })
      )}
    </section>
  );
}

/** One label and its value, on the two columns every Settings group shares. */
function SettingRow({ row }: { row: DossierSettingRow }) {
  return (
    <div className="df-settings-row">
      <span className="df-settings-label">{row.label}</span>
      <span className="df-settings-value">
        {row.chip ? (
          row.swatch ? (
            <span className="df-status" data-swatch="" style={swatchStyle(row.swatch)}>
              {row.value}
            </span>
          ) : (
            <span className="df-status">{row.value}</span>
          )
        ) : (
          row.value
        )}
      </span>
    </div>
  );
}

function SettingsCard({
  title,
  sub,
  testId,
  danger,
  action,
  children,
}: {
  title: string;
  sub: string;
  testId: string;
  danger?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={danger ? "df-card df-settings-card df-settings-danger" : "df-card df-settings-card"} data-testid={testId}>
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">{title}</h2>
          <p className="df-card-sub">{sub}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Settings as labelled groups (#277): identity, lifecycle, budget, team,
 * documentation and the danger zone, each a card. Every group draws its rows
 * on the same two columns, so labels and values line up down the whole tab.
 */
function DossierSettings({
  dossier,
  projectName,
  setProjectName,
  onSaveName,
  onAssignLead,
  memberId,
  setMemberId,
  onAddMember,
  users,
  memberPending,
  onRemoveMember,
  onToggleDocumentation,
  onClone,
  clonePending,
  tagName,
  setTagName,
  onCreateTag,
  onSetTagAttached,
  onEditTag,
  onDeleteTag,
  budgetDraft,
  setBudgetDraft,
  onSaveBudget,
  budgetPending,
  onDeleteProject,
  deletePending,
}: {
  dossier: DossierModel;
  projectName: string;
  setProjectName: (value: string) => void;
  onSaveName: (event: FormEvent) => void;
  onAssignLead: (assigneeId: string) => void;
  memberId: string;
  setMemberId: (value: string) => void;
  onAddMember: (event: FormEvent) => void;
  users: SafeUser[];
  memberPending: boolean;
  onRemoveMember: (id: string) => void;
  onToggleDocumentation: (enabled: boolean) => void;
  onClone: () => void;
  clonePending: boolean;
  tagName: string;
  setTagName: (value: string) => void;
  onCreateTag: (event: FormEvent) => void;
  onSetTagAttached: (id: string, attached: boolean) => void;
  onEditTag: (id: string, draft: { name: string; color: string }) => void;
  onDeleteTag: (id: string) => void;
  budgetDraft: ProjectBudgetDraft;
  setBudgetDraft: (draft: ProjectBudgetDraft) => void;
  onSaveBudget: (event: FormEvent) => void;
  budgetPending: boolean;
  onDeleteProject: () => void;
  deletePending: boolean;
}) {
  const { settings } = dossier;
  const assigned = new Set(settings.members.map((member) => member.id));
  const available = users.filter((member) => !assigned.has(member.id));
  const budgetForm = composeBudgetForm(budgetDraft, settings.budget.saved);
  return (
    <div className="df-settings-stack">
      <SettingsCard
        title="Identity"
        sub="What this Project is called, who it is for, and the Tags it is filed under."
        testId="v2-dossier-settings-identity"
        action={
          <Button variant="outline" type="button" onClick={onClone} disabled={clonePending} className="df-btn">
            {clonePending ? "Cloning…" : "Clone Project"}
          </Button>
        }
      >
        <div className="df-settings-grid">
          <form className="df-settings-row" onSubmit={onSaveName}>
            <label className="df-settings-label" htmlFor="df-dossier-project-name">
              NAME
            </label>
            <span className="df-settings-value df-settings-inline">
              <input
                id="df-dossier-project-name"
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                aria-label="Project name"
              />
              <Button variant="default" type="submit" disabled={!projectName.trim()} className="df-btn">
                Save name
              </Button>
            </span>
          </form>
          {settings.identity.map((row) => (
            <SettingRow key={row.label} row={row} />
          ))}
          <div className="df-settings-row" data-testid="v2-dossier-tags">
            <span className="df-settings-label">TAGS</span>
            <div className="df-settings-value df-settings-list">
              {dossier.tags.emptyCopy ? <p className="df-empty df-flush">{dossier.tags.emptyCopy}</p> : null}
              {dossier.tags.vocabulary.map((tag) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  onSetAttached={onSetTagAttached}
                  onEdit={onEditTag}
                  onDelete={onDeleteTag}
                />
              ))}
              <form className="df-settings-inline" onSubmit={onCreateTag}>
                <input
                  type="text"
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  placeholder="New Tag"
                  aria-label="New Tag name"
                />
                <Button variant="outline" type="submit" disabled={!tagName.trim()} className="df-btn">
                  Create Tag
                </Button>
              </form>
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Lifecycle" sub={settings.lifecycle.note} testId="v2-dossier-settings-lifecycle">
        <div className="df-settings-grid">
          {settings.lifecycle.rows.map((row) => (
            <SettingRow key={row.label} row={row} />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Budget"
        sub="The time this Project is planned to take. The budget meters on the header and the Overview read it."
        testId="v2-dossier-settings-budget"
      >
        <form onSubmit={onSaveBudget}>
          <div className="df-settings-grid">
            <div className="df-settings-row">
              <span className="df-settings-label">BUDGET</span>
              <span className="df-settings-value df-settings-inline">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  className="df-settings-number"
                  value={budgetDraft.hours}
                  onChange={(event) => setBudgetDraft({ ...budgetDraft, hours: event.target.value })}
                  placeholder="0"
                  aria-label="Budget hours"
                />
                <span className="df-settings-unit">h</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  step={1}
                  className="df-settings-number"
                  value={budgetDraft.minutes}
                  onChange={(event) => setBudgetDraft({ ...budgetDraft, minutes: event.target.value })}
                  placeholder="0"
                  aria-label="Budget minutes"
                />
                <span className="df-settings-unit">min</span>
              </span>
            </div>
            <SettingRow row={{ label: "CONSUMED", value: settings.budget.consumed }} />
          </div>
          <div className="df-form-actions">
            <p className={budgetForm.issue ? "df-form-note df-refusal-inline" : "df-form-note"} role="status">
              {budgetForm.note}
            </p>
            <Button variant="default" type="submit" disabled={!budgetForm.canSave || budgetPending} className="df-btn">
              {budgetPending ? "Saving…" : "Save budget"}
            </Button>
          </div>
        </form>
      </SettingsCard>

      <SettingsCard
        title="Team"
        sub="The Project Manager accountable for this Project, and the Members assigned to it."
        testId="v2-dossier-settings-team"
      >
        <div className="df-settings-grid">
          <div className="df-settings-row">
            <span className="df-settings-label">PROJECT MANAGER</span>
            <span className="df-settings-value">
              <V2FilterSelect
                label=""
                ariaLabel="Project Manager"
                value={settings.lead?.id ?? V2_SELECT_NONE}
                options={[
                  { value: V2_SELECT_NONE, label: "No Project Manager" },
                  ...users.map((member) => ({ value: member.id, label: memberName(member) })),
                ]}
                onChange={(value) => onAssignLead(value === V2_SELECT_NONE ? "" : value)}
              />
            </span>
          </div>
          <div className="df-settings-row" data-testid="v2-dossier-members">
            <span className="df-settings-label">MEMBERS</span>
            <div className="df-settings-value df-settings-list">
        {settings.memberRows.length === 0 ? (
          <p className="df-empty df-flush">No Members assigned to this Project.</p>
        ) : (
          settings.memberRows.map((member) => (
            <div key={member.id} className="df-contact-row">
              <span className="df-row-title">{member.name}</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructiveOutline"
                    type="button"
                    className="df-btn"
                    data-testid={`v2-dossier-remove-member-${member.id}`}
                  >
                    {member.action}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="df-v2 df-alert">
                  <AlertDialogHeader>
                    <AlertDialogTitle>{member.action === "Leave" ? "Leave Project" : `Remove ${member.name}`}</AlertDialogTitle>
                    <AlertDialogDescription>{member.consequence}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="df-btn" autoFocus>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => onRemoveMember(member.id)}
                    >
                      {member.action}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))
        )}
            </div>
          </div>
          <form className="df-settings-row" onSubmit={onAddMember}>
            <span className="df-settings-label">ADD MEMBER</span>
            <span className="df-settings-value df-settings-inline">
              <V2FilterSelect
                label=""
                ariaLabel="Add Project Assignment"
                value={memberId || V2_SELECT_NONE}
                options={[
                  { value: V2_SELECT_NONE, label: "Choose a Member", disabled: true },
                  ...available.map((member) => ({ value: member.id, label: memberName(member) })),
                ]}
                onChange={(value) => setMemberId(value === V2_SELECT_NONE ? "" : value)}
              />
              <Button variant="outline" type="submit" disabled={memberPending || !memberId} className="df-btn">
                Assign
              </Button>
            </span>
          </form>
        </div>
      </SettingsCard>

      <SettingsCard title="Documentation" sub={settings.documentation.copy} testId="v2-dossier-settings-documentation">
        <div className="df-settings-grid">
          <div className="df-settings-row">
            <span className="df-settings-label">{settings.documentation.row.label}</span>
            <span className="df-settings-value df-settings-inline">
              <span className="df-status">{settings.documentation.row.value}</span>
              <Button
                variant="outline"
                type="button"
                onClick={() => onToggleDocumentation(!settings.documentationEnabled)}
                className="df-btn"
              >
                {settings.documentation.action}
              </Button>
            </span>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Danger zone"
        sub="What happens here cannot be undone."
        testId="v2-dossier-settings-danger"
        danger
      >
        <div className="df-settings-grid">
          <div className="df-settings-row">
            <span className="df-settings-label">DELETE</span>
            <span className="df-settings-value df-settings-inline">
              <span className="df-settings-copy">Delete this Project and everything filed under it.</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructiveOutline"
                    type="button"
                    className="df-btn"
                    disabled={deletePending}
                    data-testid="v2-dossier-delete-project"
                  >
                    {deletePending ? "Deleting…" : "Delete Project"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="df-v2 df-alert">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Project</AlertDialogTitle>
                    <AlertDialogDescription>{settings.deleteConsequence}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="df-btn" autoFocus>
                      Keep Project
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={onDeleteProject}
                    >
                      Delete Project
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </span>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

/**
 * One Tag in the Workspace vocabulary (#260). Attaching is the row's primary
 * action; editing opens the row, and deleting a Tag — which takes it off every
 * Project — asks first, in the same modal Billing uses.
 */
function TagRow({
  tag,
  onSetAttached,
  onEdit,
  onDelete,
}: {
  tag: DossierModel["tags"]["vocabulary"][number];
  onSetAttached: (id: string, attached: boolean) => void;
  onEdit: (id: string, draft: { name: string; color: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.name);
  const [color, setColor] = useState(tag.color);

  if (editing) {
    return (
      <form
        className="df-contact-row"
        data-testid={`v2-dossier-tag-edit-${tag.id}`}
        onSubmit={(event) => {
          event.preventDefault();
          const name = draft.trim();
          if (!name) return;
          if (name !== tag.name || color !== tag.color) onEdit(tag.id, { name, color });
          setEditing(false);
        }}
      >
        <label className="df-filter-input">
          <input
            type="text"
            value={draft}
            aria-label="Tag name"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {/* shadcn has no colour control; the native one is the whole of it. */}
        <input
          type="color"
          className="df-tag-color"
          value={color}
          aria-label="Tag colour"
          onChange={(event) => setColor(event.target.value)}
        />
        <span className="df-people-action">
          <Button variant="outline" type="button" onClick={() => setEditing(false)} className="df-btn">
            Cancel
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructiveOutline" className="df-btn">
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="df-v2 df-alert">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Tag</AlertDialogTitle>
                <AlertDialogDescription>{tag.deleteConsequence}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="df-btn" autoFocus>
                  Keep Tag
                </AlertDialogCancel>
                <AlertDialogAction
                  className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    onDelete(tag.id);
                    setEditing(false);
                  }}
                >
                  Delete Tag
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="default" type="submit" disabled={!draft.trim()} className="df-btn">
            Save
          </Button>
        </span>
      </form>
    );
  }

  return (
    <div className="df-contact-row" data-attached={tag.attached ? "true" : "false"}>
      <span className="df-tag-chip">
        {/* Per-instance: the swatch is this Tag's own colour. */}
        <span className="df-tag-swatch" style={{ background: tag.color }} aria-hidden />
        {tag.name}
      </span>
      <span className="df-people-action">
        <Button
          variant="outline"
          type="button"
          onClick={() => onSetAttached(tag.id, !tag.attached)}
          className="df-btn"
          data-testid={`v2-dossier-tag-toggle-${tag.id}`}
        >
          {tag.attached ? "Detach" : "Attach"}
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            setDraft(tag.name);
            setColor(tag.color);
            setEditing(true);
          }}
          className="df-btn"
        >
          Edit
        </Button>
      </span>
    </div>
  );
}

function EvidenceTile({ tile }: { tile: DossierModel["evidence"]["tiles"][number] }) {
  return (
    <div className="df-evidence-tile">
      <div className="df-evidence-frame" data-kind={tile.kind}>
        {tile.kind === "screenshot" ? (
          <img src={`/api/time-tracking/screenshots/${tile.id}/image`} alt="" />
        ) : null}
        <span className="df-mono">{tile.kind === "idle" ? "IDLE" : "SCREENSHOT"}</span>
      </div>
      <div className="df-mono df-meta">{tile.caption}</div>
    </div>
  );
}
