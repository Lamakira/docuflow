import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PUBLIC_API_CAPABILITIES,
  WEBHOOK_EVENT_TYPES,
  type CrmModuleWithFields,
  type ScreenshotPolicy,
} from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  addAllowedTimezone,
  timezoneSuggestions,
  administrationWriteRefusal,
  analyticsActivityPath,
  analyticsAlertsPath,
  analyticsCoveragePath,
  analyticsDevicesPath,
  analyticsEvidenceQualityPath,
  analyticsOverviewPath,
  analyticsProductivityPath,
  analyticsScreenshotsPath,
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
  type AnalyticsAlertsInput,
  type AnalyticsCoverageInput,
  type AnalyticsDeviceInput,
  type AnalyticsEvidenceQualityInput,
  type AnalyticsProductivityInput,
  type AnalyticsScreenshotsInput,
  type AnalyticsFigure,
  type AnalyticsModel,
  type AnalyticsOverviewInput,
  type AnalyticsRangePreset,
  type BillingAction,
  type BillingInput,
  type RevealedSecretInput,
  type ServiceAccountInput,
  type WebhookEndpointInput,
} from "./administration";
import { trackingPolicyPath } from "./activity";
import { motionForSurface } from "./motion";
import { workspaceOwnerName } from "./workspace";
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
  const [moduleName, setModuleName] = useState("");
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("text");

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
  const { data: crmModules = [], isLoading: crmModulesLoading } = useQuery<CrmModuleWithFields[]>({
    queryKey: ["/api/admin/modules"],
    enabled: canManage,
    queryFn: () => readBehindAdministration<CrmModuleWithFields[]>("/api/admin/modules").then((rows) => rows ?? []),
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
  const { data: alerts, isLoading: alertsLoading, isError: alertsFailed } = useQuery<AnalyticsAlertsInput | null>({
    queryKey: [analyticsAlertsPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsAlertsInput>(analyticsAlertsPath(range)),
  });
  const {
    data: recordedTime,
    isLoading: recordedTimeLoading,
    isError: recordedTimeFailed,
  } = useQuery<AnalyticsProductivityInput | null>({
    queryKey: [analyticsProductivityPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsProductivityInput>(analyticsProductivityPath(range)),
  });
  const {
    data: screenshots,
    isLoading: screenshotsLoading,
    isError: screenshotsFailed,
  } = useQuery<AnalyticsScreenshotsInput | null>({
    queryKey: [analyticsScreenshotsPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsScreenshotsInput>(analyticsScreenshotsPath(range)),
  });
  const {
    data: evidenceQuality,
    isLoading: evidenceQualityLoading,
    isError: evidenceQualityFailed,
  } = useQuery<AnalyticsEvidenceQualityInput | null>({
    queryKey: [analyticsEvidenceQualityPath(range)],
    enabled: canManage,
    queryFn: () => readBehindAdministration<AnalyticsEvidenceQualityInput>(analyticsEvidenceQualityPath(range)),
  });
  const { data: workspaceSettings, isLoading: workspaceSettingsLoading } =
    useQuery<WorkspaceSettingsResponse | null>({
      queryKey: [workspaceSettingsPath()],
      enabled: canManage,
      queryFn: () => readBehindAdministration<WorkspaceSettingsResponse>(workspaceSettingsPath()),
    });

  // Warnings ride with the analytics already on this page. The three
  // reporting reads must not hold a stalled Device off the screen.
  const analyticsLoading =
    overviewLoading || activityLoading || coverageLoading || analyticsDevicesLoading || alertsLoading;
  const analyticsRefused =
    overview === null || activity === null || coverage === null || analyticsDevices === null || alerts === null;
  const analyticsFailed =
    overviewFailed || activityFailed || coverageFailed || analyticsDevicesFailed || alertsFailed;
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

  useEffect(() => {
    if (analyticsLoading) return;
    if (window.location.hash !== "#alerts") return;
    document.getElementById("alerts")?.scrollIntoView();
  }, [analyticsLoading]);

  const ownerName = workspaceOwnerName(people?.memberships ?? []);
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

  // The field starts from the capacity the Workspace already holds, so it never
  // contradicts the BILLABLE SEATS figure above it, and the submit is not
  // disabled until the customer retypes a number the system already knows.
  //
  // Keyed on that capacity rather than on the payload: a refetch mid-edit would
  // otherwise put the old number back over whatever was being typed.
  const seatQuantityDefault = page.kind === "ready" ? page.billing.seatQuantityDefault : "";
  useEffect(() => {
    if (!seatQuantityDefault) return;
    setSeatQuantity(seatQuantityDefault);
  }, [seatQuantityDefault]);

  const analytics = composeAnalytics({
    now: rangeAnchor,
    workspaceRole,
    ownerName,
    range,
    overview: overview ?? null,
    activity: activity ?? null,
    coverage: coverage ?? null,
    devices: analyticsDevices ?? [],
    alerts: alerts ?? null,
    productivity: recordedTime ?? null,
    screenshots: screenshots ?? null,
    evidenceQuality: evidenceQuality ?? null,
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
        workspaceRole,
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
  const createCrmModule = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/modules", {
      name: moduleName.trim(),
      slug: moduleName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      description: "",
      icon: "",
      isEnabled: 1,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] }); setModuleName(""); },
    onError: (error: Error) => refuseWrite(error.message),
  });
  const updateCrmModule = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => apiRequest("PATCH", `/api/admin/modules/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] }),
    onError: (error: Error) => refuseWrite(error.message),
  });
  const deleteCrmModule = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/modules/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] }); setSelectedModuleId(null); },
    onError: (error: Error) => refuseWrite(error.message),
  });
  const selectedModule = crmModules.find((module) => module.id === selectedModuleId) ?? null;
  const createCrmField = useMutation({
    mutationFn: () => {
      if (!selectedModule) throw new Error("Choose a CRM module");
      const slug = fieldName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      return apiRequest("POST", `/api/admin/modules/${selectedModule.id}/fields`, { name: fieldName.trim(), slug, fieldType, isEnabled: 1, isRequired: 0 });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] }); setFieldName(""); },
    onError: (error: Error) => refuseWrite(error.message),
  });
  const updateCrmField = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => apiRequest("PATCH", `/api/admin/fields/${id}`, patch),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] }); queryClient.invalidateQueries({ queryKey: ["/api/modules/projects/fields"] }); queryClient.invalidateQueries({ queryKey: ["/api/modules/contacts/fields"] }); },
    onError: (error: Error) => refuseWrite(error.message),
  });
  const deleteCrmField = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/fields/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] }),
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

  function onAddTimezone(candidate = timezoneInput) {
    const edit = addAllowedTimezone(timezoneDraft, candidate);
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
    (canManage && (accountsLoading || endpointsLoading || billingLoading || workspaceSettingsLoading || crmModulesLoading))
  ) {
    return <AdministrationSkeleton />;
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

      <AdministrationAnalytics
        analytics={analytics}
        loading={analyticsLoading}
        stacked={layout.stackedRegister}
        rangePreset={rangePreset}
        onRangeChange={setRangePreset}
        recordedTimeRead={reportRead(recordedTimeLoading, recordedTimeFailed, recordedTime)}
        screenshotsRead={reportRead(screenshotsLoading, screenshotsFailed, screenshots)}
        evidenceQualityRead={reportRead(evidenceQualityLoading, evidenceQualityFailed, evidenceQuality)}
      />

      <section className="df-card df-admin-register" data-testid="v2-administration-crm-modules">
        <div className="df-card-head"><div className="df-card-head-text"><h2 className="df-card-title">CRM modules &amp; fields</h2><p className="df-card-sub">Configure the Work record schema used by Clients and Projects.</p></div></div>
        <form className="df-admin-form df-inline-form" onSubmit={(event) => { event.preventDefault(); if (!guardWrite() || !moduleName.trim()) return; createCrmModule.mutate(); }}>
          <label className="df-daily-field">MODULE NAME<input value={moduleName} onChange={(event) => setModuleName(event.target.value)} /></label>
          <Button variant="default" type="submit" disabled={!moduleName.trim() || createCrmModule.isPending} className="df-btn">Add module</Button>
        </form>
        {crmModules.length === 0 ? <p className="df-empty">No CRM modules configured.</p> : crmModules.map((module) => (
          <div key={module.id} className="df-register-row" data-testid={`v2-crm-module-${module.id}`}>
            <span><Button variant="outline" type="button" onClick={() => setSelectedModuleId(module.id)} className="df-btn">Open</Button><input aria-label={`Module name for ${module.name}`} defaultValue={module.name} onBlur={(event) => { const name = event.target.value.trim(); if (!name || name === module.name || !guardWrite()) return; updateCrmModule.mutate({ id: module.id, patch: { name } }); }} /></span>
            <span className="df-mono df-meta">{module.slug}</span>
            <span className="df-status">{module.isEnabled ? "ACTIVE" : "INACTIVE"}</span>
            <span className="df-people-action">
              <Button variant="outline" type="button" onClick={() => { if (!guardWrite()) return; updateCrmModule.mutate({ id: module.id, patch: { isEnabled: module.isEnabled ? 0 : 1 } }); }} className="df-btn">{module.isEnabled ? "Disable" : "Enable"}</Button>
              {module.isSystem !== 1 ? <Button variant="outline" type="button" onClick={() => { if (!guardWrite()) return; deleteCrmModule.mutate(module.id); }} className="df-btn">Delete</Button> : null}
            </span>
          </div>
        ))}
        {selectedModule ? (
          <div className="df-daily-form">
            <div className="df-card-head"><h3 className="df-card-title">{selectedModule.name} fields</h3></div>
            <form className="df-admin-form df-inline-form" onSubmit={(event) => { event.preventDefault(); if (!guardWrite() || !fieldName.trim()) return; createCrmField.mutate(); }}>
              <label className="df-daily-field">FIELD NAME<input value={fieldName} onChange={(event) => setFieldName(event.target.value)} /></label>
              <label className="df-daily-field">TYPE<Select value={fieldType} onValueChange={setFieldType}><SelectTrigger className="df-filter-chip df-select-trigger" aria-label="CRM field type"><SelectValue /></SelectTrigger><SelectContent className="df-v2 df-select-content">{[["text", "TEXT"], ["textarea", "LONG TEXT"], ["number", "NUMBER"], ["date", "DATE"], ["select", "SELECT"], ["multiselect", "MULTISELECT"], ["checkbox", "CHECKBOX"]].map(([value, label]) => <SelectItem key={value} value={value} className="df-select-item">{label}</SelectItem>)}</SelectContent></Select></label>
              <Button variant="default" type="submit" disabled={!fieldName.trim() || createCrmField.isPending} className="df-btn">Add field</Button>
            </form>
            {(selectedModule.fields ?? []).map((field) => (
              <div key={field.id} className="df-register-row" data-testid={`v2-crm-field-${field.id}`}>
                <span><input aria-label={`Field name for ${field.name}`} defaultValue={field.name} onBlur={(event) => { const name = event.target.value.trim(); if (!name || name === field.name || !guardWrite()) return; updateCrmField.mutate({ id: field.id, patch: { name } }); }} />{field.fieldType === "select" || field.fieldType === "multiselect" ? <textarea aria-label={`Options for ${field.name}`} defaultValue={(field.options ?? []).join("\n")} onBlur={(event) => { const options = event.target.value.split("\n").map((option) => option.trim()).filter(Boolean); if (!guardWrite()) return; updateCrmField.mutate({ id: field.id, patch: { options } }); }} /> : null}</span><span className="df-mono df-meta">{field.fieldType} · {field.slug}</span><span className="df-status">{field.isEnabled ? "ACTIVE" : "INACTIVE"}</span>
                <span className="df-people-action"><Button variant="outline" type="button" onClick={() => { if (!guardWrite()) return; updateCrmField.mutate({ id: field.id, patch: { isEnabled: field.isEnabled ? 0 : 1 } }); }} className="df-btn">{field.isEnabled ? "Disable" : "Enable"}</Button>{field.isSystem !== 1 ? <Button variant="outline" type="button" onClick={() => { if (!guardWrite()) return; deleteCrmField.mutate(field.id); }} className="df-btn">Delete</Button> : null}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="df-card df-policy-form" data-testid="v2-administration-billing">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Billing</h2>
            <p className="df-card-sub">
              Plan, Billable Seats, and the term for this Workspace. Card details stay with Stripe.
            </p>
          </div>
          {page.billing.condition ? (
            <span className="df-status" data-status={page.billing.condition}>
              {page.billing.condition}
            </span>
          ) : null}
        </div>

        {page.billing.available ? (
          <div className="df-figure-band" data-testid="v2-administration-billing-figures">
            {page.billing.figures.map((figure) => (
              <div key={figure.label} className="df-analytics-figure">
                <span className="df-analytics-figure-label">{figure.label}</span>
                <span className="df-analytics-figure-value df-admin-billing-figure">
                  {figure.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="df-empty">{page.billing.seats}</p>
        )}

        {page.billing.entitlementNote ? (
          <p className="df-admin-billing-note">{page.billing.entitlementNote}</p>
        ) : null}

        {page.billing.actions.some((action) => action.id === "seats") ? (
          <form
            className="df-admin-form df-inline-form df-admin-seat-form"
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
            <Button variant="outline" type="submit" disabled={changeSeats.isPending || !seatQuantity} className="df-btn">
              {changeSeats.isPending ? "Changing…" : "Change seats"}
            </Button>
          </form>
        ) : null}

        <div className="df-billing-actions">
          {page.billing.actions.map((action) => {
            if (action.id === "seats") return null;
            if (action.id === "checkout") {
              return (
                <Button variant="default" key={action.id} type="button" disabled={startCheckout.isPending} onClick={() => startCheckout.mutate()} className="df-btn">
                  {action.label}
                </Button>
              );
            }
            if (action.id === "payment-method") {
              return (
                <Button variant="outline" key={action.id} type="button" disabled={updatePaymentMethod.isPending} onClick={() => updatePaymentMethod.mutate()} className="df-btn">
                  {action.label}
                </Button>
              );
            }
            // Ending the subscription is not reachable by the reflex that
            // reaches the buttons beside it: it is styled apart, and it states
            // what it costs before it runs (#245, F1).
            return (
              <CancelControl
                key={action.id}
                action={action}
                pending={cancelAtPeriodEnd.isPending}
                onConfirm={() => {
                  if (!guardWrite()) return;
                  cancelAtPeriodEnd.mutate();
                }}
              />
            );
          })}
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
            <Button variant="outline" type="button" onClick={() => setRevealedSecret(null)} className="df-btn">
              Dismiss
            </Button>
          </div>
          <div className="df-daily-form">
            <p className="df-empty df-flush">
              {page.secretOnce.label}
            </p>
            <code className="df-admin-secret">{page.secretOnce.plaintext}</code>
            <p className="df-empty df-flush">
              {page.secretOnce.confirmation}
            </p>
            <Button variant="outline" type="button" onClick={() => { void navigator.clipboard.writeText(page.secretOnce!.plaintext); }} className="df-btn">
              Copy
            </Button>
          </div>
        </section>
      ) : null}

      <section className="df-card df-admin-register" data-testid="v2-administration-service-accounts">
        <div className="df-card-head">
          <h2 className="df-card-title">Service Accounts</h2>
          {page.serviceAccounts.createAllowed ? (
            <Button variant="outline" type="button" onClick={() => setCreatingAccount((open) => !open)} className="df-btn">
              New Service Account
            </Button>
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
                <CheckRow
                  key={capability.id}
                  id={`df-capability-${capability.id}`}
                  label={capability.name}
                  checked={accountCapabilities.includes(capability.id)}
                  onChange={(next) => {
                    setAccountCapabilities((currentCaps) =>
                      next
                        ? [...currentCaps, capability.id]
                        : currentCaps.filter((id) => id !== capability.id),
                    );
                  }}
                />
              ))}
            </fieldset>
            <div className="df-form-actions">
              <Button variant="outline" type="button" onClick={() => setCreatingAccount(false)} className="df-btn">
                Cancel
              </Button>
              <Button variant="default" type="submit" disabled={createAccount.isPending || !accountName.trim()} className="df-btn">
                {createAccount.isPending ? "Creating…" : "Create Service Account"}
              </Button>
            </div>
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
            <Button variant="outline" type="button" onClick={() => setCreatingEndpoint((open) => !open)} className="df-btn">
              New Webhook Endpoint
            </Button>
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
                <CheckRow
                  key={type}
                  id={`df-event-${type}`}
                  label={type}
                  checked={eventTypes.includes(type)}
                  onChange={(next) => {
                    setEventTypes((currentTypes) =>
                      next
                        ? [...currentTypes, type]
                        : currentTypes.filter((value) => value !== type),
                    );
                  }}
                />
              ))}
            </fieldset>
            <div className="df-form-actions">
              <Button variant="outline" type="button" onClick={() => setCreatingEndpoint(false)} className="df-btn">
                Cancel
              </Button>
              <Button variant="default" type="submit" disabled={createEndpoint.isPending || !endpointUrl.trim() || eventTypes.length === 0} className="df-btn">
                {createEndpoint.isPending ? "Creating…" : "Create Webhook Endpoint"}
              </Button>
            </div>
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
              <div className="df-card-head-text">
                <h2 className="df-card-title">Tracking Policy</h2>
                <p className="df-card-sub">{trackingPolicy.footnote}</p>
              </div>
            </div>
            <div className="df-daily-form">
              {trackingPolicy.writeRefusal ? (
                <p className="df-refusal">{trackingPolicy.writeRefusal}</p>
              ) : null}
              <CheckRow
                id="df-policy-capture"
                label="Capture Activity Evidence"
                checked={policyDraft.screenshotsEnabled}
                disabled={!trackingPolicy.editable}
                onChange={(next) => editPolicy({ screenshotsEnabled: next })}
              />
              {policyDraft.screenshotsEnabled ? (
                <div className="df-policy-group">
                  <p className="df-policy-hint">
                    A capture lands at a random moment between these two intervals.
                  </p>
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
                </div>
              ) : null}
              <CheckRow
                id="df-policy-active-hours"
                label="Restrict captures to active hours"
                checked={policyDraft.activeHoursEnabled}
                disabled={!trackingPolicy.editable}
                onChange={(next) => editPolicy({ activeHoursEnabled: next })}
              />
              {policyDraft.activeHoursEnabled ? (
                <div className="df-policy-group">
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
                </div>
              ) : null}
              <CheckRow
                id="df-policy-idle"
                label="Prompt on idle"
                checked={policyDraft.idlePromptEnabled}
                disabled={!trackingPolicy.editable}
                onChange={(next) => editPolicy({ idlePromptEnabled: next })}
              />
              {policyDraft.idlePromptEnabled ? (
                <div className="df-policy-group">
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
                </div>
              ) : null}
            </div>
            <div className="df-form-actions">
              {trackingPolicy.issue ? (
                <p className="df-form-note df-refusal-inline">{trackingPolicy.issue}</p>
              ) : trackingPolicy.savedNote ? (
                <p
                  className="df-form-note df-policy-saved"
                  data-motion={POLICY_SAVED_MOTION}
                  role="status"
                  data-testid="v2-administration-policy-saved"
                >
                  {trackingPolicy.savedNote}
                </p>
              ) : (
                <p className="df-form-note">
                  {trackingPolicy.dirty ? "Unsaved changes." : "No change to save."}
                </p>
              )}
              <Button variant="default" type="button" disabled={!trackingPolicy.canSave || saveTrackingPolicy.isPending} onClick={() => { if (!guardWrite()) return; saveTrackingPolicy.mutate(); }} className="df-btn">
                {saveTrackingPolicy.isPending ? "Saving…" : "Save Tracking Policy"}
              </Button>
            </div>
          </section>

          <section className="df-card df-policy-form" data-testid="v2-administration-timezones">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Screencasts timezones</h2>
                <p className="df-card-sub">
                  Curate the timezones the Screencasts selector offers.
                </p>
              </div>
            </div>
            <div className="df-daily-form">
              <form
                className="df-admin-form df-inline-form"
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
                <TimezonePicker
                  zones={timezoneSuggestions(timezoneDraft)}
                  disabled={!trackingPolicy.editable}
                  onChoose={(zone) => onAddTimezone(zone)}
                />
                <Button variant="outline" type="submit" disabled={!trackingPolicy.editable} className="df-btn">
                  Add
                </Button>
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
                    <Button variant="outline" type="button" disabled={!trackingPolicy.editable} onClick={() => setTimezoneDraft((current) => removeAllowedTimezone(current, timezone))} className="df-btn">
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="df-form-actions">
              <p className="df-form-note">
                {trackingPolicy.timezones.dirty
                  ? "Unsaved changes."
                  : "No change to save."}
              </p>
              <Button variant="default" type="button" disabled={!trackingPolicy.timezones.canSave || saveTimezones.isPending} onClick={() => { if (!guardWrite()) return; saveTimezones.mutate(); }} className="df-btn">
                {saveTimezones.isPending ? "Saving…" : "Save timezones"}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}



/**
 * A destination's section titles are known before any fetch; only the values
 * are not. So the wait shows the real geometry with the real titles and leaves
 * only the values unexposed — when the data lands, nothing moves. That is the
 * same spatial-consistency rule the rest of the v2 motion substrate follows.
 */
function Bar({ width, role }: { width?: "short" | "medium" | "long"; role?: "value" }) {
  return <Skeleton className="df-skeleton" data-width={width} data-role={role} />;
}

function SkeletonBand({ tiles }: { tiles: number }) {
  return (
    <div className="df-figure-band">
      {Array.from({ length: tiles }, (_, index) => (
        <div key={index} className="df-analytics-figure">
          <Bar width="short" />
          <Bar role="value" />
        </div>
      ))}
    </div>
  );
}

function SkeletonRows({ columns, rows }: { columns: number; rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="df-register-row"
          data-columns={columns}
          data-skeleton="true"
        >
          <Bar width="long" />
          {Array.from({ length: columns - 1 }, (_, cell) => (
            <Bar key={cell} width="short" />
          ))}
        </div>
      ))}
    </>
  );
}

function SkeletonSection({
  title,
  tiles,
  columns,
  rows,
}: {
  title: string;
  tiles?: number;
  columns?: number;
  rows?: number;
}) {
  return (
    <section className="df-card df-analytics-register">
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">{title}</h2>
          <div className="df-card-sub" data-skeleton="true">
            <Bar width="long" />
          </div>
        </div>
      </div>
      {tiles ? <SkeletonBand tiles={tiles} /> : null}
      {columns && rows ? <SkeletonRows columns={columns} rows={rows} /> : null}
    </section>
  );
}

function AdministrationSkeleton() {
  return (
    <div className="df-page" data-testid="v2-administration" aria-busy="true">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Administration</h1>
          <p className="df-subhead">Loading this Workspace…</p>
        </div>
      </header>
      <p className="df-sr-only" role="status">
        Loading Administration for this Workspace.
      </p>
      <SkeletonSection title="Analytics" tiles={8} />
      <SkeletonSection title="Activity" columns={4} rows={3} />
      <SkeletonSection title="Billing" tiles={4} />
    </div>
  );
}

/**
 * The shadcn/Radix checkbox wearing v2 tokens (#212). Radix renders a button,
 * which a <label> cannot implicitly label, so every row pairs an explicit id.
 */
function CheckRow({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="df-checkbox-row" data-disabled={disabled ? "true" : "false"}>
      <Checkbox
        id={id}
        className="df-checkbox"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/**
 * One card per section, the way every other register in v2 reads: the card head
 * owns the title and its one line of context, a toolbar sits above the data
 * rather than inside it, and figures get their own padded band. A card carries
 * no padding of its own, so each band brings the house 18px gutter.
 */
type ReportRead = "loading" | "failed" | "ready";

function reportRead(loading: boolean, failed: boolean, data: unknown): ReportRead {
  if (loading) return "loading";
  if (failed || data === null) return "failed";
  return "ready";
}

function AdministrationAnalytics({
  analytics,
  loading,
  stacked,
  rangePreset,
  onRangeChange,
  recordedTimeRead,
  screenshotsRead,
  evidenceQualityRead,
}: {
  analytics: AnalyticsModel;
  loading: boolean;
  stacked: boolean;
  rangePreset: AnalyticsRangePreset;
  onRangeChange: (preset: AnalyticsRangePreset) => void;
  recordedTimeRead: ReportRead;
  screenshotsRead: ReportRead;
  evidenceQualityRead: ReportRead;
}) {
  if (analytics.kind !== "ready") {
    return (
      <section className="df-card" data-testid="v2-administration-analytics">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Analytics</h2>
          </div>
        </div>
        <p
          className="df-refusal"
          data-testid={
            analytics.kind === "refusal"
              ? "v2-administration-analytics-refusal"
              : "v2-administration-analytics-unreadable"
          }
        >
          {analytics.kind === "refusal" ? analytics.refusal : analytics.note}
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="df-card" data-testid="v2-administration-analytics">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Analytics</h2>
            <p className="df-card-sub">Recorded Workspace totals for {analytics.rangeLabel}.</p>
          </div>
        </div>
        <div className="df-toolbar">
          <Select
            value={rangePreset}
            onValueChange={(next) => onRangeChange(next as AnalyticsRangePreset)}
          >
            <SelectTrigger
              className="df-filter-chip df-select-trigger"
              aria-label="Analytics range"
              data-active={rangePreset !== "7d" ? "true" : "false"}
              data-testid="v2-administration-range"
            >
              <span className="df-select-prefix">RANGE</span>
              <SelectValue />
            </SelectTrigger>
            {/* Radix portals to document.body, outside `.df-v2`, so the panel
                carries the class itself or the --df-* tokens do not resolve. */}
            <SelectContent className="df-v2 df-select-content">
              {ANALYTICS_RANGE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id} className="df-select-item">
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" className="df-btn">
            <a
              href={analytics.export.href}
              download={analytics.export.filename}
              data-testid="v2-administration-analytics-export"
            >
              {analytics.export.label}
            </a>
          </Button>
        </div>
        {loading ? (
          <p className="df-empty">Reading analytics for this range…</p>
        ) : (
          <FigureBand figures={analytics.overview} testId="v2-administration-overview" />
        )}
      </section>

      {loading ? null : (
        <>
          <section
            id="alerts"
            className="df-card df-analytics-register"
            data-testid="v2-administration-alerts"
          >
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Warnings</h2>
                <p className="df-card-sub">
                  Operational warnings for this range, including any Device that has stopped reporting.
                </p>
              </div>
            </div>
            {analytics.alerts.empty ? (
              <p className="df-empty">{analytics.alerts.emptyCopy}</p>
            ) : (
              <>
                {analytics.alerts.stalledDevices.length > 0 ? (
                  <>
                  <p className="df-analytics-group-label">STALLED DEVICES</p>
                  <AnalyticsRegister
                    stacked={stacked}
                    head={["DEVICE", "MEMBER", "LAST SEEN"]}
                    rows={analytics.alerts.stalledDevices.map((row) => ({
                      id: row.id,
                      cells: [row.name, row.who, row.lastSeen],
                    }))}
                    empty={false}
                    emptyCopy=""
                    testId="v2-administration-alert-device"
                  />
                  </>
                ) : null}
                {analytics.alerts.highIdle.length > 0 ? (
                  <>
                  <p className="df-analytics-group-label">HIGH IDLE</p>
                  <AnalyticsRegister
                    stacked={stacked}
                    head={["MEMBER", "TRACKED", "IDLE"]}
                    rows={analytics.alerts.highIdle.map((row) => ({
                      id: row.id,
                      cells: [row.who, row.tracked, row.idle],
                    }))}
                    empty={false}
                    emptyCopy=""
                    testId="v2-administration-alert-idle"
                  />
                  </>
                ) : null}
                {analytics.alerts.runningWithoutEvidence.length > 0 ? (
                  <>
                  <p className="df-analytics-group-label">RUNNING WITHOUT EVIDENCE</p>
                  <AnalyticsRegister
                    stacked={stacked}
                    head={["MEMBER", "STARTED"]}
                    rows={analytics.alerts.runningWithoutEvidence.map((row) => ({
                      id: row.id,
                      cells: [row.who, row.started],
                    }))}
                    empty={false}
                    emptyCopy=""
                    testId="v2-administration-alert-running"
                  />
                  </>
                ) : null}
              </>
            )}
          </section>

          <section className="df-card df-analytics-register" data-testid="v2-administration-activity">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Activity</h2>
                <p className="df-card-sub">{analytics.activity.footnote}</p>
              </div>
            </div>
            <AnalyticsRegister
              stacked={stacked}
              head={["MEMBER", "TRACKED", "IDLE", "IDLE EVENTS"]}
              rows={analytics.activity.rows.map((row) => ({
                id: row.userId,
                cells: [row.who, row.tracked, row.idle, row.idleEvents],
              }))}
              empty={analytics.activity.empty}
              emptyCopy={analytics.activity.emptyCopy}
              testId="v2-administration-activity"
            />
          </section>

          <section className="df-card df-analytics-register" data-testid="v2-administration-coverage">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Evidence coverage</h2>
                <p className="df-card-sub">
                  How much of the tracked time carries Activity Evidence. Observational only.
                </p>
              </div>
            </div>
            <FigureBand figures={analytics.coverage.summary} testId="v2-administration-coverage" />
            <AnalyticsRegister
              stacked={stacked}
              head={["MEMBER", "TRACKED", "ENTRIES", "EVIDENCE", "COVERAGE"]}
              rows={analytics.coverage.rows.map((row) => ({
                id: row.userId,
                cells: [row.who, row.tracked, row.entries, row.evidence, row.coverage],
              }))}
              empty={analytics.coverage.empty}
              emptyCopy={analytics.coverage.emptyCopy}
              testId="v2-administration-coverage-row"
            />
          </section>

          <section className="df-card df-analytics-register" data-testid="v2-administration-devices">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Workspace Devices</h2>
                <p className="df-card-sub">Every Device paired in this Workspace.</p>
              </div>
            </div>
            <AnalyticsRegister
              stacked={stacked}
              head={["DEVICE", "MEMBER", "PLATFORM", "LAST SEEN", "STATUS"]}
              rows={analytics.devices.rows.map((row) => ({
                id: row.id,
                cells: [row.name, row.who, row.platform, row.lastSeen, row.status],
              }))}
              empty={analytics.devices.empty}
              emptyCopy={analytics.devices.emptyCopy}
              testId="v2-administration-device"
            />
          </section>

          {recordedTimeRead === "loading" ? null : (
          <section className="df-card df-analytics-register" data-testid="v2-administration-recorded-time">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Recorded time</h2>
                {recordedTimeRead === "ready" ? (
                  <p className="df-card-sub">{analytics.recordedTime.footnote}</p>
                ) : null}
              </div>
            </div>
            {recordedTimeRead === "failed" ? (
              <p className="df-refusal">
                Recorded time could not be read for this range. Nothing here is a count of zero.
              </p>
            ) : analytics.recordedTime.empty ? (
              <p className="df-empty">{analytics.recordedTime.emptyCopy}</p>
            ) : (
              <>
                <p className="df-analytics-group-label">MEMBERS</p>
                <AnalyticsRegister
                  stacked={stacked}
                  head={["MEMBER", "TRACKED", "IDLE", "ENTRIES"]}
                  rows={analytics.recordedTime.rows.map((row) => ({
                    id: row.id,
                    cells: [row.who, row.tracked, row.idle, row.entries],
                  }))}
                  empty={analytics.recordedTime.rows.length === 0}
                  emptyCopy="No tracked time by Member in this range."
                  testId="v2-administration-recorded-time-member"
                />
                <p className="df-analytics-group-label">PROJECTS</p>
                <AnalyticsRegister
                  stacked={stacked}
                  head={["PROJECT", "TRACKED", "ENTRIES"]}
                  rows={analytics.recordedTime.projects.map((row) => ({
                    id: row.id,
                    cells: [row.name, row.tracked, row.entries],
                  }))}
                  empty={analytics.recordedTime.projects.length === 0}
                  emptyCopy="No tracked time by Project in this range."
                  testId="v2-administration-recorded-time-project"
                />
                <p className="df-analytics-group-label">TASKS</p>
                <AnalyticsRegister
                  stacked={stacked}
                  head={["TASK", "TRACKED"]}
                  rows={analytics.recordedTime.tasks.map((row) => ({
                    id: row.id,
                    cells: [row.name, row.tracked],
                  }))}
                  empty={analytics.recordedTime.tasks.length === 0}
                  emptyCopy="No tracked time by Task in this range."
                  testId="v2-administration-recorded-time-task"
                />
                <p className="df-analytics-group-label">DAYS</p>
                <AnalyticsRegister
                  stacked={stacked}
                  head={["DAY", "TRACKED"]}
                  rows={analytics.recordedTime.days.map((row) => ({
                    id: row.id,
                    cells: [row.day, row.tracked],
                  }))}
                  empty={analytics.recordedTime.days.length === 0}
                  emptyCopy="No tracked time by day in this range."
                  testId="v2-administration-recorded-time-day"
                />
              </>
            )}
          </section>
          )}

          {screenshotsRead === "loading" ? null : (
          <section className="df-card df-analytics-register" data-testid="v2-administration-screenshots">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Activity Evidence</h2>
                <p className="df-card-sub">Captures in this range. Observational only.</p>
              </div>
            </div>
            {screenshotsRead === "failed" ? (
              <p className="df-refusal">
                Activity Evidence could not be read for this range. Nothing here is a count of zero.
              </p>
            ) : (
            <>
            <FigureBand figures={analytics.screenshots.summary} testId="v2-administration-screenshots" />
            {analytics.screenshots.empty ? (
              <p className="df-empty">{analytics.screenshots.emptyCopy}</p>
            ) : (
              <>
                <p className="df-analytics-group-label">BY MEMBER</p>
                <AnalyticsRegister
                  stacked={stacked}
                  head={["MEMBER", "EVIDENCE"]}
                  rows={analytics.screenshots.byMember.map((row) => ({
                    id: row.id,
                    cells: [row.who, row.evidence],
                  }))}
                  empty={analytics.screenshots.byMember.length === 0}
                  emptyCopy="No Activity Evidence by Member in this range."
                  testId="v2-administration-screenshot-member"
                />
                <p className="df-analytics-group-label">BY HOUR</p>
                <AnalyticsRegister
                  stacked={stacked}
                  head={["HOUR", "EVIDENCE"]}
                  rows={analytics.screenshots.hours.map((row) => ({
                    id: row.id,
                    cells: [row.hour, row.evidence],
                  }))}
                  empty={analytics.screenshots.hours.length === 0}
                  emptyCopy="No hourly Activity Evidence in this range."
                  testId="v2-administration-screenshot-hour"
                />
              </>
            )}
            </>
            )}
          </section>
          )}

          {evidenceQualityRead === "loading" ? null : (
          <section className="df-card df-analytics-register" data-testid="v2-administration-evidence-quality">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Evidence quality</h2>
                {evidenceQualityRead === "ready" ? (
                  <p className="df-card-sub">{analytics.evidenceQuality.footnote}</p>
                ) : null}
              </div>
            </div>
            {evidenceQualityRead === "failed" ? (
              <p className="df-refusal">
                Evidence quality could not be read for this range. Nothing here is a count of zero.
              </p>
            ) : (
            <AnalyticsRegister
              stacked={stacked}
              head={["MEMBER", "GRADE", "EVIDENCE", "EVENTS"]}
              rows={analytics.evidenceQuality.rows.map((row) => ({
                id: row.id,
                cells: [row.who, row.grade, row.evidence, row.events],
              }))}
              empty={analytics.evidenceQuality.empty}
              emptyCopy={analytics.evidenceQuality.emptyCopy}
              testId="v2-administration-evidence-quality"
            />
            )}
          </section>
          )}
        </>
      )}
    </>
  );
}

function FigureBand({ figures, testId }: { figures: AnalyticsFigure[]; testId: string }) {
  if (figures.length === 0) return null;
  return (
    <div className="df-figure-band" data-testid={testId}>
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
        <Button variant="outline" type="button" onClick={() => onRotate(row.id, row.name)} className="df-btn">
          Rotate
        </Button>
      ) : null}
      {row.revoke ? (
        <Button variant="outline" type="button" onClick={() => onRevoke(row.id)} className="df-btn">
          Revoke
        </Button>
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
        <Button variant="outline" type="button" onClick={() => onRotate(row.id, row.url)} className="df-btn">
          Rotate
        </Button>
      ) : null}
      {row.disable ? (
        <Button variant="outline" type="button" onClick={() => onDisable(row.id)} className="df-btn">
          Disable
        </Button>
      ) : null}
      {row.enable ? (
        <Button variant="outline" type="button" onClick={() => onEnable(row.id)} className="df-btn">
          Enable
        </Button>
      ) : null}
    </span>
  );
}

/**
 * v1 chose an allowed timezone from a list; v2 keeps the typed input and its
 * validation, and offers the list beside it as the shadcn combobox (#260).
 */
function TimezonePicker({
  zones,
  disabled,
  onChoose,
}: {
  zones: string[];
  disabled: boolean;
  onChoose: (zone: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          disabled={disabled}
          className="df-btn"
          data-testid="v2-timezone-picker"
        >
          Choose from list
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="df-v2 df-select-content df-timezone-picker">
        <Command>
          <CommandInput placeholder="Search timezones" aria-label="Search timezones" />
          <CommandList>
            <CommandEmpty>No timezone matches.</CommandEmpty>
            {zones.map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                className="df-select-item"
                onSelect={() => {
                  onChoose(zone);
                  setOpen(false);
                }}
              >
                {zone}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Ending the subscription is a modal confirmation (#249, F5). The trigger
 * carries the destructive treatment so it never looks like the routine
 * button beside it (#245, F1).
 */
function CancelControl({
  action,
  pending,
  onConfirm,
}: {
  action: BillingAction;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructiveOutline"
          className="df-btn"
          disabled={pending}
          data-testid="v2-administration-billing-cancel"
        >
          {action.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="df-v2 df-alert">
        <AlertDialogHeader>
          <AlertDialogTitle>{action.label}</AlertDialogTitle>
          <AlertDialogDescription>{action.consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Focused on open: the destructive action reads first in this footer
              (shadcn stacks it above the dismissal on a phone, which is the
              platform convention), so the keyboard must not agree with it. */}
          <AlertDialogCancel className="df-btn" autoFocus>
            Keep subscription
          </AlertDialogCancel>
          <AlertDialogAction
            className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            data-testid="v2-administration-billing-cancel-confirm"
            onClick={onConfirm}
          >
            {pending ? "Cancelling…" : action.label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
