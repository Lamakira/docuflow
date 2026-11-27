import { useMutation, useQuery } from "@tanstack/react-query";
import type { ScreenshotPolicy } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  TRACKING_POLICY_SAVED,
  composeTrackingPolicyEditor,
  normalizeScreenshotPolicy,
  pruneEdits,
  simultaneousTimersOption,
  type SimultaneousTimersSetting,
  workspaceSettingsPath,
  type PolicyEdits,
  type PolicyNumberKey,
} from "./administration";
import { trackingPolicyPath } from "./activity";
import { notify } from "./notify";
import { useEntitlements } from "./plan";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import { SkeletonSection } from "./V2Skeleton";
import { V2LoadFailed } from "./V2EmptyState";
import {
  AdministrationRefused,
  CheckRow,
  WriteRefusal,
  useAdministrationRead,
  useAdministrationWrites,
  type AdministrationContext,
} from "./V2AdministrationParts";

type WorkspaceSettingsResponse = {
  screenshotPolicy: ScreenshotPolicy | null;
  simultaneousTimers?: SimultaneousTimersSetting;
};

/**
 * The Tracking Policy tab. Its edits sit over the policy as read and are held
 * by the page, so another card's save or a refetch never replaces them (F108);
 * the save sends only what changed.
 */
export function V2AdministrationTrackingPolicy({
  context,
  edits,
  onEdits,
}: {
  context: AdministrationContext;
  edits: PolicyEdits;
  onEdits: (edits: PolicyEdits) => void;
}) {
  const settings = useAdministrationRead<WorkspaceSettingsResponse>(workspaceSettingsPath(), "The Tracking Policy", "settings");
  const writes = useAdministrationWrites(context);
  const { data: entitlements } = useEntitlements();
  const screenshotCapacity = entitlements?.screenshotProjectCapacity ?? null;
  const { data: screenshotProjects } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    enabled: screenshotCapacity != null,
    queryFn: () => fetch("/api/crm/projects?pageSize=500", { credentials: "include" }).then((res) => res.json()),
  });

  // A policy that has not been read is not the default policy: saving defaults
  // over a real Tracking Policy would silently reset every Device.
  const saved = settings.data ? normalizeScreenshotPolicy(settings.data.screenshotPolicy) : null;
  const policy = composeTrackingPolicyEditor({
    workspaceName: context.workspaceName,
    workspaceRole: context.workspaceRole,
    ownerName: context.ownerName,
    condition: context.condition,
    saved,
    edits,
  });

  const save = useMutation({
    mutationFn: (patch: Partial<ScreenshotPolicy>) => apiRequest("PATCH", workspaceSettingsPath(), { screenshotPolicy: patch }),
    onSuccess: async (_data, patch) => {
      queryClient.setQueryData<WorkspaceSettingsResponse | null>([workspaceSettingsPath()], (old) =>
        old ? { ...old, screenshotPolicy: { ...normalizeScreenshotPolicy(old.screenshotPolicy), ...patch } } : old,
      );
      onEdits({});
      writes.clear();
      notify.success(TRACKING_POLICY_SAVED);
      await queryClient.invalidateQueries({ queryKey: [workspaceSettingsPath()] });
      queryClient.invalidateQueries({ queryKey: [trackingPolicyPath()] });
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  if (settings.state === "loading") return <SkeletonSection title="Tracking Policy" className="df-policy-form" lines={6} />;

  if (settings.state !== "ready" || policy.kind !== "ready" || !saved) {
    return (
      <section className="df-card" data-testid="v2-administration-tracking-policy">
        <div className="df-card-head">
          <h2 className="df-card-title">Tracking Policy</h2>
        </div>
        {settings.state === "failed" ? (
          <V2LoadFailed title="The Tracking Policy could not be loaded" onRetry={settings.retry} testId="v2-administration-tracking-policy-failed" />
        ) : (
          <AdministrationRefused context={context} />
        )}
      </section>
    );
  }

  const form = policy.form;
  const simultaneous = simultaneousTimersOption(settings.data?.simultaneousTimers);
  const editable = policy.editable;

  function edit(patch: PolicyEdits) {
    onEdits(pruneEdits(saved!, { ...edits, ...patch }));
  }

  function numberField(key: PolicyNumberKey, label: string, ariaLabel: string) {
    return (
      <label className="df-daily-field">
        {label}
        <input
          type="text"
          inputMode="numeric"
          value={form[key]}
          disabled={!editable}
          aria-label={ariaLabel}
          onChange={(event) => edit({ [key]: event.target.value })}
        />
      </label>
    );
  }

  return (
    <section className="df-card df-policy-form" data-testid="v2-administration-tracking-policy">
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">Tracking Policy</h2>
          <p className="df-card-sub">{policy.footnote}</p>
        </div>
      </div>
      <div className="df-daily-form">
        <WriteRefusal refusal={writes.refusal} />
        <CheckRow
          id="df-policy-capture"
          label="Capture Activity Evidence"
          checked={form.screenshotsEnabled}
          disabled={!editable}
          onChange={(next) => edit({ screenshotsEnabled: next })}
        />
        {form.screenshotsEnabled && screenshotCapacity != null ? (
          <div className="df-policy-group" data-testid="v2-administration-screenshot-project">
            <p className="df-policy-hint">
              The {entitlements?.planLabel} Plan captures screenshots on {screenshotCapacity} Project.
              Time on every other Project is still tracked, without screenshots.
            </p>
            <V2FilterSelect
              label="Project"
              ariaLabel="Screenshot Project"
              value={form.screenshotProjectIds?.[0] ?? V2_SELECT_NONE}
              disabled={!editable}
              onChange={(next) => edit({ screenshotProjectIds: next === V2_SELECT_NONE ? null : [next] })}
              options={[
                { value: V2_SELECT_NONE, label: "Choose a Project" },
                ...(screenshotProjects?.data ?? []).map((project) => ({ value: project.id, label: project.name })),
              ]}
              testId="v2-administration-screenshot-project-select"
            />
          </div>
        ) : null}
        {form.screenshotsEnabled ? (
          <div className="df-policy-group">
            <p className="df-policy-hint">A capture lands at a random moment between these two intervals.</p>
            <div className="df-policy-grid">
              {numberField("captureIntervalMinMin", "Minimum interval (minutes)", "Minimum capture interval")}
              {numberField("captureIntervalMaxMin", "Maximum interval (minutes)", "Maximum capture interval")}
            </div>
          </div>
        ) : null}
        <CheckRow
          id="df-policy-active-hours"
          label="Restrict captures to active hours"
          checked={form.activeHoursEnabled}
          disabled={!editable}
          onChange={(next) => edit({ activeHoursEnabled: next })}
        />
        {form.activeHoursEnabled ? (
          <div className="df-policy-group">
            <p className="df-policy-hint">{policy.hints.activeHours}</p>
            <div className="df-policy-grid">
              <label className="df-daily-field">
                Start
                <input
                  type="time"
                  value={form.activeHoursStart}
                  disabled={!editable}
                  aria-label="Active hours start"
                  onChange={(event) => edit({ activeHoursStart: event.target.value })}
                />
              </label>
              <label className="df-daily-field">
                End
                <input
                  type="time"
                  value={form.activeHoursEnd}
                  disabled={!editable}
                  aria-label="Active hours end"
                  onChange={(event) => edit({ activeHoursEnd: event.target.value })}
                />
              </label>
            </div>
          </div>
        ) : null}
        <div className="df-policy-group">
          <p className="df-policy-hint">{policy.hints.lowActivity}</p>
          <div className="df-policy-grid">
            {numberField("lowActivityThresholdPercent", "Low-activity threshold (%)", "Low-activity threshold")}
          </div>
        </div>
        <div className="df-policy-group">
          <p className="df-policy-hint">{policy.hints.idleTimeout}</p>
          <div className="df-policy-grid">{numberField("idleTimeoutMinutes", "Idle timeout (minutes)", "Idle timeout")}</div>
        </div>
        {simultaneous.visible ? (
          <div className="df-policy-group" data-testid="v2-administration-simultaneous-timers">
            <CheckRow
              id="df-policy-simultaneous-timers"
              label={simultaneous.label}
              checked={form.simultaneousTimersEnabled}
              disabled={!editable || (simultaneous.disabled && !form.simultaneousTimersEnabled)}
              onChange={(next) => edit({ simultaneousTimersEnabled: next })}
            />
            <p className="df-policy-hint">{simultaneous.hint}</p>
            {simultaneous.note ? <p className="df-policy-hint">{simultaneous.note}</p> : null}
          </div>
        ) : null}
        <CheckRow
          id="df-policy-idle"
          label="Prompt on idle"
          checked={form.idlePromptEnabled}
          disabled={!editable}
          onChange={(next) => edit({ idlePromptEnabled: next })}
        />
        <p className="df-policy-hint">{policy.hints.prompt}</p>
        {form.idlePromptEnabled ? (
          <div className="df-policy-group">
            <p className="df-policy-hint">{policy.hints.countdown}</p>
            <div className="df-policy-grid">
              {numberField("idleCountdownSeconds", "Prompt countdown (seconds)", "Idle countdown")}
            </div>
          </div>
        ) : null}
      </div>
      <div className="df-form-actions">
        {policy.issue ? (
          <p className="df-form-note df-refusal-inline" role="alert">
            {policy.issue}
          </p>
        ) : (
          <p className="df-form-note">{policy.dirty ? "Unsaved changes." : "No change to save."}</p>
        )}
        <Button
          variant="default"
          type="button"
          disabled={!policy.canSave || save.isPending}
          onClick={() => {
            if (!writes.guard()) return;
            save.mutate(policy.patch);
          }}
          className="df-btn"
        >
          {save.isPending ? "Saving…" : "Save Tracking Policy"}
        </Button>
      </div>
    </section>
  );
}
