import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BACK_OFFICE_HOME,
  cancelBody,
  composeWorkspacePage,
  offeredPlanBody,
  platformCancelAtPeriodEndPath,
  platformOfferedPlanPath,
  platformSubscriptionsPath,
  platformTrialExtensionPath,
  platformWorkspacePath,
  platformWorkspacesPath,
  trialExtensionBody,
  workspaceActionDone,
  type PlatformWorkspaceDetail,
  type WorkspaceAction,
} from "./backOffice";
import { notify } from "./notify";
import { BackOfficeRegister, FigureGrid, StatusPill, StripeLink } from "./V2BackOfficeParts";
import { BreakGlassDialog, OperatorWorkspaceSheet } from "./V2BackOfficeAccess";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { SkeletonBand, V2PageSkeleton } from "./V2Skeleton";

export function V2BackOfficeWorkspace({ workspaceId }: { workspaceId: string }) {
  const now = useMemo(() => new Date(), []);
  const path = platformWorkspacePath(workspaceId);
  const { data, isLoading, error } = useQuery<PlatformWorkspaceDetail>({
    queryKey: [path],
    queryFn: () => apiRequest("GET", path),
  });
  const [acting, setActing] = useState<WorkspaceAction | null>(null);
  const [days, setDays] = useState("");
  const [planKey, setPlanKey] = useState(V2_SELECT_NONE);
  const [seats, setSeats] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [breakGlass, setBreakGlass] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: ({ action, body }: { action: WorkspaceAction; body: unknown }) => {
      if (action.kind === "extend-trial") return apiRequest("POST", platformTrialExtensionPath(workspaceId), body);
      if (action.kind === "offer-plan") return apiRequest("POST", platformOfferedPlanPath(workspaceId), body);
      return apiRequest("POST", platformCancelAtPeriodEndPath(workspaceId), body);
    },
    onSuccess: (detail: PlatformWorkspaceDetail, { action }) => {
      queryClient.setQueryData([path], detail);
      queryClient.invalidateQueries({ queryKey: [platformWorkspacesPath()] });
      queryClient.invalidateQueries({ queryKey: [platformSubscriptionsPath()] });
      setActing(null);
      setRefusal(null);
      notify.success(workspaceActionDone(action.kind));
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  if (isLoading) {
    return <V2PageSkeleton title="Workspace" testId="v2-backoffice-workspace" status="Loading this Workspace." frame="fragment">
      <SkeletonBand tiles={4} />
    </V2PageSkeleton>;
  }
  if (error || !data) {
    return (
      <div className="df-backoffice-section" data-testid="v2-backoffice-workspace">
        <Link href={BACK_OFFICE_HOME} className="df-ghost-link">
          Workspaces
        </Link>
        <p className="df-refusal">{error ? (error as Error).message : "This Workspace was not found."}</p>
      </div>
    );
  }

  const page = composeWorkspacePage(data, now);

  function start(action: WorkspaceAction) {
    setRefusal(null);
    setDays(action.daysDefault);
    setSeats("");
    setPlanKey(action.plans[0]?.value ?? V2_SELECT_NONE);
    setActing(action);
  }

  function submit() {
    if (!acting) return;
    if (acting.kind === "extend-trial") {
      const result = trialExtensionBody({ days });
      if (!result.ok) return setRefusal(result.reason);
      return run.mutate({ action: acting, body: result.body });
    }
    if (acting.kind === "offer-plan") {
      const result = offeredPlanBody({ planKey: planKey === V2_SELECT_NONE ? "" : planKey, days, seats });
      if (!result.ok) return setRefusal(result.reason);
      return run.mutate({ action: acting, body: result.body });
    }
    run.mutate({ action: acting, body: cancelBody(acting.kind) });
  }

  return (
    <div className="df-backoffice-section" data-testid="v2-backoffice-workspace">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <Link href={BACK_OFFICE_HOME} className="df-ghost-link">
            Workspaces
          </Link>
          <h2 className="df-title">{page.title}</h2>
          <p className="df-subhead">
            <StatusPill status={page.status} label={page.statusLabel} /> {page.subhead}
          </p>
        </div>
        <Button
          variant="outline"
          type="button"
          className="df-btn"
          onClick={() => setBreakGlass(true)}
          data-testid="v2-backoffice-break-glass-open"
        >
          {page.breakGlass.label}
        </Button>
      </header>

      <section className="df-card" data-testid="v2-backoffice-workspace-facts">
        <FigureGrid figures={page.facts} />
      </section>

      <section className="df-card" data-testid="v2-backoffice-subscription">
        <div className="df-card-head">
          <h2 className="df-card-title">Subscription</h2>
        </div>
        <FigureGrid figures={page.subscription.figures} />
        <div className="df-backoffice-actions">
          {page.subscription.actions.map((action) => (
            <Button
              key={action.kind}
              variant="outline"
              type="button"
              className="df-btn"
              onClick={() => start(action)}
              data-testid={`v2-backoffice-action-${action.kind}`}
            >
              {action.label}
            </Button>
          ))}
          {page.subscription.stripeLinks.map((link) => (
            <StripeLink key={link.href} href={link.href}>
              {link.label}
            </StripeLink>
          ))}
        </div>
        <p className="df-policy-hint df-backoffice-note">
          {page.subscription.stripeNote}
        </p>
      </section>

      <h2 className="df-card-title">Payments</h2>
      <BackOfficeRegister
        columns={["INVOICE", "OUTCOME", "AMOUNT", "WHEN", ""]}
        widths="minmax(0,2fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,0.8fr)"
        emptyCopy={page.payments.emptyCopy}
        testId="v2-backoffice-payments"
        rows={page.payments.rows.map((row) => ({
          key: row.id,
          cells: [
            <span className="df-mono">{row.invoice}</span>,
            <span className="df-status" data-tone={row.failed ? "alert" : "positive"}>{row.outcome}</span>,
            <span className="df-mono">{row.amount}</span>,
            <span className="df-mono df-meta">{row.when}</span>,
            <StripeLink href={row.stripeUrl}>Stripe</StripeLink>,
          ],
        }))}
      />

      <h2 className="df-card-title">Payment disputes</h2>
      <BackOfficeRegister
        columns={["AMOUNT", "REASON", "STATUS", "OPENED", ""]}
        widths="minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,0.8fr)"
        emptyCopy={page.disputes.emptyCopy}
        testId="v2-backoffice-workspace-disputes"
        rows={page.disputes.rows.map((row) => ({
          key: row.id,
          cells: [
            <span className="df-mono">{row.amount}</span>,
            row.reason,
            <span className="df-status" data-tone={row.open ? "alert" : undefined}>{row.status}</span>,
            <span className="df-mono df-meta">{row.opened}</span>,
            <StripeLink href={row.stripeUrl}>Stripe</StripeLink>,
          ],
        }))}
      />

      <h2 className="df-card-title">Support Requests</h2>
      <BackOfficeRegister
        columns={["USER", "CATEGORY", "MESSAGE", "STATUS", "RECEIVED"]}
        widths="minmax(0,1fr) minmax(0,0.8fr) minmax(0,2fr) minmax(0,0.8fr) minmax(0,0.8fr)"
        emptyCopy={page.supportRequests.emptyCopy}
        testId="v2-backoffice-workspace-support"
        rows={page.supportRequests.rows.map((row) => ({
          key: row.id,
          href: row.href,
          cells: [row.user, row.category, row.preview, <span className="df-status">{row.statusLabel}</span>, <span className="df-mono df-meta">{row.when}</span>],
        }))}
      />

      <h2 className="df-card-title">Members</h2>
      <BackOfficeRegister
        columns={["MEMBER", "EMAIL", "WORKSPACE ROLE"]}
        widths="minmax(0,1.5fr) minmax(0,1.5fr) minmax(0,1fr)"
        emptyCopy={page.members.emptyCopy}
        testId="v2-backoffice-members"
        rows={page.members.rows.map((row) => ({
          key: row.id,
          cells: [row.name, <span className="df-mono df-meta">{row.email}</span>, row.archived ? `${row.role} · archived` : row.role],
        }))}
      />

      <h2 className="df-card-title">Audit Events</h2>
      <BackOfficeRegister
        columns={["ACTION", "ACTOR", "RESOURCE", "WHEN"]}
        widths="minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr)"
        emptyCopy={page.auditEvents.emptyCopy}
        testId="v2-backoffice-workspace-audit"
        rows={page.auditEvents.rows.map((row) => ({
          key: row.id,
          cells: [
            <span className="df-mono">{row.action}</span>,
            row.actor,
            <span className="df-mono df-meta">{row.resource}</span>,
            <span className="df-mono df-meta">{row.when}</span>,
          ],
        }))}
      />

      {/* Submit is the confirmation: the dialog states what the action does first. */}
      <V2FormDialog
        open={acting !== null}
        onOpenChange={(open) => {
          if (!open) setActing(null);
        }}
        title={acting?.title ?? ""}
        description={acting?.consequence ?? ""}
        submitLabel={run.isPending ? "Working…" : (acting?.confirmLabel ?? "")}
        pending={run.isPending}
        canSubmit
        onSubmit={submit}
        refusal={refusal}
        testId="v2-backoffice-action-dialog"
      >
        {acting?.fields.includes("plan") ? (
          <div className="df-daily-field">
            PLAN
            <V2FilterSelect
              label=""
              ariaLabel="Plan"
              value={planKey}
              onChange={setPlanKey}
              options={acting.plans}
              testId="v2-backoffice-offer-plan"
            />
          </div>
        ) : null}
        {acting?.fields.includes("days") ? (
          <label className="df-daily-field">
            DAYS (1 to {acting.daysMax})
            <Input
              type="number"
              min={1}
              max={acting.daysMax}
              value={days}
              aria-label="Days"
              onChange={(event) => setDays(event.target.value)}
            />
          </label>
        ) : null}
        {acting?.fields.includes("seats") ? (
          <label className="df-daily-field">
            SEATS (optional)
            <Input
              type="number"
              min={1}
              value={seats}
              aria-label="Seats"
              onChange={(event) => setSeats(event.target.value)}
            />
          </label>
        ) : null}
      </V2FormDialog>

      <BreakGlassDialog
        workspaceId={workspaceId}
        workspaceName={data.name}
        open={breakGlass}
        onOpenChange={setBreakGlass}
        onOpened={setOpened}
      />
      <OperatorWorkspaceSheet workspaceId={opened} onClose={() => setOpened(null)} />
    </div>
  );
}
