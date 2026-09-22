import { useMemo, useState, type FormEvent } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CrmProjectWithDetails } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { matchV2Route } from "./presentation";
import {
  composeProjectRegister,
  projectVisibleTo,
  type ProjectRegisterRowInput,
} from "./projects";
import { formatHours, memberName, mobileProjectMeta } from "./today";
import { useV2Chrome } from "./V2Shell";
import { Button } from "@/components/ui/button";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type TimeStats = {
  byProject: Array<{ crmProjectId: string; totalDuration: number }>;
};

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function statsUrl(start: Date, end: Date): string {
  const params = new URLSearchParams({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  });
  return `/api/time-tracking/stats?${params.toString()}`;
}

async function loadProjects(): Promise<ProjectsResponse> {
  const pageSize = 200;
  const rows: CrmProjectWithDetails[] = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const res = await fetch(`/api/crm/projects?page=${page}&pageSize=${pageSize}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to fetch Projects");
    const body = (await res.json()) as ProjectsResponse;
    const batch = body.data ?? [];
    total = body.total ?? rows.length + batch.length;
    rows.push(...batch);
    if (rows.length >= total || batch.length === 0) break;
    page += 1;
  }

  return { data: rows, total };
}

function meterFill(status: string): string {
  if (status === "COMPLETED") return "#1F9D6B";
  if (status === "ON HOLD" || status === "ARCHIVED") return "#59657A";
  return "#0F1524";
}

function leadName(project: CrmProjectWithDetails): string | null {
  const member = project.members?.find((row) => row.user);
  if (member?.user) return memberName(member.user);
  if (project.assignee) return memberName(project.assignee);
  return null;
}

function toRegisterProject(
  project: CrmProjectWithDetails,
  monthSeconds: number,
  viewer: { userId: string; role: string | null },
): ProjectRegisterRowInput {
  const budgeted = project.budgetedHours ?? 0;
  const actual = project.actualHours ?? 0;
  const memberIds = (project.members ?? [])
    .map((row) => row.userId || row.user?.id)
    .filter((id): id is string => Boolean(id));
  return {
    id: project.id,
    name: project.project?.name || "Untitled Project",
    clientName: project.client?.name ?? null,
    projectType: project.projectType,
    projectStatus: project.projectStatus,
    leadName: leadName(project),
    budgetPercent: budgeted > 0 ? Math.round((actual / budgeted) * 100) : null,
    trackedMtd: formatHours(monthSeconds),
    visible: projectVisibleTo({
      role: viewer.role,
      userId: viewer.userId,
      memberIds,
      assigneeId: project.assigneeId ?? project.assignee?.id ?? null,
    }),
  };
}

export function V2LegacyProjectPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const legacyProjectId = match.kind === "legacy-project" ? match.legacyProjectId : "";

  const { data, isFetched } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects/by-project", legacyProjectId],
    enabled: Boolean(legacyProjectId),
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects/by-project/${legacyProjectId}`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch Project");
      return res.json();
    },
  });

  if (!legacyProjectId) return <Redirect to="/projects" />;
  if (isFetched) {
    return <Redirect to={data?.id ? `/projects/${data.id}` : "/projects"} />;
  }

  return (
    <div className="df-page" data-testid="v2-projects">
      <h1 className="df-title">Projects</h1>
      <p className="df-subhead">Opening this Project…</p>
    </div>
  );
}

export function V2ProjectsPage() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();
  const [filterQuery, setFilterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(
    () => new URLSearchParams(window.location.search).get("new") === "1",
  );
  const [name, setName] = useState("");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonth(now), [now]);
  const dayEnd = useMemo(() => endOfDay(now), [now]);
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const { data: projectsResponse, isLoading, isError } = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", "register"],
    queryFn: loadProjects,
  });
  const { data: monthStats } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", "projects-register", monthStart.toISOString()],
    queryFn: () => fetch(statsUrl(monthStart, dayEnd), { credentials: "include" }).then((res) => res.json()),
  });

  const monthByProject = new Map((monthStats?.byProject ?? []).map((row) => [row.crmProjectId, row.totalDuration]));
  const register = composeProjectRegister({
    workspaceName,
    projects: (projectsResponse?.data ?? []).map((project) =>
      toRegisterProject(project, monthByProject.get(project.id) ?? 0, {
        userId: user?.id ?? "",
        role: current?.workspaceRole ?? null,
      }),
    ),
    filterQuery,
    statusFilter,
    selectedId,
  });

  const createProject = useMutation({
    mutationFn: (projectName: string) => apiRequest("POST", "/api/crm/projects", { name: projectName }),
    onSuccess: (response: { crmProject?: { id?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      const createdId = response?.crmProject?.id ?? null;
      setSelectedId(createdId);
      setName("");
      setCreating(false);
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      setWriteRefusal(error.message || "Failed to create Project");
    },
  });

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName) return;
    if (readOnly) {
      setWriteRefusal(
        chromeRefusal({
          kind: "workspace-condition",
          workspaceName,
          condition: "Read-only",
        }),
      );
      return;
    }
    createProject.mutate(projectName);
  }

  if (isLoading) {
    return (
      <div className="df-page" data-testid="v2-projects">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Projects</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="df-page" data-testid="v2-projects">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Projects</h1>
            <p className="df-subhead">{register.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Projects in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-projects">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Projects</h1>
          <p className="df-subhead">{register.subhead}</p>
        </div>
        <div className="df-library-actions">
          <Button variant="default" type="button" onClick={() => setCreating((open) => !open)} className="df-btn">
            New Project
          </Button>
        </div>
      </header>

      {creating ? (
        <form className="df-filter-bar" onSubmit={onCreate}>
          <label className="df-filter-input">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project name"
              aria-label="Project name"
            />
          </label>
          <Button variant="default" type="submit" disabled={createProject.isPending || !name.trim()} className="df-btn">
            Create
          </Button>
        </form>
      ) : null}
      {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

      <div className="df-filter-bar">
        <label className="df-filter-input">
          <input
            type="search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter Projects"
            aria-label="Filter Projects"
          />
        </label>
        <label className="df-filter-chip">
          STATUS
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by Project Status"
          >
            <option value="all">ALL</option>
            <option value="planned">PLANNED</option>
            <option value="active">ACTIVE</option>
            <option value="on_hold">ON HOLD</option>
            <option value="in_review">IN REVIEW</option>
            <option value="completed">COMPLETED</option>
            <option value="archived">ARCHIVED</option>
          </select>
        </label>
      </div>

      <section className="df-card df-projects-register" data-testid="v2-projects-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>PROJECT / CLIENT</span>
            <span>STATUS</span>
            <span>LEAD</span>
            <span>BUDGET USED</span>
            <span style={{ textAlign: "right" }}>TRACKED MTD</span>
          </div>
        )}
        {register.empty ? (
          <p className="df-empty">{register.emptyCopy}</p>
        ) : (
          register.rows.map((row) => (
            <Link
              key={row.id}
              href={row.href}
              className="df-register-row"
              data-selected={row.selected ? "true" : "false"}
              data-testid={`v2-project-row-${row.id}`}
              onPointerDown={() => setSelectedId(row.id)}
              onClick={() => setSelectedId(row.id)}
            >
              {layout.stackedRegister ? (
                <span className="df-project-mobile">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.name}</div>
                    <div className="df-mono df-meta">{mobileProjectMeta(row)}</div>
                  </span>
                </span>
              ) : (
                <>
                  <span style={{ minWidth: 0 }}>
                    <div className="df-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.name}
                    </div>
                    <div className="df-mono df-meta">
                      {row.clientLabel} · {row.kindLabel}
                    </div>
                  </span>
                  <span>
                    <span className="df-status-word">{row.status}</span>
                  </span>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>{row.lead}</span>
                  <span>
                    {row.budgetPercent == null ? (
                      <span className="df-mono df-meta">—</span>
                    ) : (
                      <span className="df-meter-row">
                        <span className="df-meter">
                          {/* Per-instance: the fill width is this project's budget share. */}
                          <span
                            className="df-meter-fill"
                            style={{
                              width: `${Math.min(100, row.budgetPercent)}%`,
                              background: meterFill(row.status),
                            }}
                          />
                        </span>
                        <span className="df-mono" style={{ fontSize: 11, width: 36 }}>
                          {row.budgetPercent}%
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="df-mono" style={{ fontSize: 12, textAlign: "right" }}>
                    {row.trackedMtd}
                  </span>
                </>
              )}
            </Link>
          ))
        )}
        <div className="df-library-foot">
          <span>
            {register.count} {register.count === 1 ? "PROJECT" : "PROJECTS"}
          </span>
        </div>
      </section>
    </div>
  );
}

export function V2ProjectRecordRedirect() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  if (match.kind === "dossier") return <Redirect to={`/projects/${match.projectId}`} />;
  return <Redirect to="/projects" />;
}
