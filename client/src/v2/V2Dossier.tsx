import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  CrmProjectWithDetails,
  Document,
  ProjectDailyUpdateWithDetails,
  SafeUser,
  Task,
  TimeEntryWithDetails,
} from "@shared/schema";
import { chromeRefusal } from "./chrome";
import {
  composeDossier,
  type DossierDailyUpdate,
  type DossierDocument,
  type DossierInput,
  type DossierModel,
  type DossierProject,
  type DossierTask,
  type DossierTimeEntry,
} from "./dossier";
import { motionForSurface } from "./motion";
import { matchV2Route } from "./presentation";
import { memberName } from "./today";
import { useV2Chrome } from "./V2Shell";

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

const LIVE_PROJECT_STATUSES = new Set(["active", "on_hold", "in_review", "completed"]);
const TAB_MOTION = motionForSurface("dossier-tab-swap").enterExit;
const TASK_STATUS_OPTIONS = [
  { value: "open", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
] as const;

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

  useEffect(() => {
    setProjectName(project?.project?.name ?? "");
    setWriteRefusal(null);
  }, [project?.id, project?.project?.name]);

  const owner = users.find((member) => member.isMainAdmin === 1);
  const ownerName = owner ? memberName(owner) : null;

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
    clientActiveProjectCount,
    timeEntries: (timeEntriesResponse?.data ?? []).map(toDossierTimeEntry),
    dailyUpdates: (dailyUpdates?.rows ?? []).map(toDossierDailyUpdate),
    files: [],
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

  if (match.kind !== "dossier") {
    return null;
  }

  if (projectLoading) {
    return (
      <div data-testid="v2-dossier">
        <header className="df-dossier-head">
          <div className="df-dossier-identity">
            <div className="df-dossier-copy">
              <div className="df-card" style={{ minHeight: 88, border: 0 }} />
            </div>
          </div>
        </header>
        <div className="df-dossier-body">
          <div className="df-overview">
            <div className="df-card" style={{ minHeight: 240 }} />
            <div className="df-card" style={{ minHeight: 240 }} />
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
                  <span className="df-status" data-status={dossier.identity.status}>
                    {dossier.identity.status}
                  </span>
                </div>
                <div className="df-dossier-provenance">
                  {dossier.identity.lead ? (
                    <span className="df-prov">
                      <span className="df-mono df-meta">LEAD</span>
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
                    <span
                      className="df-meter-fill"
                      style={{ width: `${Math.min(100, dossier.stats.budgetPercent)}%`, background: "#0F1524" }}
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
                <button type="button" className="df-ghost-btn" onClick={onStartTimer}>
                  Start Timer
                </button>
                <Link href={`/projects/${projectId}/tasks`} className="df-ink-btn">
                  New Task
                </Link>
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

      <div className="df-dossier-body">
        {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}
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
              projectName,
              setProjectName,
              onSaveName,
              onAssignLead,
              memberId,
              setMemberId,
              onAddMember,
              users,
              memberPending: addMember.isPending,
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
  projectName: string;
  setProjectName: (value: string) => void;
  onSaveName: (event: FormEvent) => void;
  onAssignLead: (assigneeId: string) => void;
  memberId: string;
  setMemberId: (value: string) => void;
  onAddMember: (event: FormEvent) => void;
  users: SafeUser[];
  memberPending: boolean;
}): ReactNode {
  const { dossier } = props;
  if (dossier.tab === "tasks") return <DossierTasks {...props} />;
  if (dossier.tab === "time") return <DossierTime dossier={dossier} />;
  if (dossier.tab === "activity") return <DossierActivity dossier={dossier} />;
  if (dossier.tab === "updates") return <DossierUpdates dossier={dossier} />;
  if (dossier.tab === "documents") return <DossierDocuments dossier={dossier} />;
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
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                  {row.done ? "✓" : null}
                </button>
                <span className="df-task-title">{row.title}</span>
                {row.flag ? (
                  <span className="df-flag" data-flag={row.flag}>
                    {row.flag}
                  </span>
                ) : null}
                {row.meta ? (
                  <span className="df-mono" style={{ fontSize: 11, color: row.done ? "#1F9D6B" : "#59657A" }}>
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
                  <p className="df-prose" style={{ margin: "6px 0 0" }}>
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
          <p className="df-empty" style={{ paddingTop: 0 }}>
            {dossier.evidence.footnote}
          </p>
        </section>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Budget & time</h2>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="df-mono df-meta">CONSUMED {dossier.budgetTime.consumedLabel}</div>
            <span className="df-meter df-meter-lg">
              <span
                className="df-meter-fill"
                style={{
                  width: `${Math.min(100, dossier.budgetTime.percent ?? 0)}%`,
                  background: "#0F1524",
                }}
              />
            </span>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
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

        <section className="df-card">
          <div className="df-card-head">
            <h2 className="df-card-title">Client</h2>
          </div>
          {!dossier.client ? (
            <p className="df-empty">This is an Internal Project.</p>
          ) : (
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
      <form className="df-filter-bar" style={{ padding: "12px 18px" }} onSubmit={onCreateTask}>
        <label className="df-filter-input">
          <input
            type="text"
            value={taskName}
            onChange={(event) => setTaskName(event.target.value)}
            placeholder="Task name"
            aria-label="Task name"
          />
        </label>
        <button type="submit" className="df-ink-btn" disabled={createPending || !taskName.trim()}>
          Create
        </button>
      </form>
      {dossier.tasks.assignees.length > 0 ? (
        <p className="df-mono df-meta" style={{ padding: "0 18px 8px" }}>
          PROJECT ASSIGNMENT · {dossier.tasks.assignees.map((member) => member.name).join(" · ")}
        </p>
      ) : null}
      {dossier.tasks.empty ? (
        <p className="df-empty">{dossier.tasks.emptyCopy}</p>
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
              {row.done ? "✓" : null}
            </button>
            <span className="df-task-title">{row.title}</span>
            <label className="df-filter-chip">
              STATUS
              <select
                aria-label={`Task status for ${row.title}`}
                value={row.statusValue}
                onChange={(event) => onComplete(row.id, event.target.value)}
              >
                {TASK_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {row.flag ? (
              <span className="df-flag" data-flag={row.flag}>
                {row.flag}
              </span>
            ) : (
              <button type="button" className="df-ghost-btn" onClick={() => onStartTask(row.id)}>
                Start Timer
              </button>
            )}
          </div>
        ))
      )}
    </section>
  );
}

function DossierTime({ dossier }: { dossier: DossierModel }) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Time Entries</h2>
        <span className="df-count-chip">{dossier.time.rows.length}</span>
      </div>
      {dossier.time.empty ? (
        <p className="df-empty">{dossier.time.emptyCopy}</p>
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

function DossierActivity({ dossier }: { dossier: DossierModel }) {
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Activity Evidence</h2>
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
      <p className="df-empty" style={{ paddingTop: 0 }}>
        {dossier.evidence.footnote}
      </p>
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
        <p className="df-empty">{dossier.updates.copy}</p>
      ) : (
        dossier.updates.rows.map((row) => (
          <div key={row.id} className="df-update-body" style={{ borderBottom: "1px solid var(--df-divider-light)" }}>
            {row.meta ? <div className="df-mono df-meta">{row.meta}</div> : null}
            {row.prose ? <p className="df-prose">{row.prose}</p> : null}
            {row.blocker ? (
              <div className="df-blocker">
                <div className="df-mono df-meta">BLOCKER</div>
                <p className="df-prose" style={{ margin: "6px 0 0" }}>
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

function DossierDocuments({ dossier }: { dossier: DossierModel }) {
  return (
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
        <p className="df-empty">{dossier.files.emptyCopy}</p>
      ) : (
        dossier.files.rows.map((row) => (
          <div key={row.id} className="df-doc-row">
            <span className="df-row-title">{row.title}</span>
            <span className="df-mono df-meta">{row.meta}</span>
          </div>
        ))
      )}
    </section>
  );
}

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
}) {
  const assigned = new Set(dossier.settings.members.map((member) => member.id));
  const available = users.filter((member) => !assigned.has(member.id));
  return (
    <section className="df-card">
      <div className="df-card-head">
        <h2 className="df-card-title">Settings</h2>
      </div>
      <form className="df-filter-bar" style={{ padding: "12px 18px" }} onSubmit={onSaveName}>
        <label className="df-filter-input">
          <input
            type="text"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            aria-label="Project name"
          />
        </label>
        <button type="submit" className="df-ink-btn" disabled={!projectName.trim()}>
          Save name
        </button>
      </form>
      <div style={{ padding: "8px 18px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {dossier.settings.fields.map((field) => (
          <div key={field.label} className="df-kv">
            <span>{field.label}</span>
            <span>{field.value}</span>
          </div>
        ))}
      </div>
      <form className="df-filter-bar" style={{ padding: "0 18px 16px" }} onSubmit={(event) => event.preventDefault()}>
        <label className="df-filter-chip">
          LEAD
          <select
            aria-label="Project lead"
            value={dossier.settings.lead?.id ?? ""}
            onChange={(event) => onAssignLead(event.target.value)}
          >
            <option value="">NONE</option>
            {users.map((member) => (
              <option key={member.id} value={member.id}>
                {memberName(member)}
              </option>
            ))}
          </select>
        </label>
      </form>
      <form className="df-filter-bar" style={{ padding: "0 18px 16px" }} onSubmit={onAddMember}>
        <label className="df-filter-chip">
          MEMBER
          <select
            aria-label="Add Project Assignment"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          >
            <option value="">ADD MEMBER</option>
            {available.map((member) => (
              <option key={member.id} value={member.id}>
                {memberName(member)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="df-ghost-btn" disabled={memberPending || !memberId}>
          Assign
        </button>
      </form>
    </section>
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
