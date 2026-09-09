import { useMemo } from "react";
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
} from "@shared/schema";
import {
  composeDossier,
  type DossierDocument,
  type DossierInput,
  type DossierProject,
  type DossierTask,
} from "./dossier";
import { memberName } from "./today";
import { matchV2Route } from "./presentation";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type TimeStats = { totalDuration: number };
type ScreenshotRow = {
  id: string;
  capturedAt: Date | string | null;
  userId: string;
  deletedAt?: Date | string | null;
};
type DailyUpdatesQuery = {
  capabilityMiss: boolean;
  latest: ProjectDailyUpdateWithDetails | null;
};

const LIVE_PROJECT_STATUSES = new Set(["active", "on_hold", "in_review", "completed"]);

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

export function V2DossierPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const projectId = match.kind === "dossier" ? match.projectId : "";
  const tab = match.kind === "dossier" ? match.tab : "overview";
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { isRunning, activeEntry, handleStart, setSelectedProjectId } = useTimeTracker();
  const monthStart = useMemo(() => startOfMonth(now), [now]);
  const dayEnd = useMemo(() => endOfDay(now), [now]);

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
      if (res.status === 401 || res.status === 403) return { capabilityMiss: true, latest: null };
      if (!res.ok) return { capabilityMiss: false, latest: null };
      const rows = (await res.json()) as ProjectDailyUpdateWithDetails[];
      const latest = [...rows].sort((a, b) => {
        const aTime = new Date(a.updateDate ?? a.createdAt ?? 0).getTime();
        const bTime = new Date(b.updateDate ?? b.createdAt ?? 0).getTime();
        return bTime - aTime;
      })[0] ?? null;
      return { capabilityMiss: false, latest };
    },
  });

  const { data: monthStats } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", "dossier", projectId, monthStart.toISOString()],
    enabled: Boolean(projectId),
    queryFn: () =>
      fetch(statsUrl(projectId, monthStart, dayEnd), { credentials: "include" }).then((res) => res.json()),
  });

  const { data: screenshotPage } = useQuery<{ data: ScreenshotRow[] }>({
    queryKey: ["/api/time-tracking/screenshots", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      fetch(`/api/time-tracking/screenshots?crmProjectId=${projectId}&limit=8`, {
        credentials: "include",
      }).then((res) => res.json()),
  });

  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: projectsResponse } = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500", { credentials: "include" }).then((res) => res.json()),
  });

  const completeTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", projectId] });
    },
  });

  const owner = users.find((member) => member.isMainAdmin === 1);
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
    dailyUpdate: dailyUpdates?.latest
      ? {
          id: dailyUpdates.latest.id,
          whatHappened: dailyUpdates.latest.whatHappened,
          whatWasDone: dailyUpdates.latest.whatWasDone,
          nextSteps: dailyUpdates.latest.nextSteps,
          blockageType: dailyUpdates.latest.blockageType,
          waitingOnClient: dailyUpdates.latest.waitingOnClient,
          updateDate: dailyUpdates.latest.updateDate,
          createdAt: dailyUpdates.latest.createdAt,
          user: dailyUpdates.latest.user
            ? {
                firstName: dailyUpdates.latest.user.firstName,
                lastName: dailyUpdates.latest.user.lastName,
                email: dailyUpdates.latest.user.email,
              }
            : null,
        }
      : null,
    dailyUpdateCapabilityMiss: dailyUpdates?.capabilityMiss === true,
    ownerName: owner ? memberName(owner) : null,
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
  };
  const dossier = composeDossier(input);
  const firstTodoTask = dossier.nextActions.rows.find((row) => !row.done);

  function onStartTimer() {
    if (!projectId) return;
    setSelectedProjectId(projectId);
    handleStart(projectId, firstTodoTask?.id);
  }

  if (match.kind !== "dossier") {
    return (
      <div className="df-page" data-testid="v2-placeholder">
        <h1 className="df-title">{match.kind === "placeholder" ? match.title : "Projects"}</h1>
        <p className="df-empty">
          This destination is not in the current batch. It stays on v2 tokens rather than the previous
          screens.
        </p>
      </div>
    );
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
        {dossier.tabIsPlaceholder ? (
          <section className="df-card" data-testid="v2-dossier-placeholder-tab">
            <p className="df-empty">
              This {dossier.tabs.find((item) => item.active)?.label ?? "tab"} view is not in the current
              batch. It stays on v2 tokens rather than the previous screens.
            </p>
          </section>
        ) : (
          <div className="df-overview" data-testid="v2-dossier-overview">
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
                        onClick={() => completeTask.mutate({ id: row.id, status: row.done ? "open" : "done" })}
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
                      <div key={tile.id} className="df-evidence-tile">
                        <div className="df-evidence-frame" data-kind={tile.kind}>
                          {tile.kind === "screenshot" ? (
                            <img src={`/api/time-tracking/screenshots/${tile.id}/image`} alt="" />
                          ) : null}
                          <span className="df-mono">{tile.kind === "idle" ? "IDLE" : "SCREENSHOT"}</span>
                        </div>
                        <div className="df-mono df-meta">{tile.caption}</div>
                      </div>
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
                    <div key={row.id} className="df-doc-row">
                      <span className="df-row-title">{row.title}</span>
                      <span className="df-mono df-meta">{row.meta}</span>
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
                  <p className="df-empty">
                    Every record above resolves to this Project in this Workspace.
                  </p>
                ) : null}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
