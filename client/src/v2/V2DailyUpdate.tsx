import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
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
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { Button } from "@/components/ui/button";
import { SkeletonSection, V2PageSkeleton } from "./V2Skeleton";

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

  // A Project Dossier opens this form on its Project (`?project=`).
  const [pickedProjectId, setPickedProjectId] = useState(
    () => new URLSearchParams(window.location.search).get("project") ?? "",
  );
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
  const crmProjectId = projects.some((project) => project.id === pickedProjectId) ? pickedProjectId : "";
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
      setPickedProjectId("");
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
      <V2PageSkeleton title="Daily Update" testId="v2-daily-update" status="Loading your Daily Update.">
        <SkeletonSection title="Today" lines={3} />
        <SkeletonSection title="Submitted today" lines={2} />
        <SkeletonSection title="Submit today's update" lines={4} />
      </V2PageSkeleton>
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

      <section className="df-card" data-testid="v2-daily-update-today">
        <div className="df-card-head">
          <div>
            <h2 className="df-card-title">Today</h2>
            <p className="df-card-sub">{page.today.copy}</p>
          </div>
        </div>
        <div className="df-settings-grid">
          {page.today.rows.map((row) => (
            <div key={row.label} className="df-settings-row">
              <span className="df-settings-label">{row.label}</span>
              <span className="df-settings-value">
                {row.label === "STATUS" ? (
                  <span className="df-status" data-submitted={page.today.submitted ? "true" : "false"}>
                    {row.value}
                  </span>
                ) : (
                  row.value
                )}
              </span>
            </div>
          ))}
        </div>
        {page.today.action ? (
          <div className="df-form-actions">
            <Button asChild variant="default" className="df-btn">
              <Link href={page.today.action.href}>{page.today.action.label}</Link>
            </Button>
          </div>
        ) : null}
      </section>

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
                  <p className="df-prose df-prose-follow">
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
              <V2FilterSelect
                label=""
                ariaLabel="Project"
                value={crmProjectId || V2_SELECT_NONE}
                options={[
                  { value: V2_SELECT_NONE, label: "Choose a Project", disabled: true },
                  ...projects.map((project) => ({ value: project.id, label: project.name })),
                ]}
                onChange={(value) => setPickedProjectId(value === V2_SELECT_NONE ? "" : value)}
              />
            </label>
            <label className="df-daily-field">
              Status
              <V2FilterSelect
                label=""
                ariaLabel="Status"
                value={status || V2_SELECT_NONE}
                options={[
                  { value: V2_SELECT_NONE, label: "Choose a status", disabled: true },
                  ...dailyUpdateStatusOptions.map((option) => ({ value: option.value, label: option.label })),
                ]}
                onChange={(value) => setStatus(value === V2_SELECT_NONE ? "" : value)}
              />
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
                <V2FilterSelect
                  label=""
                  ariaLabel="Blockage"
                  value={blockageType || V2_SELECT_NONE}
                  options={[
                    { value: V2_SELECT_NONE, label: "Choose a cause", disabled: true },
                    ...dailyUpdateBlockageTypeOptions.map((option) => ({ value: option.value, label: option.label })),
                  ]}
                  onChange={(value) => setBlockageType(value === V2_SELECT_NONE ? "" : value)}
                />
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
            <div className="df-form-actions">
              <Button variant="default" type="submit" disabled={submit.isPending || !crmProjectId || !status || (blocked && !blockageType)} className="df-btn">
                Submit
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
