import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dailyUpdateStatusOptions, type ProjectDailyUpdateWithDetails } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import {
  adminDailyUpdateKpisPath,
  adminDailyUpdatesPath,
  adminDailyUpdateTodayStatusPath,
  canViewTeamDailyUpdates,
  composeTeamDailyUpdates,
  type TeamDailyUpdateMember,
  type TeamDailyUpdatesKpis,
} from "./dailyUpdate";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect } from "./V2Select";
import { SkeletonSection, V2PageSkeleton } from "./V2Skeleton";

type TodayStatus = {
  submitted: TeamDailyUpdateMember[];
  missing: TeamDailyUpdateMember[];
};

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

export function V2TeamDailyUpdatesPage() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const { memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const canView = canViewTeamDailyUpdates({
    workspaceRole: current?.workspaceRole,
    canViewDailyUpdates: user?.canViewDailyUpdates,
  });

  const [rangeDays, setRangeDays] = useState("7");
  const [filterQuery, setFilterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");

  const startDate = useMemo(() => daysAgo(Number(rangeDays), now), [rangeDays, now]);
  const endDate = useMemo(() => endOfDay(now), [now]);
  const listPath = adminDailyUpdatesPath({ startDate, endDate });
  const kpiPath = adminDailyUpdateKpisPath({ startDate, endDate });

  const ownerName = useWorkspaceOwnerName();

  const { data: updates = [], isLoading: updatesLoading } = useQuery<ProjectDailyUpdateWithDetails[]>({
    queryKey: [listPath],
    enabled: canView,
    queryFn: async () => {
      const res = await fetch(listPath, { credentials: "include" });
      if (res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to fetch Daily Updates");
      return res.json();
    },
  });
  const { data: kpis = null, isLoading: kpisLoading } = useQuery<TeamDailyUpdatesKpis | null>({
    queryKey: [kpiPath],
    enabled: canView,
    queryFn: async () => {
      const res = await fetch(kpiPath, { credentials: "include" });
      if (res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to fetch Daily Update totals");
      return res.json();
    },
  });
  const { data: todayStatus, isLoading: todayLoading } = useQuery<TodayStatus | null>({
    queryKey: [adminDailyUpdateTodayStatusPath()],
    enabled: canView,
    queryFn: async () => {
      const res = await fetch(adminDailyUpdateTodayStatusPath(), { credentials: "include" });
      if (res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to fetch today's Daily Updates");
      return res.json();
    },
  });

  const page = composeTeamDailyUpdates({
    now,
    workspaceName,
    ownerName,
    canView,
    kpis,
    submittedToday: todayStatus?.submitted ?? [],
    missingToday: todayStatus?.missing ?? [],
    updates,
    filterQuery,
    statusFilter,
    memberFilter,
  });

  if (updatesLoading || kpisLoading || todayLoading) {
    return (
      <V2PageSkeleton title="Daily Updates" testId="v2-daily-updates" status="Loading Daily Updates for this Workspace.">
        <SkeletonSection title="Today" tiles={4} />
        <SkeletonSection title="Updates" lines={4} />
      </V2PageSkeleton>
    );
  }

  if (page.kind === "refusal") {
    return (
      <div className="df-page" data-testid="v2-daily-updates">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Daily Updates</h1>
            <p className="df-subhead">Team Daily Updates in {workspaceName}.</p>
          </div>
        </header>
        <p className="df-refusal" data-testid="v2-daily-updates-refusal">
          {page.refusal}
        </p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-daily-updates">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <div className="df-today-title-row">
            <h1 className="df-title">Daily Updates</h1>
            <span className="df-date-chip">{page.dateChip}</span>
          </div>
          <p className="df-subhead">{page.subhead}</p>
        </div>
      </header>

      <section className="df-card">
        <div className="df-kpi-grid">
          {page.kpis.map((kpi) => (
            <div key={kpi.id}>
              <div className="df-kpi-value">{kpi.value}</div>
              <div className="df-kpi-label">{kpi.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="df-card" data-testid="v2-daily-updates-today">
        <div className="df-card-head">
          <h2 className="df-card-title">Today</h2>
          <span className="df-count-chip">
            {page.submitted.length} OF {page.submitted.length + page.missing.length} SUBMITTED
          </span>
        </div>
        <div className="df-rollcall">
          <div>
            <div className="df-mono df-meta">Submitted</div>
            {page.submitted.length === 0 ? (
              <p className="df-empty df-band-y">
                {page.submittedEmptyCopy}
              </p>
            ) : (
              <div className="df-chip-list df-chip-follow">
                {page.submitted.map((member) => (
                  <span key={member.id} className="df-person-chip">
                    {member.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="df-mono df-meta">Missing</div>
            {page.missing.length === 0 ? (
              page.missingEmptyCopy ? (
                <p className="df-empty df-band-y">
                  {page.missingEmptyCopy}
                </p>
              ) : null
            ) : (
              <div className="df-chip-list df-chip-follow">
                {page.missing.map((member) => (
                  <span key={member.id} className="df-person-chip">
                    {member.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="df-filter-bar">
        <label className="df-filter-input">
          <input
            value={filterQuery}
            aria-label="Filter Daily Updates"
            placeholder="Search"
            onChange={(event) => setFilterQuery(event.target.value)}
          />
        </label>
        <V2FilterSelect
          label="RANGE"
          ariaLabel="Range"
          value={rangeDays}
          active={rangeDays === "1"}
          options={[
            { value: "1", label: "Today" },
            { value: "7", label: "Last 7 days" },
            { value: "14", label: "Last 14 days" },
            { value: "30", label: "Last 30 days" },
          ]}
          onChange={setRangeDays}
        />
        <V2FilterSelect
          label="STATUS"
          ariaLabel="Filter by status"
          value={statusFilter}
          active={statusFilter !== "all"}
          options={[
            { value: "all", label: "All" },
            ...dailyUpdateStatusOptions.map((option) => ({ value: option.value, label: option.label })),
          ]}
          onChange={setStatusFilter}
        />
        <V2FilterSelect
          label="MEMBER"
          ariaLabel="Filter by Member"
          value={memberFilter}
          active={memberFilter !== "all"}
          options={[
            { value: "all", label: "All" },
            ...page.members.map((member) => ({ value: member.id, label: member.name })),
          ]}
          onChange={setMemberFilter}
        />
      </div>

      {page.empty ? (
        <p className="df-empty">{page.emptyCopy}</p>
      ) : (
        page.groups.map((group) => (
          <section key={group.userId} className="df-card" data-testid={`v2-daily-updates-group-${group.userId}`}>
            <div className="df-card-head">
              <h2 className="df-card-title">{group.name}</h2>
              <span className="df-count-chip">{group.updates.length}</span>
            </div>
            {group.updates.map((row) => (
              <div key={row.id} className="df-update-body">
                <div className="df-mono df-meta">
                  {row.when} · {row.project} · {row.status}
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
        ))
      )}
    </div>
  );
}
