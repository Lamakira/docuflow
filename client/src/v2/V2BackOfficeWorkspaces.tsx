import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  ALL_PLANS,
  composeSubscriptions,
  composeWorkspaceRegister,
  platformSubscriptionsPath,
  planFilterOptions,
  platformWorkspacesPath,
  statusFilterOptions,
  type PlatformWorkspaceRow,
  type StatusFilter,
} from "./backOffice";
import { BackOfficeRegister, StatusPill } from "./V2BackOfficeParts";
import { V2FilterSelect } from "./V2Select";

export function V2BackOfficeWorkspaces() {
  const now = useMemo(() => new Date(), []);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [plan, setPlan] = useState(ALL_PLANS);
  const { data: rows = [], isLoading } = useQuery<PlatformWorkspaceRow[]>({
    queryKey: [platformWorkspacesPath()],
    queryFn: () => apiRequest("GET", platformWorkspacesPath()),
  });
  const register = composeWorkspaceRegister({ rows, query, status, plan, now });

  return (
    <div className="df-backoffice-section" data-testid="v2-backoffice-workspaces">
      <div className="df-filter-bar">
        <label className="df-filter-input">
          <Search width={14} height={14} strokeWidth={1.4} style={{ color: "var(--df-archive-slate)" }} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={register.filterPlaceholder}
            aria-label="Search Workspaces"
          />
        </label>
        <V2FilterSelect
          label="STATE"
          ariaLabel="Filter by state"
          value={status}
          active={status !== "all"}
          onChange={(next) => setStatus(next as StatusFilter)}
          options={statusFilterOptions}
          testId="v2-backoffice-status-filter"
        />
        <V2FilterSelect
          label="PLAN"
          ariaLabel="Filter by Plan"
          value={plan}
          active={plan !== ALL_PLANS}
          onChange={setPlan}
          options={planFilterOptions(rows)}
          testId="v2-backoffice-plan-filter"
        />
      </div>
      <BackOfficeRegister
        columns={register.columns}
        widths="minmax(0,2fr) minmax(0,1.3fr) minmax(0,0.7fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,0.8fr)"
        loading={isLoading}
        emptyCopy={register.emptyCopy}
        foot={register.countLabel}
        testId="v2-backoffice-workspace-register"
        rows={register.rows.map((row) => ({
          key: row.id,
          href: row.href,
          testId: `v2-backoffice-workspace-${row.id}`,
          cells: [
            <>
              <div className="df-row-title">{row.name}</div>
              <div className="df-mono df-meta">{row.owner}</div>
            </>,
            <>
              <StatusPill status={row.status} label={row.planState} />
            </>,
            <span className="df-mono df-meta">
              {row.seats}
              <div>{row.members}</div>
            </span>,
            <span className="df-mono df-meta">{row.ends}</span>,
            <span className="df-mono df-meta">{row.created}</span>,
            <span className="df-mono df-meta">{row.lastActivity}</span>,
          ],
        }))}
      />
    </div>
  );
}

export function V2BackOfficeSubscriptions() {
  const { data: rows = [], isLoading } = useQuery<PlatformWorkspaceRow[]>({
    queryKey: [platformSubscriptionsPath()],
    queryFn: () => apiRequest("GET", platformSubscriptionsPath()),
  });
  const register = composeSubscriptions(rows);
  return (
    <div className="df-backoffice-section" data-testid="v2-backoffice-subscriptions">
      <BackOfficeRegister
        columns={register.columns}
        widths="minmax(0,2fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,1.1fr)"
        loading={isLoading}
        emptyCopy={register.emptyCopy}
        foot={register.countLabel}
        testId="v2-backoffice-subscription-register"
        rows={register.rows.map((row, index) => ({
          key: row.id,
          href: row.href,
          testId: `v2-backoffice-subscription-${row.id}`,
          cells: [
            <>
              <div className="df-row-title">{row.name}</div>
              <div className="df-mono df-meta">{row.owner}</div>
            </>,
            row.plan,
            <span className="df-mono df-meta">{row.interval}</span>,
            <span className="df-mono df-meta">{row.seats}</span>,
            <StatusPill status={rows[index].status} label={row.state} />,
            <span className="df-mono df-meta">{row.ends}</span>,
          ],
        }))}
      />
    </div>
  );
}
