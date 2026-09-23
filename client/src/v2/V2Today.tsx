import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import type {
  CrmProjectWithDetails,
  Document,
  NotificationWithDetails,
  SafeUser,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { SparkleIcon } from "./icons";
import {
  adminDailyUpdateTodayStatusPath,
  canViewTeamDailyUpdates,
  dailyUpdateRemindRefusal,
  remindDailyUpdatesPath,
} from "./dailyUpdate";
import { motionForSurface } from "./motion";
import { meterTone, statusTone } from "./palette";
import { composeToday, mobileProjectMeta, type TodayInput, type TodayProject } from "./today";
import { V2RefusalPopover } from "./V2RefusalPopover";
import { Button } from "@/components/ui/button";
import { LOADING_SUBHEAD, SkeletonRegister, SkeletonSection } from "./V2Skeleton";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type TimeStats = {
  totalDuration: number;
  byProject: Array<{ crmProjectId: string; totalDuration: number }>;
  byUser: Array<{ userId: string; totalDuration: number }>;
};
type DailyUpdateTodayStatus = {
  missing: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }>;
};

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function statsUrl(start: Date, end: Date): string {
  const params = new URLSearchParams({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  });
  return `/api/time-tracking/stats?${params.toString()}`;
}

function toTodayProject(project: CrmProjectWithDetails): TodayProject {
  return {
    id: project.id,
    projectStatus: project.projectStatus,
    projectType: project.projectType,
    budgetedHours: project.budgetedHours,
    actualHours: project.actualHours,
    project: project.project ? { id: project.project.id, name: project.project.name } : null,
    client: project.client ? { name: project.client.name } : null,
    assignee: project.assignee
      ? {
          firstName: project.assignee.firstName,
          lastName: project.assignee.lastName,
          email: project.assignee.email,
        }
      : null,
  };
}

function TodayActionBar({ onApprovals, onAsk }: { onApprovals: () => void; onAsk: () => void }) {
  return (
    <div className="df-action-bar" data-testid="v2-action-bar">
      <Button variant="default" type="button" className="df-btn df-action-primary" onClick={onApprovals}>
        Resolve approvals
      </Button>
      <button type="button" className="df-action-ask" data-testid="v2-ask" aria-label="Ask DocuFlow" onClick={onAsk}>
        <SparkleIcon />
      </button>
    </div>
  );
}

const REMIND_MOTION = motionForSurface("daily-update-remind").enterExit;

export function V2TodayPage() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { isRunning } = useTimeTracker();
  const { openPanel, layout, memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
  const canViewTeam = canViewTeamDailyUpdates({
    workspaceRole: current?.workspaceRole,
    canViewDailyUpdates: user?.canViewDailyUpdates,
  });
  const [dailyUpdateReminded, setDailyUpdateReminded] = useState(false);
  const [remindRefusal, setRemindRefusal] = useState<string | null>(null);
  const dayStart = useMemo(() => startOfDay(now), [now]);
  const dayEnd = useMemo(() => endOfDay(now), [now]);
  const monthStart = useMemo(() => startOfMonth(now), [now]);

  const { data: projectsResponse, isLoading: projectsLoading } = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500", { credentials: "include" }).then((res) => res.json()),
  });
  const { data: notifications = [] } = useQuery<NotificationWithDetails[]>({
    queryKey: ["/api/notifications"],
  });
  const { data: recentDocuments = [] } = useQuery<Document[]>({
    queryKey: ["/api/documents/recent"],
  });
  const { data: users = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/users"],
  });
  const { data: todayStats } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", "today", dayStart.toISOString()],
    queryFn: () => fetch(statsUrl(dayStart, dayEnd), { credentials: "include" }).then((res) => res.json()),
  });
  const { data: monthStats } = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", "month", monthStart.toISOString()],
    queryFn: () => fetch(statsUrl(monthStart, dayEnd), { credentials: "include" }).then((res) => res.json()),
  });
  const ownerName = useWorkspaceOwnerName();
  const { data: todayStatus } = useQuery<DailyUpdateTodayStatus | null>({
    queryKey: [adminDailyUpdateTodayStatusPath()],
    enabled: canViewTeam,
    queryFn: async () => {
      const res = await fetch(adminDailyUpdateTodayStatusPath(), { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  const input: TodayInput = {
    now,
    currentUserId: user?.id ?? "",
    projects: (projectsResponse?.data ?? []).map(toTodayProject),
    notifications,
    recentDocuments,
    users: users.map((member) => ({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      isArchived: member.isArchived,
    })),
    todaySecondsByUser: todayStats?.byUser ?? [],
    monthSecondsByProject: monthStats?.byProject ?? [],
    missingDailyUpdates: todayStatus ? todayStatus.missing : null,
    trackingUserId: isRunning && user?.id ? user.id : null,
    dailyUpdateReminded,
  };
  const today = composeToday(input);
  const projectTotal = projectsResponse?.total ?? today.projects.length;

  const remind = useMutation({
    mutationFn: () => apiRequest("POST", remindDailyUpdatesPath()),
    onSuccess: () => {
      setDailyUpdateReminded(true);
      setRemindRefusal(null);
      queryClient.invalidateQueries({ queryKey: [adminDailyUpdateTodayStatusPath()] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
    onError: (error: Error) => {
      setRemindRefusal(
        dailyUpdateRemindRefusal({
          workspaceName,
          ownerName,
          errorMessage: error.message,
        }),
      );
    },
  });

  function onRemind() {
    if (readOnly) {
      setRemindRefusal(dailyUpdateRemindRefusal({ workspaceName, ownerName, readOnly: true }));
      return;
    }
    remind.mutate();
  }

  if (projectsLoading) {
    return (
      <div className="df-page df-today" data-testid="v2-today" aria-busy="true">
        <div className="df-today-body">
          <header className="df-today-head">
            <div>
              <h1 className="df-title">Today</h1>
              <p className="df-subhead">{LOADING_SUBHEAD}</p>
            </div>
          </header>
          <p className="df-sr-only" role="status">
            Loading Today for this Workspace.
          </p>
          <SkeletonSection title="Needs attention" lines={3} />
          <SkeletonRegister
            title="Active Projects"
            heads={["PROJECT / CLIENT", "STATUS", "LEAD", "BUDGET USED", "TRACKED MTD"]}
            rows={4}
          />
          <div className="df-split">
            <SkeletonSection title="Workday" lines={3} />
            <SkeletonSection title="Recent knowledge changes" lines={3} />
          </div>
        </div>
        {layout.actionBar ? (
          <TodayActionBar onApprovals={() => openPanel("approvals")} onAsk={() => openPanel("ask")} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="df-page df-today" data-testid="v2-today">
      <div className="df-today-body">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <div className="df-today-title-row">
            <h1 className="df-title">Today</h1>
            <span className="df-date-chip">{today.dateChip}</span>
          </div>
          <p className="df-subhead">{today.subhead}</p>
        </div>
        <Button variant="default" type="button" className="df-btn df-today-resolve" onClick={() => openPanel("approvals")}>
          Resolve approvals
        </Button>
      </header>

      <section className="df-card" data-testid="v2-today-attention">
        <div className="df-card-head">
          <div className="df-cluster">
            <h2 className="df-card-title">Needs attention</h2>
            <span className="df-count-chip">{today.attention.length} ITEMS</span>
          </div>
          <span className="df-mono df-attention-sort" style={{ fontSize: 10, color: "var(--df-muted-ink)", letterSpacing: "0.06em" }}>
            SORTED BY IMPACT
          </span>
        </div>
        {today.attention.length === 0 ? (
          <p className="df-empty">
            Nothing needs attention. This queue is composed from Notifications and Daily Updates in this
            Workspace.
          </p>
        ) : (
          today.attention.map((row) =>
            row.action === "remind" ? (
              <div
                key={row.id}
                className="df-attention-row"
                data-state={row.state}
                data-motion={REMIND_MOTION}
                data-testid="v2-today-remind-row"
              >
                <span className="df-mono df-kind">{row.kind}</span>
                <Link href={row.href} className="df-row-title">
                  {row.title}
                </Link>
                <span className="df-mono df-meta">{row.meta}</span>
                <V2RefusalPopover
                  controlId="remind"
                  failedControlId={remindRefusal ? "remind" : null}
                  message={remindRefusal}
                  testId="v2-today-remind-refusal"
                  onDismiss={() => setRemindRefusal(null)}
                  trigger={
                  <button
                    type="button"
                    className="df-cta"
                    data-testid="v2-today-remind"
                    disabled={row.state === "resolved" || remind.isPending}
                    onClick={onRemind}
                  >
                    {row.cta}
                  </button>
                  }
                />
              </div>
            ) : (
              <Link key={row.id} href={row.href} className="df-attention-row">
                <span className="df-mono df-kind">{row.kind}</span>
                <span className="df-row-title">{row.title}</span>
                <span className="df-mono df-meta">{row.meta}</span>
                <span className="df-cta">{row.cta}</span>
              </Link>
            ),
          )
        )}
      </section>

      <section className="df-card" data-testid="v2-today-projects">
        <div className="df-card-head">
          <h2 className="df-card-title">Active Projects</h2>
          <Link href="/projects" className="df-ghost-link">
            VIEW ALL {projectTotal}
          </Link>
        </div>
        <div className="df-register-head df-desktop-only">
          <span>PROJECT / CLIENT</span>
          <span>STATUS</span>
          <span>LEAD</span>
          <span>BUDGET USED</span>
          <span style={{ textAlign: "right" }}>TRACKED MTD</span>
        </div>
        {today.projects.length === 0 ? (
          <p className="df-empty">No active Projects in this Workspace yet.</p>
        ) : (
          today.projects.map((row) => (
            <Link
              key={row.id}
              href={row.href}
              className="df-register-row"
              data-testid={`v2-project-row-${row.id}`}
            >
              {layout.stackedRegister ? (
                <span className="df-project-mobile">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.name}</div>
                    <div className="df-mono df-meta">{mobileProjectMeta(row)}</div>
                  </span>
                  <span className="df-mono" style={{ fontSize: 11 }}>
                    {row.budgetPercent == null ? "—" : `${row.budgetPercent}%`}
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
                    <span className="df-status" data-status={row.status} data-tone={statusTone(row.status)}>
                      {row.status}
                    </span>
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
                            data-tone={meterTone(row.budgetPercent, row.status)}
                            style={{ width: `${Math.min(100, row.budgetPercent)}%` }}
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
      </section>

      <div className="df-split">
        <section className="df-card" data-testid="v2-today-workday">
          <div className="df-card-head">
            <h2 className="df-card-title">Workday</h2>
            <span className="df-mono" style={{ fontSize: 10, color: "var(--df-archive-slate)" }}>
              {today.workday.memberCount} {today.workday.memberCount === 1 ? "MEMBER" : "MEMBERS"} ·{" "}
              {today.workday.hoursTodayLabel}
            </span>
          </div>
          {today.workday.members.length === 0 ? (
            <p className="df-empty">No members to show for this workday.</p>
          ) : (
            today.workday.members.map((member) => (
              <div key={member.id} className="df-workday-row">
                <span className="df-avatar" data-self={member.self ? "true" : "false"}>
                  {member.initials}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 500, fontSize: 13.5 }}>{member.name}</span>
                {member.state ? (
                  <span className="df-state" data-state={member.state}>
                    {member.state}
                  </span>
                ) : null}
                <span className="df-mono" style={{ width: 52, textAlign: "right", fontSize: 12 }}>
                  {member.hours}
                </span>
              </div>
            ))
          )}
        </section>

        <section className="df-card" data-testid="v2-today-knowledge">
          <div className="df-card-head">
            <h2 className="df-card-title">Recent knowledge changes</h2>
            <span className="df-mono" style={{ fontSize: 10, color: "var(--df-muted-ink)" }}>
              ACCESS-FILTERED
            </span>
          </div>
          {today.knowledge.length === 0 ? (
            <p className="df-empty">No recent knowledge changes you can access.</p>
          ) : (
            today.knowledge.map((row) => (
              <Link key={row.id} href={row.href} className="df-knowledge-row">
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className="df-row-title"
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {row.title}
                  </div>
                  <div className="df-mono df-meta">{row.meta}</div>
                </span>
                <span className="df-mono df-meta">{row.when}</span>
              </Link>
            ))
          )}
        </section>
      </div>
      </div>
      {layout.actionBar ? (
        <TodayActionBar onApprovals={() => openPanel("approvals")} onAsk={() => openPanel("ask")} />
      ) : null}
    </div>
  );
}
