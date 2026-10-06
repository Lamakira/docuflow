import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  assigneeOptions,
  backOfficeTabHref,
  composeDisputes,
  composeSupportRequest,
  composeSupportRequests,
  platformDisputesPath,
  platformStaffPath,
  platformSupportAnswersPath,
  platformSupportNotesPath,
  platformSupportRequestPath,
  platformSupportRequestsPath,
  supportStatusFilterOptions,
  validateSupportEntry,
  type PlatformDisputeRow,
  type PlatformStaffOption,
  type PlatformSupportRequestDetail,
  type PlatformSupportRequestRow,
  type SupportStatus,
  type SupportStatusFilter,
} from "./backOffice";
import { notify } from "./notify";
import { BackOfficeRegister, StripeLink } from "./V2BackOfficeParts";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { SkeletonBand, V2PageSkeleton } from "./V2Skeleton";

export function V2BackOfficeDisputes() {
  const now = useMemo(() => new Date(), []);
  const [status, setStatus] = useState<SupportStatusFilter>("open");
  const { data: disputeRows = [], isLoading: disputesLoading, error: disputesError } = useQuery<PlatformDisputeRow[]>({
    queryKey: [platformDisputesPath()],
    queryFn: () => apiRequest("GET", platformDisputesPath()),
  });
  const { data: requestRows = [], isLoading: requestsLoading, error: requestsError } = useQuery<PlatformSupportRequestRow[]>({
    queryKey: [platformSupportRequestsPath()],
    queryFn: () => apiRequest("GET", platformSupportRequestsPath()),
  });
  const disputes = composeDisputes(disputeRows);
  const requests = composeSupportRequests(requestRows, { status }, now);

  return (
    <div className="df-backoffice-section" data-testid="v2-backoffice-disputes">
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">Payment disputes</h2>
          <p className="df-card-sub">{disputes.note}</p>
        </div>
      </div>
      <BackOfficeRegister
        columns={[...disputes.columns, ""]}
        widths="minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,0.8fr)"
        loading={disputesLoading}
        error={disputesError}
        emptyCopy={disputes.emptyCopy}
        foot={disputes.countLabel}
        testId="v2-backoffice-dispute-register"
        rows={disputes.rows.map((row) => ({
          key: row.id,
          testId: `v2-backoffice-dispute-${row.id}`,
          cells: [
            <Link href={row.href} className="df-row-title">{row.workspace}</Link>,
            <span className="df-mono">{row.amount}</span>,
            row.reason,
            <span className="df-status" data-tone={row.open ? "alert" : undefined}>{row.status}</span>,
            <span className="df-mono df-meta">{row.opened}</span>,
            <StripeLink href={row.stripeUrl}>Stripe</StripeLink>,
          ],
        }))}
      />

      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">Support Requests</h2>
          <p className="df-card-sub">Sent by Members from the Help Center. Answers go to the User by email.</p>
        </div>
      </div>
      <div className="df-filter-bar">
        <V2FilterSelect
          label="STATUS"
          ariaLabel="Filter Support Requests by status"
          value={status}
          active={status !== "all"}
          onChange={(next) => setStatus(next as SupportStatusFilter)}
          options={supportStatusFilterOptions}
          testId="v2-backoffice-support-status"
        />
      </div>
      <BackOfficeRegister
        columns={requests.columns}
        widths="minmax(0,1.2fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,2fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,0.7fr)"
        loading={requestsLoading}
        error={requestsError}
        emptyCopy={requests.emptyCopy}
        foot={requests.countLabel}
        testId="v2-backoffice-support-register"
        rows={requests.rows.map((row) => ({
          key: row.id,
          href: row.href,
          testId: `v2-backoffice-support-${row.id}`,
          cells: [
            <span className="df-row-title">{row.workspace}</span>,
            row.user,
            row.category,
            row.preview,
            <span className="df-status">{row.statusLabel}</span>,
            <span className="df-mono df-meta">{row.assignee}</span>,
            <span className="df-mono df-meta">{row.when}</span>,
          ],
        }))}
      />
    </div>
  );
}

export function V2BackOfficeSupportRequest({ requestId }: { requestId: string }) {
  const now = useMemo(() => new Date(), []);
  const path = platformSupportRequestPath(requestId);
  const [body, setBody] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<PlatformSupportRequestDetail>({
    queryKey: [path],
    queryFn: () => apiRequest("GET", path),
  });
  const { data: staff = [] } = useQuery<PlatformStaffOption[]>({
    queryKey: [platformStaffPath()],
    queryFn: () => apiRequest("GET", platformStaffPath()),
  });

  function refreshed(detail: PlatformSupportRequestDetail) {
    queryClient.setQueryData([path], detail);
    queryClient.invalidateQueries({ queryKey: [platformSupportRequestsPath()] });
    setRefusal(null);
  }

  const update = useMutation({
    mutationFn: (patch: { status?: SupportStatus; assignedStaffId?: string | null }) =>
      apiRequest("PATCH", path, patch),
    onSuccess: (detail: PlatformSupportRequestDetail) => {
      refreshed(detail);
      notify.success("Support Request updated");
    },
    onError: (err: Error) => setRefusal(err.message),
  });

  const write = useMutation({
    mutationFn: ({ kind, entry }: { kind: "answer" | "note"; entry: { body: string } }) =>
      apiRequest("POST", kind === "answer" ? platformSupportAnswersPath(requestId) : platformSupportNotesPath(requestId), entry),
    onSuccess: (detail: PlatformSupportRequestDetail, { kind }) => {
      refreshed(detail);
      setBody("");
      notify.success(kind === "answer" ? "Answer sent by email" : "Internal note added");
    },
    onError: (err: Error) => setRefusal(err.message),
  });

  const back = (
    <Link href={backOfficeTabHref("disputes")} className="df-ghost-link">
      Disputes &amp; Support
    </Link>
  );
  if (isLoading) {
    return <V2PageSkeleton title="Support Request" testId="v2-backoffice-support-request" status="Loading this Support Request." frame="fragment">
      <SkeletonBand tiles={4} />
    </V2PageSkeleton>;
  }
  if (error || !data) {
    return (
      <div className="df-backoffice-section" data-testid="v2-backoffice-support-request">
        {back}
        <p className="df-refusal">{error ? (error as Error).message : "This Support Request was not found."}</p>
      </div>
    );
  }

  const page = composeSupportRequest(data, now);
  const entry = validateSupportEntry(body);
  const pending = update.isPending || write.isPending;

  return (
    <div className="df-backoffice-section" data-testid="v2-backoffice-support-request">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          {back}
          <h1 className="df-title">{page.title}</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
      </header>

      <section className="df-card">
        <div className="df-backoffice-lines">
          {page.facts.map((fact) => (
            <div key={fact.label} className="df-backoffice-line">
              <span className="df-analytics-figure-label">{fact.label}</span>
              <span>{fact.value}</span>
            </div>
          ))}
          <Link href={page.workspaceHref} className="df-cta">
            Open Workspace
          </Link>
        </div>
        <div className="df-backoffice-thread">
          <span className="df-analytics-figure-label">MESSAGE</span>
          <div className="df-backoffice-entry" data-testid="v2-backoffice-support-message">{page.message}</div>
        </div>
        <div className="df-filter-bar">
          <V2FilterSelect
            label="STATUS"
            ariaLabel="Support Request status"
            value={page.status}
            disabled={pending}
            onChange={(next) => update.mutate({ status: next as SupportStatus })}
            options={page.statusOptions}
            testId="v2-backoffice-support-set-status"
          />
          <V2FilterSelect
            label="ASSIGNED"
            ariaLabel="Assigned Platform Staff"
            value={page.assignedStaffId ?? V2_SELECT_NONE}
            disabled={pending}
            onChange={(next) => update.mutate({ assignedStaffId: next === V2_SELECT_NONE ? null : next })}
            options={assigneeOptions(staff)}
            testId="v2-backoffice-support-assignee"
          />
        </div>
      </section>

      <section className="df-card" data-testid="v2-backoffice-support-thread">
        <div className="df-card-head">
          <h2 className="df-card-title">Answers and notes</h2>
        </div>
        <div className="df-backoffice-thread">
          {page.entries.length === 0 ? <p className="df-empty df-flush">{page.entriesEmptyCopy}</p> : null}
          {page.entries.map((item) => (
            <div key={item.id} className="df-backoffice-entry" data-kind={item.kind} data-testid={`v2-backoffice-entry-${item.id}`}>
              <span className="df-status" data-tone={item.kind === "answer" ? "positive" : undefined}>{item.label}</span>
              <div>{item.body}</div>
              <div className="df-mono df-meta">{item.author} · {item.when} · {item.detail}</div>
            </div>
          ))}
        </div>
        <form
          className="df-daily-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <Textarea
            value={body}
            rows={5}
            aria-label="Answer or internal note"
            placeholder={page.composer.placeholder}
            onChange={(event) => setBody(event.target.value)}
          />
          <p className="df-policy-hint">{page.composer.answerHint}</p>
          <p className="df-policy-hint">{page.composer.noteHint}</p>
          {refusal ? <p className="df-refusal">{refusal}</p> : null}
          <div className="df-form-actions">
            <Button
              variant="outline"
              type="button"
              className="df-btn"
              disabled={!entry.ok || pending}
              onClick={() => entry.ok && write.mutate({ kind: "note", entry: entry.body })}
              data-testid="v2-backoffice-add-note"
            >
              {page.composer.noteLabel}
            </Button>
            <Button
              variant="default"
              type="button"
              className="df-btn"
              disabled={!entry.ok || pending}
              onClick={() => entry.ok && write.mutate({ kind: "answer", entry: entry.body })}
              data-testid="v2-backoffice-send-answer"
            >
              {page.composer.answerLabel}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
