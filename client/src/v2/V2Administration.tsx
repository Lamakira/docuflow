import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PUBLIC_API_CAPABILITIES,
  WEBHOOK_EVENT_TYPES,
  type ScreenshotPolicy,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  addAllowedTimezone,
  administrationWriteRefusal,
  analyticsActivityPath,
  analyticsCoveragePath,
  analyticsDevicesPath,
  analyticsOverviewPath,
  analyticsRange,
  ANALYTICS_RANGE_PRESETS,
  billingCancelPath,
  billingCheckoutPath,
  billingPaymentMethodPath,
  billingSeatsPath,
  billingSubscriptionPath,
  canManageAdministration,
  composeAdministration,
  composeAnalytics,
  composeTrackingPolicyEditor,
  hostedBillingSession,
  normalizeScreenshotPolicy,
  workspaceSettingsPath,
  removeAllowedTimezone,
  rotateServiceAccountPath,
  rotateWebhookEndpointPath,
  revokeServiceAccountPath,
  serviceAccountsPath,
  webhookDisablePath,
  webhookEnablePath,
  webhookEndpointsPath,
  type AnalyticsActivityInput,
  type AnalyticsCoverageInput,
  type AnalyticsDeviceInput,
  type AnalyticsFigure,
  type AnalyticsOverviewInput,
  type AnalyticsRangePreset,
  type BillingInput,
  type RevealedSecretInput,
  type ServiceAccountInput,
  type WebhookEndpointInput,
} from "./administration";
import { trackingPolicyPath } from "./activity";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { useV2Chrome } from "./V2Shell";

type WorkspaceMembershipsResponse = {
  memberships: Array<{
    firstName: string | null;
    lastName: string | null;
    email: string;
    workspaceRole: string;
  }>;
};

const SECRET_MOTION = motionForSurface("secret-once").enterExit;
const POLICY_SAVED_MOTION = motionForSurface("tracking-policy-save").enterExit;

type WorkspaceSettingsResponse = {
  screenshotPolicy: ScreenshotPolicy | null;
  allowedTimezones: string[] | null;
};

function returnUrl(): string {
  return `${window.location.origin}/administration`;
}

/**
 * Reads behind the Administration gate. A 403 is that gate, so it becomes `null`
 * and composes into the named Capability refusal rather than an empty surface.
 */
async function readBehindAdministration<T>(path: string): Promise<T | null> {
  const res = await fetch(path, { credentials: "include" });
  if (res.status === 403) return null;
  if (!res.ok) throw new Error(`Failed to read ${path}`);
  return res.json();
}

export function V2AdministrationPage() {
  const { layout, memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const workspaceRole = current?.workspaceRole ?? "MEMBER";
  const condition = current?.condition ?? null;
  const canManage = canManageAdministration(workspaceRole);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountCapabilities, setAccountCapabilities] = useState<string[]>([]);
  const [creatingEndpoint, setCreatingEndpoint] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [seatQuantity, setSeatQuantity] = useState("");
  const [revealedSecret, setRevealedSecret] = useState<RevealedSecretInput | null>(null);
  const [actionRefusal, setActionRefusal] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<AnalyticsRangePreset>("7d");
  const [rangeAnchor] = useState(() => new Date());
  const [policyDraft, setPolicyDraft] = useState<ScreenshotPolicy>(() => normalizeScreenshotPolicy(null));
  const [timezoneDraft, setTimezoneDraft] = useState<string[]>([]);
  const [timezoneInput, setTimezoneInput] = useState("");
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [policySaved, setPolicySaved] = useState(false);

  const range = useMemo(() => analyticsRange(rangePreset, rangeAnchor), [rangePreset, rangeAnchor]);

  const { data: people, isLoading: peopleLoading } = useQuery<WorkspaceMembershipsResponse>({
    queryKey: ["/api/workspace/memberships"],
    queryFn: async () => {
      const res = await fetch("/api/workspace/memberships", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Memberships");
      return res.json();
    },
  });
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<ServiceAccountInput[]>({
    queryKey: [serviceAccountsPath()],
    enabled: canManage,
    queryFn: async () => {
      const res = await fetch(serviceAccountsPath(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Service Accounts");
      return res.json();
    },
  });
  const { data: endpoints = [], isLoading: endpointsLoading } = useQuery<WebhookEndpointInput[]>({
    queryKey: [webhookEndpointsPath()],
    enabled: canManage,
    queryFn: async () => {
      const res = await fetch(webhookEndpointsPath(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Webhook Endpoints");
      return res.json();
    },
  });
  const { data: billing, isLoading: billingLoading } = useQuery<BillingInput | null>({
    queryKey: [billingSubscriptionPath()],
    enabled: canManage,
    queryFn: async () => {
      const res = await fetch(billingSubscriptionPath(), { credentials: "include" });
      if (res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to fetch billing");
      return res.json();
    },
  });

  const { data: overview, isLoading: overviewLoading, isError: overviewFailed } = useQuery<AnalyticsOverviewInput | null>({
    queryKey: [analyticsOverviewPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsOverviewInput>(analyticsOverviewPath(range)),
  });
  const { data: activity, isLoading: activityLoading, isError: activityFailed } = useQuery<AnalyticsActivityInput | null>({
    queryKey: [analyticsActivityPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsActivityInput>(analyticsActivityPath(range)),
  });
  const { data: coverage, isLoading: coverageLoading, isError: coverageFailed } = useQuery<AnalyticsCoverageInput | null>({
    queryKey: [analyticsCoveragePath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsCoverageInput>(analyticsCoveragePath(range)),
  });
  const {
    data: analyticsDevices,
    isLoading: analyticsDevicesLoading,
    isError: analyticsDevicesFailed,
  } = useQuery<AnalyticsDeviceInput[] | null>({
    queryKey: [analyticsDevicesPath()],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsDeviceInput[]>(analyticsDevicesPath()),
  });
  const { data: workspaceSettings, isLoading: workspaceSettingsLoading } =
    useQuery<WorkspaceSettingsResponse | null>({
      queryKey: [workspaceSettingsPath()],
      enabled: canManage,
      queryFn: () => readBehindAdministration<WorkspaceSettingsResponse>(workspaceSettingsPath()),
    });

  const analyticsLoading =
    overviewLoading || activityLoading || coverageLoading || analyticsDevicesLoading;
  const analyticsRefused =
    overview === null || activity === null || coverage === null || analyticsDevices === null;
  const analyticsFailed =
    overviewFailed || activityFailed || coverageFailed || analyticsDevicesFailed;
  const settingsRefused = workspaceSettings === null;
  // A policy that has not been read is not the default policy — saving defaults
  // over a real Tracking Policy would silently reset every Device.
  const savedPolicy = workspaceSettings
    ? normalizeScreenshotPolicy(workspaceSettings.screenshotPolicy)
    : null;
  const savedTimezones = workspaceSettings?.allowedTimezones ?? [];

  useEffect(() => {
    if (!workspaceSettings) return;
    setPolicyDraft(normalizeScreenshotPolicy(workspaceSettings.screenshotPolicy));
    setTimezoneDraft(workspaceSettings.allowedTimezones ?? []);
  }, [workspaceSettings]);

  const owner = (people?.memberships ?? []).find((row) => row.workspaceRole === "OWNER");
  const ownerName = owner ? memberName(owner) : null;
  const page = composeAdministration({
    workspaceName,
    ownerName,
    workspaceRole,
    condition,
    serviceAccounts: accounts,
    webhookEndpoints: endpoints,
    billing: billing ?? null,
    revealedSecret,
  });
  const analytics = composeAnalytics({
    now: rangeAnchor,
    workspaceRole,
    ownerName,
    range,
    overview: overview ?? null,
    activity: activity ?? null,
    coverage: coverage ?? null,
    devices: analyticsDevices ?? [],
    refused: analyticsRefused,
    readFailed: analyticsFailed,
  });
  const trackingPolicy = composeTrackingPolicyEditor({
    workspaceName,
    workspaceRole,
    ownerName,
    condition,
    saved: savedPolicy,
    draft: policyDraft,
    savedTimezones,
    draftTimezones: timezoneDraft,
    justSaved: policySaved,
    refused: settingsRefused,
  });

  function refuseWrite(message: string) {
    setActionRefusal(
      administrationWriteRefusal({
        kind: "error",
        workspaceName,
        ownerName,
        errorMessage: message,
      }),
    );
  }

  function onReadOnly() {
    setActionRefusal(
      administrationWriteRefusal({
        kind: "workspace-condition",
        workspaceName,
        condition: "Read-only",
      }),
    );
  }

  const createAccount = useMutation({
    mutationFn: () =>
      apiRequest("POST", serviceAccountsPath(), {
        name: accountName.trim(),
        capabilityIds: accountCapabilities,
      }),
    onSuccess: (created: ServiceAccountInput & { plaintextKey?: string }) => {
      queryClient.invalidateQueries({ queryKey: [serviceAccountsPath()] });
      setCreatingAccount(false);
      setAccountName("");
      setAccountCapabilities([]);
      setActionRefusal(null);
      if (created.plaintextKey) {
        setRevealedSecret({
          kind: "service-account",
          id: created.id,
          label: created.name,
          plaintext: created.plaintextKey,
        });
      }
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const createEndpoint = useMutation({
    mutationFn: () =>
      apiRequest("POST", webhookEndpointsPath(), {
        url: endpointUrl.trim(),
        eventTypes,
      }),
    onSuccess: (created: WebhookEndpointInput & { plaintextSecret?: string }) => {
      queryClient.invalidateQueries({ queryKey: [webhookEndpointsPath()] });
      setCreatingEndpoint(false);
      setEndpointUrl("");
      setEventTypes([]);
      setActionRefusal(null);
      if (created.plaintextSecret) {
        setRevealedSecret({
          kind: "webhook-endpoint",
          id: created.id,
          label: created.url,
          plaintext: created.plaintextSecret,
        });
      }
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const startCheckout = useMutation({
    mutationFn: async () => {
      const seats = Math.max(billing?.consumedSeatCount ?? 1, billing?.purchasedSeatCapacity ?? 1, 1);
      const session = await apiRequest("POST", billingCheckoutPath(), {
        planKey: "pro",
        seatQuantity: seats,
        successUrl: returnUrl(),
        cancelUrl: returnUrl(),
      });
      const redirect = hostedBillingSession({ url: session.url });
      window.location.assign(redirect.url);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const changeSeats = useMutation({
    mutationFn: () => apiRequest("POST", billingSeatsPath(), { seatQuantity: Number(seatQuantity) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [billingSubscriptionPath()] });
      setSeatQuantity("");
      setActionRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const updatePaymentMethod = useMutation({
    mutationFn: async () => {
      const session = await apiRequest("POST", billingPaymentMethodPath(), { returnUrl: returnUrl() });
      const redirect = hostedBillingSession({ url: session.url });
      window.location.assign(redirect.url);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const saveTrackingPolicy = useMutation({
    mutationFn: () => apiRequest("PATCH", workspaceSettingsPath(), { screenshotPolicy: policyDraft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [workspaceSettingsPath()] });
      queryClient.invalidateQueries({ queryKey: [trackingPolicyPath()] });
      setActionRefusal(null);
      setPolicySaved(true);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const saveTimezones = useMutation({
    mutationFn: () => apiRequest("PATCH", workspaceSettingsPath(), { allowedTimezones: timezoneDraft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [workspaceSettingsPath()] });
      setActionRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const cancelAtPeriodEnd = useMutation({
    mutationFn: () => apiRequest("POST", billingCancelPath(), {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [billingSubscriptionPath()] });
      setActionRefusal(null);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  function guardWrite(): boolean {
    if (condition === "Read-only") {
      onReadOnly();
      return false;
    }
    return true;
  }

  async function onRotateAccount(id: string, label: string) {
    if (!guardWrite()) return;
    try {
      const rotated = await apiRequest("POST", rotateServiceAccountPath(id));
      queryClient.invalidateQueries({ queryKey: [serviceAccountsPath()] });
      setActionRefusal(null);
      if (rotated.plaintextKey) {
        setRevealedSecret({
          kind: "service-account",
          id,
          label,
          plaintext: rotated.plaintextKey,
        });
      }
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Rotate failed");
    }
  }

  async function onRevokeAccount(id: string) {
    if (!guardWrite()) return;
    try {
      await apiRequest("POST", revokeServiceAccountPath(id));
      queryClient.invalidateQueries({ queryKey: [serviceAccountsPath()] });
      setActionRefusal(null);
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Revoke failed");
    }
  }

  async function onRotateEndpoint(id: string, label: string) {
    if (!guardWrite()) return;
    try {
      const rotated = await apiRequest("POST", rotateWebhookEndpointPath(id));
      queryClient.invalidateQueries({ queryKey: [webhookEndpointsPath()] });
      setActionRefusal(null);
      if (rotated.plaintextSecret) {
        setRevealedSecret({
          kind: "webhook-endpoint",
          id,
          label,
          plaintext: rotated.plaintextSecret,
        });
      }
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Rotate failed");
    }
  }

  async function onDisableEndpoint(id: string) {
    if (!guardWrite()) return;
    try {
      await apiRequest("POST", webhookDisablePath(id));
      queryClient.invalidateQueries({ queryKey: [webhookEndpointsPath()] });
      setActionRefusal(null);
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Disable failed");
    }
  }

  async function onEnableEndpoint(id: string) {
    if (!guardWrite()) return;
    try {
      await apiRequest("POST", webhookEnablePath(id));
      queryClient.invalidateQueries({ queryKey: [webhookEndpointsPath()] });
      setActionRefusal(null);
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Enable failed");
    }
  }

  function editPolicy(patch: Partial<ScreenshotPolicy>) {
    setPolicySaved(false);
    setPolicyDraft((current) => ({ ...current, ...patch }));
  }

  function policyNumber(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function onAddTimezone() {
    const edit = addAllowedTimezone(timezoneDraft, timezoneInput);
    if (!edit.ok) {
      setTimezoneError(edit.reason);
      return;
    }
    setTimezoneDraft(edit.timezones);
    setTimezoneInput("");
    setTimezoneError(null);
  }

  function onCreateAccount(event: FormEvent) {
    event.preventDefault();
    if (!guardWrite()) return;
    if (!accountName.trim()) return;
    createAccount.mutate();
  }

  function onCreateEndpoint(event: FormEvent) {
    event.preventDefault();
    if (!guardWrite()) return;
    if (!endpointUrl.trim() || eventTypes.length === 0) return;
    createEndpoint.mutate();
  }

  if (
    !memberships ||
    peopleLoading ||
    (canManage && (accountsLoading || endpointsLoading || billingLoading || workspaceSettingsLoading))
  ) {
    return (
      <div className="df-page" data-testid="v2-administration">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Administration</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
    );
  }

  if (page.kind === "refusal") {
    return (
      <div className="df-page" data-testid="v2-administration">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Administration</h1>
            <p className="df-subhead">Operator controls for {workspaceName}.</p>
          </div>
        </header>
        <p className="df-refusal" data-testid="v2-administration-refusal">
          {page.refusal}
        </p>
      </div>
    );
  }

  const shownRefusal = actionRefusal ?? page.writeRefusal;

  return (
    <div className="df-page" data-testid="v2-administration">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Administration</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
      </header>

      {shownRefusal ? <p className="df-refusal">{shownRefusal}</p> : null}

      <section className="df-card df-analytics-register" data-testid="v2-administration-analytics">
        <div className="df-card-head">
          <h2 className="df-card-title">Analytics</h2>
          {analytics.kind === "ready" ? (
            <span className="df-mono df-meta">{analytics.rangeLabel}</span>
          ) : null}
        </div>
        {analytics.kind === "refusal" ? (
          <p className="df-refusal" data-testid="v2-administration-analytics-refusal">
            {analytics.refusal}
          </p>
        ) : analytics.kind === "unreadable" ? (
          <p className="df-refusal" data-testid="v2-administration-analytics-unreadable">
            {analytics.note}
          </p>
        ) : (
          <>
            <div className="df-filter-bar df-analytics-range">
              <label className="df-filter-chip" data-active={rangePreset !== "7d" ? "true" : "false"}>
                RANGE
                <select
                  value={rangePreset}
                  aria-label="Analytics range"
                  onChange={(event) => setRangePreset(event.target.value as AnalyticsRangePreset)}
                >
                  {ANALYTICS_RANGE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <a
                className="df-ghost-btn"
                href={analytics.export.href}
                download={analytics.export.filename}
                data-testid="v2-administration-analytics-export"
              >
                {analytics.export.label}
              </a>
            </div>

            {analyticsLoading ? (
              <p className="df-empty">Reading analytics for this range…</p>
            ) : (
              <>
            <FigureGrid figures={analytics.overview} testId="v2-administration-overview" />

            <h3 className="df-card-title">Activity</h3>
            <p className="df-empty" style={{ padding: 0 }}>
              {analytics.activity.footnote}
            </p>
            <AnalyticsRegister
              stacked={layout.stackedRegister}
              head={["MEMBER", "TRACKED", "IDLE", "IDLE EVENTS"]}
              rows={analytics.activity.rows.map((row) => ({
                id: row.userId,
                cells: [row.who, row.tracked, row.idle, row.idleEvents],
              }))}
              empty={analytics.activity.empty}
              emptyCopy={analytics.activity.emptyCopy}
              testId="v2-administration-activity"
            />

            <h3 className="df-card-title">Evidence coverage</h3>
            <FigureGrid figures={analytics.coverage.summary} testId="v2-administration-coverage" />
            <AnalyticsRegister
              stacked={layout.stackedRegister}
              head={["MEMBER", "TRACKED", "ENTRIES", "EVIDENCE", "COVERAGE"]}
              rows={analytics.coverage.rows.map((row) => ({
                id: row.userId,
                cells: [row.who, row.tracked, row.entries, row.evidence, row.coverage],
              }))}
              empty={analytics.coverage.empty}
              emptyCopy={analytics.coverage.emptyCopy}
              testId="v2-administration-coverage-row"
            />

            <h3 className="df-card-title">Workspace Devices</h3>
            <AnalyticsRegister
              stacked={layout.stackedRegister}
              head={["DEVICE", "MEMBER", "PLATFORM", "LAST SEEN", "STATUS"]}
              rows={analytics.devices.rows.map((row) => ({
                id: row.id,
                cells: [row.name, row.who, row.platform, row.lastSeen, row.status],
              }))}
              empty={analytics.devices.empty}
              emptyCopy={analytics.devices.emptyCopy}
              testId="v2-administration-device"
            />
              </>
            )}
          </>
        )}
      </section>

      <section className="df-card" data-testid="v2-administration-billing">
        <div className="df-card-head">
          <h2 className="df-card-title">Billing</h2>
          {page.billing.condition ? (
            <span className="df-status" data-status={page.billing.condition}>
              {page.billing.condition}
            </span>
          ) : null}
        </div>
        <div className="df-daily-form">
          <div className="df-admin-billing-figure">{page.billing.plan}</div>
          <div className="df-admin-billing-figure">{page.billing.seats}</div>
          {page.billing.entitlements ? <p className="df-empty" style={{ padding: 0 }}>{page.billing.entitlements}</p> : null}
          {page.billing.actions.some((action) => action.id === "seats") ? (
            <form
              className="df-admin-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!guardWrite()) return;
                if (!seatQuantity) return;
                changeSeats.mutate();
              }}
            >
              <label className="df-daily-field">
                Seat quantity
                <input
                  type="number"
                  min={1}
                  value={seatQuantity}
                  aria-label="Seat quantity"
                  onChange={(event) => setSeatQuantity(event.target.value)}
                />
              </label>
              <button type="submit" className="df-ink-btn" disabled={changeSeats.isPending || !seatQuantity}>
                Change seats
              </button>
            </form>
          ) : null}
          <div className="df-library-actions">
            {page.billing.actions.map((action) => {
              if (action.id === "seats") return null;
              if (action.id === "checkout") {
                return (
                  <button
                    key={action.id}
                    type="button"
                    className="df-ink-btn"
                    disabled={startCheckout.isPending}
                    onClick={() => startCheckout.mutate()}
                  >
                    {action.label}
                  </button>
                );
              }
              if (action.id === "payment-method") {
                return (
                  <button
                    key={action.id}
                    type="button"
                    className="df-ghost-btn"
                    disabled={updatePaymentMethod.isPending}
                    onClick={() => updatePaymentMethod.mutate()}
                  >
                    {action.label}
                  </button>
                );
              }
              return (
                <button
                  key={action.id}
                  type="button"
                  className="df-ghost-btn"
                  disabled={cancelAtPeriodEnd.isPending}
                  onClick={() => {
                    if (!guardWrite()) return;
                    cancelAtPeriodEnd.mutate();
                  }}
                >
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {page.secretOnce ? (
        <section
          className="df-card df-secret-once"
          data-motion={SECRET_MOTION}
          data-testid="v2-administration-secret"
          role="status"
        >
          <div className="df-card-head">
            <h2 className="df-card-title">Secret</h2>
            <button type="button" className="df-ghost-link" onClick={() => setRevealedSecret(null)}>
              Dismiss
            </button>
          </div>
          <div className="df-daily-form">
            <p className="df-empty" style={{ padding: 0 }}>
              {page.secretOnce.label}
            </p>
            <code className="df-admin-secret">{page.secretOnce.plaintext}</code>
            <p className="df-empty" style={{ padding: 0 }}>
              {page.secretOnce.confirmation}
            </p>
            <button
              type="button"
              className="df-ghost-btn"
              onClick={() => {
                void navigator.clipboard.writeText(page.secretOnce!.plaintext);
              }}
            >
              Copy
            </button>
          </div>
        </section>
      ) : null}

      <section className="df-card df-admin-register" data-testid="v2-administration-service-accounts">
        <div className="df-card-head">
          <h2 className="df-card-title">Service Accounts</h2>
          {page.serviceAccounts.createAllowed ? (
            <button type="button" className="df-ghost-btn" onClick={() => setCreatingAccount((open) => !open)}>
              New Service Account
            </button>
          ) : null}
        </div>
        {creatingAccount ? (
          <form className="df-admin-form df-daily-form" onSubmit={onCreateAccount}>
            <label className="df-daily-field">
              Name
              <input
                type="text"
                value={accountName}
                aria-label="Service Account name"
                onChange={(event) => setAccountName(event.target.value)}
              />
            </label>
            <fieldset className="df-daily-field">
              <legend>Capabilities</legend>
              {PUBLIC_API_CAPABILITIES.map((capability) => (
                <label key={capability.id} className="df-daily-field df-daily-check">
                  <input
                    type="checkbox"
                    checked={accountCapabilities.includes(capability.id)}
                    onChange={(event) => {
                      setAccountCapabilities((currentCaps) =>
                        event.target.checked
                          ? [...currentCaps, capability.id]
                          : currentCaps.filter((id) => id !== capability.id),
                      );
                    }}
                  />
                  {capability.name}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="df-ink-btn" disabled={createAccount.isPending || !accountName.trim()}>
              Create
            </button>
          </form>
        ) : null}
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>NAME</span>
            <span>CAPABILITIES</span>
            <span>STATUS</span>
            <span />
          </div>
        )}
        {page.serviceAccounts.empty ? (
          <p className="df-empty">{page.serviceAccounts.emptyCopy}</p>
        ) : (
          page.serviceAccounts.rows.map((row) => (
            <div key={row.id} className="df-register-row" data-testid={`v2-administration-sa-${row.id}`}>
              {layout.stackedRegister ? (
                <span className="df-project-mobile">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.name}</div>
                    <div className="df-mono df-meta">
                      {row.status}
                      {row.capabilities !== "—" ? ` · ${row.capabilities}` : ""}
                    </div>
                  </span>
                  <AccountActions
                    row={row}
                    onRotate={onRotateAccount}
                    onRevoke={onRevokeAccount}
                  />
                </span>
              ) : (
                <>
                  <span className="df-row-title">{row.name}</span>
                  <span className="df-mono df-meta">{row.capabilities}</span>
                  <span className="df-status" data-status={row.status}>
                    {row.status}
                  </span>
                  <AccountActions row={row} onRotate={onRotateAccount} onRevoke={onRevokeAccount} />
                </>
              )}
            </div>
          ))
        )}
      </section>

      <section className="df-card df-admin-register" data-testid="v2-administration-webhooks">
        <div className="df-card-head">
          <h2 className="df-card-title">Webhook Endpoints</h2>
          {page.webhookEndpoints.createAllowed ? (
            <button type="button" className="df-ghost-btn" onClick={() => setCreatingEndpoint((open) => !open)}>
              New Webhook Endpoint
            </button>
          ) : null}
        </div>
        {creatingEndpoint ? (
          <form className="df-admin-form df-daily-form" onSubmit={onCreateEndpoint}>
            <label className="df-daily-field">
              URL
              <input
                type="url"
                value={endpointUrl}
                aria-label="Webhook Endpoint URL"
                onChange={(event) => setEndpointUrl(event.target.value)}
              />
            </label>
            <fieldset className="df-daily-field">
              <legend>Event types</legend>
              {WEBHOOK_EVENT_TYPES.map((type) => (
                <label key={type} className="df-daily-field df-daily-check">
                  <input
                    type="checkbox"
                    checked={eventTypes.includes(type)}
                    onChange={(event) => {
                      setEventTypes((currentTypes) =>
                        event.target.checked
                          ? [...currentTypes, type]
                          : currentTypes.filter((value) => value !== type),
                      );
                    }}
                  />
                  {type}
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              className="df-ink-btn"
              disabled={createEndpoint.isPending || !endpointUrl.trim() || eventTypes.length === 0}
            >
              Create
            </button>
          </form>
        ) : null}
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>URL</span>
            <span>EVENTS</span>
            <span>STATUS</span>
            <span />
          </div>
        )}
        {page.webhookEndpoints.empty ? (
          <p className="df-empty">{page.webhookEndpoints.emptyCopy}</p>
        ) : (
          page.webhookEndpoints.rows.map((row) => (
            <div key={row.id} className="df-register-row" data-testid={`v2-administration-wh-${row.id}`}>
              {layout.stackedRegister ? (
                <span className="df-project-mobile">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.url}</div>
                    <div className="df-mono df-meta">
                      {row.status} · {row.eventTypes}
                    </div>
                  </span>
                  <EndpointActions
                    row={row}
                    onRotate={onRotateEndpoint}
                    onDisable={onDisableEndpoint}
                    onEnable={onEnableEndpoint}
                  />
                </span>
              ) : (
                <>
                  <span className="df-row-title">{row.url}</span>
                  <span className="df-mono df-meta">{row.eventTypes}</span>
                  <span className="df-status" data-status={row.status}>
                    {row.status}
                  </span>
                  <EndpointActions
                    row={row}
                    onRotate={onRotateEndpoint}
                    onDisable={onDisableEndpoint}
                    onEnable={onEnableEndpoint}
                  />
                </>
              )}
            </div>
          ))
        )}
      </section>

      {trackingPolicy.kind === "refusal" || trackingPolicy.kind === "unreadable" ? (
        <section className="df-card" data-testid="v2-administration-tracking-policy">
          <div className="df-card-head">
            <h2 className="df-card-title">Tracking Policy</h2>
          </div>
          <p className="df-refusal">
            {trackingPolicy.kind === "refusal" ? trackingPolicy.refusal : trackingPolicy.note}
          </p>
        </section>
      ) : (
        <>
          <section className="df-card df-policy-form" data-testid="v2-administration-tracking-policy">
            <div className="df-card-head">
              <h2 className="df-card-title">Tracking Policy</h2>
              {trackingPolicy.savedNote ? (
                <span
                  className="df-mono df-meta df-policy-saved"
                  data-motion={POLICY_SAVED_MOTION}
                  role="status"
                  data-testid="v2-administration-policy-saved"
                >
                  {trackingPolicy.savedNote}
                </span>
              ) : null}
            </div>
            <div className="df-daily-form">
              <p className="df-empty" style={{ padding: 0 }}>
                {trackingPolicy.footnote}
              </p>
              {trackingPolicy.writeRefusal ? (
                <p className="df-refusal">{trackingPolicy.writeRefusal}</p>
              ) : null}
              <label className="df-daily-field df-daily-check">
                <input
                  type="checkbox"
                  checked={policyDraft.screenshotsEnabled}
                  disabled={!trackingPolicy.editable}
                  onChange={(event) => editPolicy({ screenshotsEnabled: event.target.checked })}
                />
                Capture Activity Evidence
              </label>
              <div className="df-policy-grid">
                <label className="df-daily-field">
                  Minimum interval (minutes)
                  <input
                    type="number"
                    min={3}
                    max={15}
                    value={policyDraft.captureIntervalMinMin}
                    disabled={!trackingPolicy.editable}
                    aria-label="Minimum capture interval"
                    onChange={(event) =>
                      editPolicy({
                        captureIntervalMinMin: policyNumber(
                          event.target.value,
                          policyDraft.captureIntervalMinMin,
                        ),
                      })
                    }
                  />
                </label>
                <label className="df-daily-field">
                  Maximum interval (minutes)
                  <input
                    type="number"
                    min={3}
                    max={15}
                    value={policyDraft.captureIntervalMaxMin}
                    disabled={!trackingPolicy.editable}
                    aria-label="Maximum capture interval"
                    onChange={(event) =>
                      editPolicy({
                        captureIntervalMaxMin: policyNumber(
                          event.target.value,
                          policyDraft.captureIntervalMaxMin,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <label className="df-daily-field df-daily-check">
                <input
                  type="checkbox"
                  checked={policyDraft.activeHoursEnabled}
                  disabled={!trackingPolicy.editable}
                  onChange={(event) => editPolicy({ activeHoursEnabled: event.target.checked })}
                />
                Restrict captures to active hours
              </label>
              {policyDraft.activeHoursEnabled ? (
                <div className="df-policy-grid">
                  <label className="df-daily-field">
                    Start
                    <input
                      type="time"
                      value={policyDraft.activeHoursStart}
                      disabled={!trackingPolicy.editable}
                      aria-label="Active hours start"
                      onChange={(event) => editPolicy({ activeHoursStart: event.target.value })}
                    />
                  </label>
                  <label className="df-daily-field">
                    End
                    <input
                      type="time"
                      value={policyDraft.activeHoursEnd}
                      disabled={!trackingPolicy.editable}
                      aria-label="Active hours end"
                      onChange={(event) => editPolicy({ activeHoursEnd: event.target.value })}
                    />
                  </label>
                </div>
              ) : null}
              <label className="df-daily-field df-daily-check">
                <input
                  type="checkbox"
                  checked={policyDraft.idlePromptEnabled}
                  disabled={!trackingPolicy.editable}
                  onChange={(event) => editPolicy({ idlePromptEnabled: event.target.checked })}
                />
                Prompt on idle
              </label>
              {policyDraft.idlePromptEnabled ? (
                <div className="df-policy-grid">
                  <label className="df-daily-field">
                    Idle timeout (minutes)
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={policyDraft.idleTimeoutMinutes}
                      disabled={!trackingPolicy.editable}
                      aria-label="Idle timeout"
                      onChange={(event) =>
                        editPolicy({
                          idleTimeoutMinutes: policyNumber(
                            event.target.value,
                            policyDraft.idleTimeoutMinutes,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="df-daily-field">
                    Auto-stop countdown (seconds)
                    <input
                      type="number"
                      min={15}
                      max={120}
                      value={policyDraft.idleCountdownSeconds}
                      disabled={!trackingPolicy.editable}
                      aria-label="Idle countdown"
                      onChange={(event) =>
                        editPolicy({
                          idleCountdownSeconds: policyNumber(
                            event.target.value,
                            policyDraft.idleCountdownSeconds,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}
              {trackingPolicy.issue ? <p className="df-refusal">{trackingPolicy.issue}</p> : null}
              <button
                type="button"
                className="df-ink-btn"
                disabled={!trackingPolicy.canSave || saveTrackingPolicy.isPending}
                onClick={() => {
                  if (!guardWrite()) return;
                  saveTrackingPolicy.mutate();
                }}
              >
                Save Tracking Policy
              </button>
            </div>
          </section>

          <section className="df-card df-policy-form" data-testid="v2-administration-timezones">
            <div className="df-card-head">
              <h2 className="df-card-title">Screencasts timezones</h2>
            </div>
            <div className="df-daily-form">
              <p className="df-empty" style={{ padding: 0 }}>
                Curate the timezones the Screencasts selector offers.
              </p>
              <form
                className="df-admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onAddTimezone();
                }}
              >
                <label className="df-daily-field">
                  IANA timezone
                  <input
                    type="text"
                    value={timezoneInput}
                    placeholder="Europe/Paris"
                    disabled={!trackingPolicy.editable}
                    aria-label="IANA timezone"
                    onChange={(event) => {
                      setTimezoneInput(event.target.value);
                      setTimezoneError(null);
                    }}
                  />
                </label>
                <button type="submit" className="df-ghost-btn" disabled={!trackingPolicy.editable}>
                  Add
                </button>
              </form>
              {timezoneError ? <p className="df-refusal">{timezoneError}</p> : null}
              {trackingPolicy.timezones.empty ? (
                <p className="df-empty">{trackingPolicy.timezones.emptyCopy}</p>
              ) : (
                trackingPolicy.timezones.rows.map((timezone) => (
                  <div
                    key={timezone}
                    className="df-policy-timezone"
                    data-testid={`v2-administration-timezone-${timezone}`}
                  >
                    <span>{timezone}</span>
                    <button
                      type="button"
                      className="df-ghost-link"
                      disabled={!trackingPolicy.editable}
                      onClick={() => setTimezoneDraft((current) => removeAllowedTimezone(current, timezone))}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
              <button
                type="button"
                className="df-ink-btn"
                disabled={!trackingPolicy.timezones.canSave || saveTimezones.isPending}
                onClick={() => {
                  if (!guardWrite()) return;
                  saveTimezones.mutate();
                }}
              >
                Save timezones
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function FigureGrid({ figures, testId }: { figures: AnalyticsFigure[]; testId: string }) {
  if (figures.length === 0) return null;
  return (
    <div className="df-analytics-figures" data-testid={testId}>
      {figures.map((figure) => (
        <div key={figure.label} className="df-analytics-figure">
          <span className="df-analytics-figure-label">{figure.label}</span>
          <span className="df-analytics-figure-value">{figure.value}</span>
        </div>
      ))}
    </div>
  );
}

function AnalyticsRegister({
  stacked,
  head,
  rows,
  empty,
  emptyCopy,
  testId,
}: {
  stacked: boolean;
  head: string[];
  rows: Array<{ id: string; cells: string[] }>;
  empty: boolean;
  emptyCopy: string;
  testId: string;
}) {
  if (empty) return <p className="df-empty">{emptyCopy}</p>;
  return (
    <>
      {stacked ? null : (
        <div className="df-register-head df-desktop-only" data-columns={head.length}>
          {head.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
      {rows.map((row) => (
        <div
          key={row.id}
          className="df-register-row"
          data-columns={head.length}
          data-testid={`${testId}-${row.id}`}
        >
          {stacked ? (
            <span className="df-project-mobile">
              <span style={{ minWidth: 0, flex: 1 }}>
                <div className="df-row-title">{row.cells[0]}</div>
                <div className="df-mono df-meta">{row.cells.slice(1).join(" · ")}</div>
              </span>
            </span>
          ) : (
            <>
              <span className="df-row-title">{row.cells[0]}</span>
              {row.cells.slice(1).map((cell, index) => (
                <span key={head[index + 1]} className="df-mono df-meta">
                  {cell}
                </span>
              ))}
            </>
          )}
        </div>
      ))}
    </>
  );
}

function AccountActions({
  row,
  onRotate,
  onRevoke,
}: {
  row: { id: string; name: string; rotate: boolean; revoke: boolean };
  onRotate: (id: string, label: string) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <span className="df-people-action">
      {row.rotate ? (
        <button type="button" className="df-ghost-link" onClick={() => onRotate(row.id, row.name)}>
          Rotate
        </button>
      ) : null}
      {row.revoke ? (
        <button type="button" className="df-ghost-link" onClick={() => onRevoke(row.id)}>
          Revoke
        </button>
      ) : null}
    </span>
  );
}

function EndpointActions({
  row,
  onRotate,
  onDisable,
  onEnable,
}: {
  row: { id: string; url: string; rotate: boolean; disable: boolean; enable: boolean };
  onRotate: (id: string, label: string) => void;
  onDisable: (id: string) => void;
  onEnable: (id: string) => void;
}) {
  return (
    <span className="df-people-action">
      {row.rotate ? (
        <button type="button" className="df-ghost-link" onClick={() => onRotate(row.id, row.url)}>
          Rotate
        </button>
      ) : null}
      {row.disable ? (
        <button type="button" className="df-ghost-link" onClick={() => onDisable(row.id)}>
          Disable
        </button>
      ) : null}
      {row.enable ? (
        <button type="button" className="df-ghost-link" onClick={() => onEnable(row.id)}>
          Enable
        </button>
      ) : null}
    </span>
  );
}
