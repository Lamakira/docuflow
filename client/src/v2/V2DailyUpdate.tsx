import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  dailyUpdateBlockedStatuses,
  dailyUpdateBlockageTypeOptions,
  dailyUpdateStatusOptions,
  type CrmProjectWithDetails,
  type ProjectDailyUpdateWithDetails,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { composeDailyUpdatePage } from "./dailyUpdate";
import { useV2Chrome } from "./V2Shell";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };

function todayKey(value: Date): string {
  const year = value.getFullYear();
  const month = (value.getMonth() + 1).toString().padStart(2, "0");
  const day = value.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function V2DailyUpdatePage() {
  const now = useMemo(() => new Date(), []);
  const { memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
  const date = todayKey(now);

  const [crmProjectId, setCrmProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [blockageType, setBlockageType] = useState("");
  const [waitingOnClient, setWaitingOnClient] = useState(false);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const blocked = (dailyUpdateBlockedStatuses as readonly string[]).includes(status);

  const { data: projectsResponse, isLoading: projectsLoading } = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", "daily-update"],
    queryFn: async () => {
      const res = await fetch("/api/crm/projects?pageSize=1000", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Projects");
      return res.json();
    },
  });
  const { data: submissions = [], isLoading: submissionsLoading } = useQuery<ProjectDailyUpdateWithDetails[]>({
    queryKey: ["/api/daily-updates", date],
    queryFn: async () => {
      const res = await fetch(`/api/daily-updates?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Daily Updates");
      return res.json();
    },
  });

  const projects = (projectsResponse?.data ?? []).map((project) => ({
    id: project.id,
    name: project.project?.name || "Untitled Project",
  }));
  const page = composeDailyUpdatePage({
    now,
    workspaceName,
    readOnly,
    projects,
    submissions,
  });

  const submit = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/daily-updates", {
        crmProjectId,
        updateDate: new Date().toISOString(),
        status,
        whatHappened: progress || null,
        nextSteps: nextSteps || null,
        blockageType: blocked ? blockageType : null,
        waitingOnClient,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-updates"] });
      setCrmProjectId("");
      setStatus("");
      setProgress("");
      setNextSteps("");
      setBlockageType("");
      setWaitingOnClient(false);
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      setWriteRefusal(
        readOnly
          ? chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" })
          : chromeRefusal({ kind: "generic", message: error.message }),
      );
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) {
      setWriteRefusal(chromeRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }));
      return;
    }
    if (!crmProjectId || !status) return;
    if (blocked && !blockageType) return;
    submit.mutate();
  }

  if (projectsLoading || submissionsLoading) {
    return (
      <div className="df-page" data-testid="v2-daily-update">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Daily Update</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 240 }} />
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-daily-update">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <div className="df-today-title-row">
            <h1 className="df-title">Daily Update</h1>
            <span className="df-date-chip">{page.dateChip}</span>
          </div>
          <p className="df-subhead">{page.subhead}</p>
        </div>
      </header>

      {page.kind === "refusal" ? <p className="df-refusal">{page.refusal}</p> : null}
      {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

      {page.kind === "empty" ? <p className="df-empty">{page.emptyCopy}</p> : null}

      {page.submissions.length > 0 ? (
        <section className="df-card" data-testid="v2-daily-update-submitted">
          <div className="df-card-head">
            <h2 className="df-card-title">Submitted today</h2>
            <span className="df-count-chip">{page.submissions.length}</span>
          </div>
          {page.submissions.map((row) => (
            <div key={row.id} className="df-update-body">
              <div className="df-mono df-meta">
                {row.project} · {row.status}
              </div>
              {row.prose ? <p className="df-prose">{row.prose}</p> : null}
              {row.nextPlans ? <p className="df-prose">{row.nextPlans}</p> : null}
              {row.blocker ? (
                <div className="df-blocker">
                  <div className="df-mono df-meta">BLOCKER</div>
                  <p className="df-prose" style={{ margin: "6px 0 0" }}>
                    {row.blocker}
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {page.canSubmit ? (
        <form className="df-card" onSubmit={onSubmit} data-testid="v2-daily-update-form">
          <div className="df-card-head">
            <h2 className="df-card-title">Submit today's update</h2>
          </div>
          <div className="df-daily-form">
            <label className="df-daily-field">
              Project
              <select
                value={crmProjectId}
                aria-label="Project"
                onChange={(event) => setCrmProjectId(event.target.value)}
              >
                <option value="">Choose a Project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="df-daily-field">
              Status
              <select value={status} aria-label="Status" onChange={(event) => setStatus(event.target.value)}>
                <option value="">Choose a status</option>
                {dailyUpdateStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="df-daily-field">
              Progress
              <textarea
                value={progress}
                aria-label="Progress"
                onChange={(event) => setProgress(event.target.value)}
              />
            </label>
            <label className="df-daily-field">
              Next plans
              <textarea
                value={nextSteps}
                aria-label="Next plans"
                onChange={(event) => setNextSteps(event.target.value)}
              />
            </label>
            {blocked ? (
              <label className="df-daily-field">
                Blockage
                <select
                  value={blockageType}
                  aria-label="Blockage"
                  onChange={(event) => setBlockageType(event.target.value)}
                >
                  <option value="">Choose a cause</option>
                  {dailyUpdateBlockageTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="df-daily-field df-daily-check">
              <input
                type="checkbox"
                checked={waitingOnClient}
                onChange={(event) => setWaitingOnClient(event.target.checked)}
              />
              Waiting on the Client
            </label>
            <button
              type="submit"
              className="df-ink-btn"
              disabled={submit.isPending || !crmProjectId || !status || (blocked && !blockageType)}
            >
              Submit
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
