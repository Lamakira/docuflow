import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  composeAuditLog,
  composeBreakGlass,
  composeOperatorWorkspace,
  composeSupportAccess,
  operatorBreakGlassPath,
  operatorWorkspacePath,
  platformAuditEventsPath,
  platformStaffPath,
  platformSupportAccessPath,
  platformWorkspacesPath,
  validateBreakGlassReason,
  type OperatorWorkspaceView,
  type PlatformAuditEventRow,
  type PlatformStaffOption,
  type PlatformSupportGrant,
  type PlatformWorkspaceRow,
} from "./backOffice";
import { notify } from "./notify";
import { BackOfficeRegister } from "./V2BackOfficeParts";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";

/** A Workspace opened read-only, by a Support Access Grant or by break-glass. */
export function OperatorWorkspaceSheet({ workspaceId, onClose }: { workspaceId: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<OperatorWorkspaceView>({
    queryKey: [operatorWorkspacePath(workspaceId ?? "")],
    enabled: workspaceId !== null,
    queryFn: () => apiRequest("GET", operatorWorkspacePath(workspaceId ?? "")),
  });
  const view = data ? composeOperatorWorkspace(data) : null;
  return (
    <Sheet open={workspaceId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="df-v2" data-testid="v2-backoffice-operator-sheet">
        <SheetHeader>
          <SheetTitle>{view?.title ?? "Workspace"}</SheetTitle>
          <SheetDescription>{view ? `${view.access}. ${view.note}` : "Read-only."}</SheetDescription>
        </SheetHeader>
        {isLoading ? <p className="df-empty">Opening Workspace…</p> : null}
        {error ? <p className="df-refusal">{(error as Error).message}</p> : null}
        {view ? (
          <div className="df-backoffice-lines">
            <span className="df-analytics-figure-label">PROJECTS</span>
            {view.projects.length === 0 ? <p className="df-empty df-flush">{view.emptyCopy}</p> : null}
            {view.projects.map((project) => (
              <div key={project.id} className="df-backoffice-line" data-testid={`v2-backoffice-operator-project-${project.id}`}>
                <span className="df-row-title">{project.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Break-glass: a written reason first, then the Workspace opens read-only. */
export function BreakGlassDialog({
  workspaceId,
  workspaceName,
  open,
  onOpenChange,
  onOpened,
}: {
  workspaceId: string;
  workspaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (workspaceId: string) => void;
}) {
  const copy = composeBreakGlass(workspaceName);
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const validation = validateBreakGlassReason(reason);

  const breakGlass = useMutation({
    mutationFn: (body: { reason: string }) => apiRequest("POST", operatorBreakGlassPath(workspaceId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [platformAuditEventsPath()] });
      queryClient.invalidateQueries({ queryKey: [operatorWorkspacePath(workspaceId)] });
      setReason("");
      setRefusal(null);
      onOpenChange(false);
      notify.success("Break-glass recorded. The Owner is told.");
      onOpened(workspaceId);
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  return (
    <V2FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setRefusal(null);
        onOpenChange(next);
      }}
      title={copy.title}
      description={copy.description}
      submitLabel={breakGlass.isPending ? "Opening…" : copy.submitLabel}
      pending={breakGlass.isPending}
      canSubmit={validation.ok}
      onSubmit={() => {
        if (validation.ok) breakGlass.mutate(validation.body);
      }}
      refusal={refusal}
      testId="v2-backoffice-break-glass"
    >
      <label className="df-daily-field">
        {copy.reasonLabel}
        <Textarea
          value={reason}
          autoFocus
          rows={4}
          aria-label="Break-glass reason"
          placeholder="Why do you need to see this Workspace?"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
    </V2FormDialog>
  );
}

export function V2BackOfficeAccess() {
  const [opened, setOpened] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(V2_SELECT_NONE);
  const [staffId, setStaffId] = useState(V2_SELECT_NONE);
  const [action, setAction] = useState("");

  const { data: grants = [], isLoading: grantsLoading, error: grantsError } = useQuery<PlatformSupportGrant[]>({
    queryKey: [platformSupportAccessPath()],
    queryFn: () => apiRequest("GET", platformSupportAccessPath()),
  });
  const { data: workspaces = [] } = useQuery<PlatformWorkspaceRow[]>({
    queryKey: [platformWorkspacesPath()],
    queryFn: () => apiRequest("GET", platformWorkspacesPath()),
  });
  const { data: staff = [] } = useQuery<PlatformStaffOption[]>({
    queryKey: [platformStaffPath()],
    queryFn: () => apiRequest("GET", platformStaffPath()),
  });
  const filters = {
    workspaceId: workspaceId === V2_SELECT_NONE ? "" : workspaceId,
    platformStaffId: staffId === V2_SELECT_NONE ? "" : staffId,
    action,
  };
  const auditPath = platformAuditEventsPath(filters);
  const { data: events = [], isLoading: eventsLoading, error: eventsError } = useQuery<PlatformAuditEventRow[]>({
    queryKey: [auditPath],
    queryFn: () => apiRequest("GET", auditPath),
  });

  const access = composeSupportAccess(grants);
  const audit = composeAuditLog(events, filters);

  return (
    <div className="df-backoffice-section" data-testid="v2-backoffice-access">
      <section className="df-card">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">My Support Access Grants</h2>
            <p className="df-card-sub">
              Workspaces whose Owner granted you read-only access. A grant expires on its own.
            </p>
          </div>
        </div>
        <BackOfficeRegister
          columns={[...access.columns, ""]}
          widths="minmax(0,2fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr)"
          loading={grantsLoading}
          error={grantsError}
          emptyCopy={access.emptyCopy}
          testId="v2-backoffice-grants"
          rows={access.rows.map((row) => ({
            key: row.id,
            testId: `v2-backoffice-grant-${row.id}`,
            cells: [
              <span className="df-row-title">{row.workspace}</span>,
              <span className="df-mono df-meta">{row.granted}</span>,
              <span className="df-mono df-meta">{row.expires}</span>,
              <Button
                variant="outline"
                type="button"
                className="df-btn"
                onClick={() => setOpened(row.workspaceId)}
                data-testid={`v2-backoffice-open-${row.workspaceId}`}
              >
                Open read-only
              </Button>,
            ],
          }))}
        />
      </section>

      <section data-testid="v2-backoffice-audit" className="df-backoffice-section">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Platform Staff audit log</h2>
            <p className="df-card-sub">What Platform Staff did in Workspaces, newest first. Payloads are never shown.</p>
          </div>
        </div>
        <div className="df-filter-bar">
          <V2FilterSelect
            label="WORKSPACE"
            ariaLabel="Filter by Workspace"
            value={workspaceId}
            active={workspaceId !== V2_SELECT_NONE}
            onChange={setWorkspaceId}
            options={[
              { value: V2_SELECT_NONE, label: "All Workspaces" },
              ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
            ]}
            testId="v2-backoffice-audit-workspace"
          />
          <V2FilterSelect
            label="PLATFORM STAFF"
            ariaLabel="Filter by Platform Staff"
            value={staffId}
            active={staffId !== V2_SELECT_NONE}
            onChange={setStaffId}
            options={[
              { value: V2_SELECT_NONE, label: "All Platform Staff" },
              ...staff.map((member) => ({ value: member.id, label: member.email ?? "Platform Staff" })),
            ]}
            testId="v2-backoffice-audit-staff"
          />
          <label className="df-filter-input">
            <Input
              type="search"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="Action, e.g. break_glass"
              aria-label="Filter by action"
            />
          </label>
        </div>
        <BackOfficeRegister
          columns={audit.columns}
          widths="minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr)"
          loading={eventsLoading}
          error={eventsError}
          emptyCopy={audit.emptyCopy}
          foot={audit.countLabel}
          testId="v2-backoffice-audit-register"
          rows={audit.rows.map((row) => ({
            key: row.id,
            cells: [
              <span className="df-mono">{row.action}</span>,
              row.actor,
              row.workspace,
              <span className="df-mono df-meta">{row.resource}</span>,
              <span className="df-mono df-meta">{row.when}</span>,
            ],
          }))}
        />
      </section>

      <OperatorWorkspaceSheet workspaceId={opened} onClose={() => setOpened(null)} />
    </div>
  );
}
