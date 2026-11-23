import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import type {
  CrmProjectWithDetails,
  Document,
  NotificationWithDetails,
  SafeUser,
} from "@shared/schema";
import { apiRequest, queryClient, throwIfResNotOk } from "@/lib/queryClient";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { SparkleIcon } from "./icons";
import {
  adminDailyUpdateTodayStatusPath,
  canViewTeamDailyUpdates,
  dailyUpdateRemindRefusal,
  remindDailyUpdatesPath,
  remindToastMessage,
} from "./dailyUpdate";
import { isStandingRefusal, notify } from "./notify";
import { meterTone, swatchStyle } from "./palette";
import {
  composeToday,
  mobileProjectMeta,
  TODAY_SECTION_LIMIT,
  todayCardState,
  type ActiveProjectRow,
  type AttentionRow,
  type TodayInput,
  type TodayProject,
} from "./today";
import { V2RefusalPopover } from "./V2RefusalPopover";
import { Button } from "@/components/ui/button";
import { SkeletonLines, SkeletonRows, SkeletonSubhead } from "./V2Skeleton";
import { V2CompactEmpty } from "./V2EmptyState";

type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type TimeStats = {
  totalDuration: number;
  byProject: Array<{ crmProjectId: string; totalDuration: number }>;
  byUser: Array<{ userId: string; totalDuration: number }>;
};
type DailyUpdateTodayStatus = {
  missing: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    remindedToday?: boolean;
  }>;
};
type RemindResult = { date: string; sent: number; missing: number };

/** Parses a read, or throws with the server's message so the card shows an error, not an empty. */
async function readJson<T>(res: Response): Promise<T> {
  await throwIfResNotOk(res);
  return res.json();
}

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
    budgetedMinutes: project.budgetedMinutes,
    trackedSeconds: project.trackedSeconds ?? 0,
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

function TodayActionBar({ onAsk }: { onAsk: () => void }) {
  return (
    <div className="df-action-bar" data-testid="v2-action-bar">
      <button type="button" className="df-action-ask" data-testid="v2-ask" aria-label="Ask DocuFlow" onClick={onAsk}>
        <SparkleIcon />
      </button>
    </div>
  );
}

/** One card's failed read: a compact line and a Retry for that card's queries only. */
function CardError({ section, queries }: { section: string; queries: UseQueryResult<unknown>[] }) {
  return (
    <p className="df-today-error">
      Couldn't load {section}.
      <Button
        variant="outline"
        size="sm"
        type="button"
        className="df-btn"
        onClick={() => {
          for (const query of queries) if (query.isError) void query.refetch();
        }}
      >
        Retry
      </Button>
    </p>
  );
}

function attentionLabel(row: AttentionRow): string {
  return row.meta ? `${row.kind}: ${row.title}, ${row.meta}` : `${row.kind}: ${row.title}`;
}

function projectLabel(row: ActiveProjectRow): string {
  const parts = [row.name, row.meta, row.status];
  if (row.lead) parts.push(`managed by ${row.lead}`);
  if (row.budgetPercent != null) parts.push(`${row.budgetPercent}% of budget used`);
  parts.push(`${row.trackedMtd} tracked this month`);
  return parts.join(", ");
}

const emptyCell = (
  <span className="df-today-none" aria-hidden="true">
    —
  </span>
);

function cardBody({
  loading,
  failed,
  skeleton,
  error,
  children,
}: {
  loading: boolean;
  failed: boolean;
  skeleton: ReactNode;
  error: ReactNode;
  children: ReactNode;
}): ReactNode {
  if (failed) return error;
  if (loading) return skeleton;
  return children;
}

export function V2TodayPage() {
  const [now, setNow] = useState(() => new Date());
  const { user } = useAuth();
  const { isRunning, activeEntry } = useTimeTracker();
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

  // A page left open past midnight moves to the new day when the reader comes back to it.
  useEffect(() => {
    let shownDay = startOfDay(new Date()).getTime();
    const refresh = () => {
      const next = new Date();
      const day = startOfDay(next).getTime();
      if (day !== shownDay) {
        // Time stats key on the day; these reads do not, so a new day refetches them.
        shownDay = day;
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        queryClient.invalidateQueries({ queryKey: [adminDailyUpdateTodayStatusPath()] });
        queryClient.invalidateQueries({ queryKey: ["/api/documents/recent"] });
      }
      setNow(next);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const projectsQuery = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    queryFn: () => fetch("/api/crm/projects?pageSize=500", { credentials: "include" }).then(readJson<ProjectsResponse>),
  });
  const notificationsQuery = useQuery<NotificationWithDetails[]>({
    queryKey: ["/api/notifications"],
  });
  const recentDocumentsQuery = useQuery<Document[]>({
    queryKey: ["/api/documents/recent"],
  });
  const usersQuery = useQuery<SafeUser[]>({
    queryKey: ["/api/users"],
  });
  const todayStatsQuery = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", "today", dayStart.toISOString()],
    queryFn: () => fetch(statsUrl(dayStart, dayEnd), { credentials: "include" }).then(readJson<TimeStats>),
  });
  const monthStatsQuery = useQuery<TimeStats>({
    queryKey: ["/api/time-tracking/stats", "month", monthStart.toISOString()],
    queryFn: () => fetch(statsUrl(monthStart, dayEnd), { credentials: "include" }).then(readJson<TimeStats>),
  });
  const ownerName = useWorkspaceOwnerName();
  const todayStatusQuery = useQuery<DailyUpdateTodayStatus | null>({
    queryKey: [adminDailyUpdateTodayStatusPath()],
    enabled: canViewTeam,
    queryFn: async () => {
      const res = await fetch(adminDailyUpdateTodayStatusPath(), { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      return readJson<DailyUpdateTodayStatus>(res);
    },
  });
  const projectsResponse = projectsQuery.data;
  const notifications = notificationsQuery.data ?? [];
  const recentDocuments = recentDocumentsQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const todayStats = todayStatsQuery.data;
  const monthStats = monthStatsQuery.data;
  const todayStatus = todayStatusQuery.data;

  // Each card waits on, fails with and retries its own reads (#370, F19).
  const attentionQueries = canViewTeam ? [notificationsQuery, todayStatusQuery] : [notificationsQuery];
  const projectQueries = [projectsQuery, monthStatsQuery];
  const workdayQueries = canViewTeam ? [usersQuery, todayStatsQuery, todayStatusQuery] : [usersQuery, todayStatsQuery];
  const knowledgeQueries = [recentDocumentsQuery, usersQuery];
  const { loading: attentionLoading, failed: attentionFailed, ready: attentionReady } = todayCardState(attentionQueries);
  const { loading: projectsLoading, failed: projectsFailed, ready: projectsReady } = todayCardState(projectQueries);
  const { loading: workdayLoading, failed: workdayFailed, ready: workdayReady } = todayCardState(workdayQueries);
  const { loading: knowledgeLoading, failed: knowledgeFailed, ready: knowledgeReady } = todayCardState(knowledgeQueries);
  const anyLoading = attentionLoading || projectsLoading || workdayLoading || knowledgeLoading;

  const input: TodayInput = {
    now,
    currentUserId: user?.id ?? "",
    projects: (projectsResponse?.data ?? []).map(toTodayProject),
    notifications,
    recentDocuments: recentDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      updatedAt: document.updatedAt,
      projectId: document.projectId,
      createdById: document.createdById,
    })),
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
    openTimer: activeEntry ? { startTime: activeEntry.startTime } : null,
    dailyUpdateReminded,
  };
  const today = composeToday(input);

  const remind = useMutation({
    mutationFn: (): Promise<RemindResult> => apiRequest("POST", remindDailyUpdatesPath()),
    onSuccess: (result) => {
      setDailyUpdateReminded(true);
      setRemindRefusal(null);
      queryClient.invalidateQueries({ queryKey: [adminDailyUpdateTodayStatusPath()] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      notify.success(remindToastMessage(result));
    },
    onError: (error: Error) => {
      if (error.message && !isStandingRefusal(error)) return notify.error(error);
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

  return (
    <div className="df-page df-today" data-testid="v2-today" aria-busy={anyLoading ? "true" : undefined}>
      <div className="df-today-body">
      <header className="df-today-head">
        <div className="df-today-headline">
          <div className="df-today-title-row">
            <h1 className="df-title">Today</h1>
            <span className="df-date-chip">{today.dateChip}</span>
          </div>
          {attentionFailed ? null : attentionLoading ? <SkeletonSubhead /> : <p className="df-subhead">{today.subhead}</p>}
        </div>
      </header>
      {anyLoading ? (
        <p className="df-sr-only" role="status">
          Loading Today for this Workspace.
        </p>
      ) : null}

      <section className="df-card" data-testid="v2-today-attention">
        <div className="df-card-head">
          <div className="df-cluster">
            <h2 className="df-card-title">Needs attention</h2>
            {attentionReady ? <span className="df-count-chip">{today.attentionTotal} items</span> : null}
          </div>
          {attentionReady && today.attentionTotal > TODAY_SECTION_LIMIT ? (
            <Button
              variant="outline"
              type="button"
              className="df-btn"
              data-testid="v2-today-attention-all"
              onClick={() => openPanel("notifications")}
            >
              View all
            </Button>
          ) : null}
        </div>
        {cardBody({
          loading: attentionLoading,
          failed: attentionFailed,
          skeleton: <SkeletonLines count={3} />,
          error: <CardError section="Needs attention" queries={attentionQueries} />,
          children:
            today.attention.length === 0 ? (
              <V2CompactEmpty>
                Nothing needs attention. This queue is composed from Notifications and Daily Updates in this
                Workspace.
              </V2CompactEmpty>
            ) : (
              today.attention.map((row) =>
                row.action === "remind" ? (
                  <div
                    key={row.id}
                    className="df-attention-row df-attention-remind"
                    data-state={row.state}
                    data-testid="v2-today-remind-row"
                  >
                    <span className="df-mono df-kind">{row.kind}</span>
                    <Link href={row.href} className="df-row-title" aria-label={attentionLabel(row)}>
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
                ) : row.action === "notifications" ? (
                  <button
                    key={row.id}
                    type="button"
                    className="df-attention-row"
                    aria-label={attentionLabel(row)}
                    onClick={() => openPanel("notifications")}
                  >
                    <span className="df-mono df-kind">{row.kind}</span>
                    <span className="df-row-title">{row.title}</span>
                    <span className="df-mono df-meta">{row.meta}</span>
                    <span className="df-cta">{row.cta}</span>
                  </button>
                ) : (
                  <Link key={row.id} href={row.href} className="df-attention-row" aria-label={attentionLabel(row)}>
                    <span className="df-mono df-kind">{row.kind}</span>
                    <span className="df-row-title">{row.title}</span>
                    <span className="df-mono df-meta">{row.meta}</span>
                    <span className="df-cta">{row.cta}</span>
                  </Link>
                ),
              )
            ),
        })}
      </section>

      <section className="df-card" data-testid="v2-today-projects">
        <div className="df-card-head">
          <div className="df-cluster">
            <h2 className="df-card-title">Active Projects</h2>
            {projectsReady ? <span className="df-count-chip">{today.projectsTotal}</span> : null}
          </div>
          <Link href="/projects" className="df-ghost-link">
            View all
          </Link>
        </div>
        {projectsReady && today.projects.length > 0 ? (
          <div className="df-register-head df-desktop-only">
            <span>Project / client</span>
            <span>Status</span>
            <span>Project manager</span>
            <span>Budget used</span>
            <span className="df-today-end">Tracked MTD</span>
          </div>
        ) : null}
        {cardBody({
          loading: projectsLoading,
          failed: projectsFailed,
          skeleton: <SkeletonRows columns={5} rows={4} />,
          error: <CardError section="Active Projects" queries={projectQueries} />,
          children:
            today.projects.length === 0 ? (
              <V2CompactEmpty>No Projects tracked this month yet.</V2CompactEmpty>
            ) : (
              today.projects.map((row) => (
                <Link
                  key={row.id}
                  href={row.href}
                  className="df-register-row"
                  data-testid={`v2-project-row-${row.id}`}
                  aria-label={projectLabel(row)}
                >
                  <span className="df-project-mobile">
                    <span className="df-today-stacked-text">
                      <div className="df-row-title">{row.name}</div>
                      <div className="df-mono df-meta">{mobileProjectMeta(row)}</div>
                    </span>
                    {row.budgetPercent == null ? (
                      emptyCell
                    ) : (
                      <span className="df-mono df-today-percent">{row.budgetPercent}%</span>
                    )}
                  </span>
                  <span className="df-today-cell df-desktop-only">
                    <div className="df-row-title df-today-ellipsis">{row.name}</div>
                    <div className="df-mono df-meta">{row.meta}</div>
                  </span>
                  <span className="df-today-cell df-desktop-only">
                    <span className="df-status" data-status={row.status} data-swatch="" style={swatchStyle(row.statusColor)}>
                      {row.status}
                    </span>
                  </span>
                  <span className="df-today-cell df-desktop-only df-today-manager">{row.lead ?? emptyCell}</span>
                  <span className="df-today-cell df-desktop-only">
                    {row.budgetPercent == null ? (
                      emptyCell
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
                        <span className="df-mono df-today-percent">{row.budgetPercent}%</span>
                      </span>
                    )}
                  </span>
                  <span className="df-today-cell df-desktop-only df-mono df-today-hours df-today-end">
                    {row.trackedMtd}
                  </span>
                </Link>
              ))
            ),
        })}
      </section>

      <div className="df-split">
        <section className="df-card" data-testid="v2-today-workday">
          <div className="df-card-head">
            <h2 className="df-card-title">Workday</h2>
            {workdayReady ? (
              <span className="df-mono df-today-card-meta">
                {today.workday.memberCount} {today.workday.memberCount === 1 ? "member" : "members"} ·{" "}
                {today.workday.hoursTodayLabel}
              </span>
            ) : null}
          </div>
          {workdayReady && today.workday.openTimerSince ? (
            <p className="df-today-timer">{today.workday.openTimerSince}</p>
          ) : null}
          {cardBody({
            loading: workdayLoading,
            failed: workdayFailed,
            skeleton: <SkeletonLines count={3} />,
            error: <CardError section="Workday" queries={workdayQueries} />,
            children:
              today.workday.members.length === 0 ? (
                <V2CompactEmpty>No members to show for this workday.</V2CompactEmpty>
              ) : (
                today.workday.members.map((member) => (
                  <div key={member.id} className="df-workday-row">
                    <span className="df-avatar" data-self={member.self ? "true" : "false"}>
                      {member.initials}
                    </span>
                    <span className="df-workday-name">
                      {member.name}
                      {member.self ? <span className="df-workday-you">You</span> : null}
                    </span>
                    {member.state ? (
                      <span className="df-state" data-state={member.state}>
                        {member.state}
                      </span>
                    ) : null}
                    <span className="df-mono df-workday-hours">{member.hours}</span>
                  </div>
                ))
              ),
          })}
        </section>

        <section className="df-card" data-testid="v2-today-knowledge">
          <div className="df-card-head">
            <h2 className="df-card-title">Recent knowledge changes</h2>
            {knowledgeReady && today.knowledgeTotal > TODAY_SECTION_LIMIT ? (
              <Link href="/project-documentation" className="df-ghost-link" data-testid="v2-today-knowledge-all">
                View all
              </Link>
            ) : null}
          </div>
          {cardBody({
            loading: knowledgeLoading,
            failed: knowledgeFailed,
            skeleton: <SkeletonLines count={3} />,
            error: <CardError section="Recent knowledge changes" queries={knowledgeQueries} />,
            children:
              today.knowledge.length === 0 ? (
                <V2CompactEmpty>No recent knowledge changes you can access.</V2CompactEmpty>
              ) : (
                today.knowledge.map((row) => (
                  <Link
                    key={row.id}
                    href={row.href}
                    className="df-knowledge-row"
                    aria-label={`${row.title}, ${row.meta}, ${row.when}`}
                  >
                    <span className="df-today-stacked-text">
                      <div className="df-row-title df-today-ellipsis">{row.title}</div>
                      <div className="df-mono df-meta">{row.meta}</div>
                    </span>
                    <span className="df-mono df-meta">{row.when}</span>
                  </Link>
                ))
              ),
          })}
        </section>
      </div>
      </div>
      {layout.actionBar ? <TodayActionBar onAsk={() => openPanel("ask")} /> : null}
    </div>
  );
}
