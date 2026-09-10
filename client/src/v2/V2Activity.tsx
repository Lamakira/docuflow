import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { CrmProjectWithDetails, SafeUser, ScreenshotPolicy, TimeEntryWithDetails } from "@shared/schema";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { timeEntriesPath } from "./time";
import { useV2Chrome } from "./V2Shell";
import {
  activityEvidencePath,
  composeActivity,
  trackingPolicyPath,
  type ActivityEvidenceInput,
  type ActivityEntryInput,
  type ActivityProjectInput,
} from "./activity";

type ScreenshotsResponse = { data: ActivityEvidenceInput[] };
type TimeEntriesResponse = { data: TimeEntryWithDetails[] };
type TrackingPolicyResponse = { screenshotPolicy: ScreenshotPolicy };

const EXPAND_MOTION = motionForSurface("activity-evidence-expand").enterExit;

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function startOfWeek(value: Date): Date {
  const start = startOfDay(value);
  const weekday = start.getDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  start.setDate(start.getDate() - offset);
  return start;
}

function toProject(project: CrmProjectWithDetails): ActivityProjectInput {
  return {
    id: project.id,
    project: project.project,
    client: project.client,
  };
}

function toEntry(entry: TimeEntryWithDetails): ActivityEntryInput {
  return {
    id: entry.id,
    taskId: entry.taskId,
    task: entry.task,
    description: entry.description,
  };
}

export function V2ActivityPage() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();

  const [range, setRange] = useState<"today" | "week" | "all">("today");
  const [projectFilter, setProjectFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const canReview = user?.role === "admin";

  const rangeDates = useMemo(() => {
    if (range === "all") return { startDate: null, endDate: null };
    if (range === "week") return { startDate: startOfWeek(now), endDate: endOfDay(now) };
    return { startDate: startOfDay(now), endDate: endOfDay(now) };
  }, [now, range]);

  const requestedUserId = canReview && userFilter !== "all" ? userFilter : null;
  const filters = {
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: projectFilter === "all" ? null : projectFilter,
    userId: requestedUserId,
  };
  const evidenceUrl = activityEvidencePath(filters);
  const entriesUrl = timeEntriesPath({
    startDate: rangeDates.startDate,
    endDate: rangeDates.endDate,
    crmProjectId: filters.crmProjectId,
    userId: filters.userId,
  });

  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const owner = users.find((member) => member.isMainAdmin === 1);
  const { data: projectsResponse } = useQuery<{ data: CrmProjectWithDetails[] }>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500").then((res) => res.json()),
  });
  const { data: policyResponse } = useQuery<TrackingPolicyResponse>({
    queryKey: ["/api/time-tracking/tracking-policy"],
    queryFn: async () => {
      const res = await fetch(trackingPolicyPath(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Tracking Policy");
      return res.json();
    },
  });
  const { data: evidenceResponse, isLoading, isError } = useQuery<ScreenshotsResponse>({
    queryKey: ["/api/time-tracking/screenshots", evidenceUrl],
    queryFn: async () => {
      const res = await fetch(evidenceUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Activity Evidence");
      return res.json();
    },
  });
  const { data: entriesResponse } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time-tracking/entries", entriesUrl],
    queryFn: async () => {
      const res = await fetch(entriesUrl, { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const page = composeActivity({
    now,
    workspaceName,
    currentUserId: user?.id ?? "",
    canReview,
    ownerName: owner ? memberName(owner) : null,
    requestedUserId,
    expandedId,
    policy: policyResponse?.screenshotPolicy ?? null,
    projects: (projectsResponse?.data ?? []).map(toProject),
    entries: (entriesResponse?.data ?? []).map(toEntry),
    users,
    evidence: evidenceResponse?.data ?? [],
  });

  const refusal = page.refusal;

  function onToggle(id: string) {
    setExpandedId((currentId) => (currentId === id ? null : id));
  }

  if (isLoading) {
    return (
      <div className="df-page" data-testid="v2-activity">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Activity</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="df-page" data-testid="v2-activity">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Activity</h1>
            <p className="df-subhead">{page.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Activity Evidence in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-activity">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Activity</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
        <span className="df-count-chip">{page.rows.length}</span>
      </header>

      <section className="df-card" data-testid="v2-activity-policy">
        <div className="df-card-head">
          <h2 className="df-card-title">Tracking Policy</h2>
        </div>
        <div className="df-activity-policy">
          {page.policyLines.map((line) => (
            <div key={line.label} className="df-kv">
              <span>{line.label}</span>
              <span className="df-mono">{line.value}</span>
            </div>
          ))}
        </div>
        <p className="df-empty" style={{ paddingTop: 0 }}>
          {page.policyFootnote}
        </p>
      </section>

      <div className="df-filter-bar">
        <label className="df-filter-chip" data-active={range === "today" ? "true" : "false"}>
          RANGE
          <select value={range} aria-label="Range" onChange={(event) => setRange(event.target.value as typeof range)}>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="df-filter-chip">
          PROJECT
          <select
            value={projectFilter}
            aria-label="Filter by Project"
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="all">All</option>
            {(projectsResponse?.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.project?.name || "Untitled Project"}
              </option>
            ))}
          </select>
        </label>
        {canReview ? (
          <label className="df-filter-chip">
            MEMBER
            <select
              value={userFilter}
              aria-label="Filter by Member"
              onChange={(event) => setUserFilter(event.target.value)}
            >
              <option value="all">All</option>
              {users.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberName(member)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {refusal ? <p className="df-refusal">{refusal}</p> : null}

      <section className="df-card df-activity-register df-activity-stream" data-testid="v2-activity-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>WHEN</span>
            <span>PROJECT</span>
            <span>TASK</span>
            <span>WHO</span>
            <span>SOURCE</span>
            <span />
          </div>
        )}
        {page.empty ? (
          <p className="df-empty">{page.emptyCopy}</p>
        ) : (
          page.rows.map((row) => (
            <div key={row.id}>
              <button
                type="button"
                className="df-register-row df-activity-row"
                aria-expanded={row.expanded}
                data-testid={`v2-activity-row-${row.id}`}
                onClick={() => onToggle(row.id)}
              >
                {layout.stackedRegister ? (
                  <span className="df-project-mobile">
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="df-row-title">{row.project}</div>
                      <div className="df-mono df-meta">
                        {row.when} · {row.task} · {row.source}
                      </div>
                    </span>
                    <span className="df-mono df-meta">{row.who}</span>
                    <span className="df-ghost-link">{row.expanded ? "Close" : "Open"}</span>
                  </span>
                ) : (
                  <>
                    <span className="df-mono df-meta">{row.when}</span>
                    <span className="df-row-title">{row.project}</span>
                    <span className="df-mono df-meta">{row.task}</span>
                    <span>{row.who}</span>
                    <span className="df-mono df-meta">{row.source}</span>
                    <span className="df-ghost-link">{row.expanded ? "Close" : "Open"}</span>
                  </>
                )}
              </button>
              <div
                className="df-activity-expand"
                data-open={row.expanded ? "true" : "false"}
                data-motion={EXPAND_MOTION}
              >
                <div className="df-activity-expand-inner">
                  <div className="df-activity-detail">
                    <img src={row.imageSrc} alt="" />
                    <div className="df-kv">
                      <span>PROJECT</span>
                      <span>{row.project}</span>
                    </div>
                    <div className="df-kv">
                      <span>TASK</span>
                      <span>{row.task}</span>
                    </div>
                    <div className="df-kv">
                      <span>SOURCE</span>
                      <span>{row.source}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
