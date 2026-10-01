import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PUBLIC_API_CAPABILITIES,
  WEBHOOK_EVENT_TYPES,
  type CrmModuleWithFields,
  type ScreenshotPolicy,
} from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { SkeletonSection, V2PageSkeleton } from "./V2Skeleton";
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
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  addAllowedTimezone,
  timezoneSuggestions,
  administrationWriteRefusal,
  TRACKING_POLICY_SAVED,
  billingCancelPath,
  billingCheckoutPath,
  billingPaymentMethodPath,
  billingSeatsPath,
  billingSubscriptionPath,
  canManageAdministration,
  composeAdministration,
  composeTrackingPolicyEditor,
  hostedBillingSession,
  planPickerNote,
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
  type BillingAction,
  type BillingInput,
  type RevealedSecretInput,
  type ServiceAccountInput,
  type WebhookEndpointInput,
} from "./administration";
import { trackingPolicyPath } from "./activity";
import { motionForSurface } from "./motion";
import { copyToClipboard, isStandingRefusal, notify } from "./notify";
import { billingConditionTone, swatchStyle } from "./palette";
import { CheckIcon, SourceMark } from "./icons";
import { sourceIcon } from "./sourceIcons";
import {
  PIPELINE_COLOURS,
  PIPELINE_LISTS_INTRO,
  PIPELINE_LIST_QUERY_KEYS,
  addPipelineOption,
  adminModulesPath,
  composePipelineLists,
  movePipelineOption,
  recolourPipelineOption,
  removePipelineOption,
  renamePipelineOption,
  savePipelineList,
  PIPELINE_RENAME_HINT,
  PIPELINE_SAVED_MS,
  feedbackFor,
  pipelineFeedback,
  type PipelineFeedback,
  type PipelineEdit,
  type PipelineListModel,
} from "./pipelineLists";
import {
  ADMINISTRATION_TAB_IDS,
  administrationTabHref,
  administrationTabs,
  type AdministrationTabId,
} from "./presentation";
import { workspaceOwnerName } from "./workspace";
import { V2SupportAccess } from "./V2SupportAccess";
import { useV2Chrome } from "./V2Shell";
import { V2FormDialog } from "./V2FormDialog";
import { AnalyticsRegister, FigureBand, readBehindAdministration } from "./V2Analytics";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import {
  BILLING_INTERVAL_LABEL,
  FEATURE_LABEL,
  billingPlanPath,
  entitlementsPath,
  intendedPricedPlan,
  planIncludes,
  planIntentNote,
  pricedPlans,
  useEntitlements,
  type BillingInterval,
  type Entitlements,
  type PricedPlanKey,
} from "./plan";

type WorkspaceMembershipsResponse = {
  memberships: Array<{
    firstName: string | null;
    lastName: string | null;
    email: string;
    workspaceRole: string;
  }>;
};

const SECRET_MOTION = motionForSurface("secret-once").enterExit;

type WorkspaceSettingsResponse = {
  screenshotPolicy: ScreenshotPolicy | null;
  allowedTimezones: string[] | null;
};

/** Stripe hands the customer back to the tab that sent them. */
function returnUrl(): string {
  return `${window.location.origin}${administrationTabHref("billing")}`;
}

function isAdministrationTab(value: string): value is AdministrationTabId {
  return (ADMINISTRATION_TAB_IDS as readonly string[]).includes(value);
}

export function V2AdministrationPage() {
  const params = useParams<{ tab?: string }>();
  const [, navigate] = useLocation();
  const requested = params.tab ?? "workspace";
  const tab: AdministrationTabId = isAdministrationTab(requested) ? requested : "workspace";

  // Analytics left Administration for the rail (#281). An old deep link to its
  // warnings, or a tab that does not exist, still lands somewhere real.
  useEffect(() => {
    if (window.location.hash === "#alerts") {
      navigate("/analytics#alerts", { replace: true });
      return;
    }
    if (!isAdministrationTab(requested)) navigate(administrationTabHref("workspace"), { replace: true });
  }, [navigate, requested]);

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
  const [chosenPlan, setChosenPlan] = useState<PricedPlanKey | null>(null);
  const [chosenInterval, setChosenInterval] = useState<BillingInterval | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<RevealedSecretInput | null>(null);
  const [actionRefusal, setActionRefusal] = useState<string | null>(null);
  const [policyDraft, setPolicyDraft] = useState<ScreenshotPolicy>(() => normalizeScreenshotPolicy(null));
  const [timezoneDraft, setTimezoneDraft] = useState<string[]>([]);
  const [timezoneInput, setTimezoneInput] = useState("");
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineFeedback | null>(null);
  const pipelineSaves = useRef(0);

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
    queryKey: [adminModulesPath()],
    enabled: canManage,
    queryFn: () => readBehindAdministration<CrmModuleWithFields[]>(adminModulesPath()).then((rows) => rows ?? []),
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

  const { data: entitlements } = useEntitlements();
  const currentPriced = pricedPlans(entitlements).some((plan) => plan.planKey === entitlements?.planKey)
    ? (entitlements!.planKey as PricedPlanKey)
    : null;
  const planChoice: PricedPlanKey = chosenPlan ?? currentPriced ?? intendedPricedPlan(entitlements) ?? "business";
  const intervalChoice: BillingInterval =
    chosenInterval ?? entitlements?.billingInterval ?? entitlements?.intendedInterval ?? "monthly";

  const screenshotCapacity = entitlements?.screenshotProjectCapacity ?? null;
  const { data: screenshotProjects } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/crm/projects", { pageSize: 500 }],
    enabled: canManage && screenshotCapacity != null,
    queryFn: () => fetch("/api/crm/projects?pageSize=500", { credentials: "include" }).then((res) => res.json()),
  });

  const { data: workspaceSettings, isLoading: workspaceSettingsLoading } =
    useQuery<WorkspaceSettingsResponse | null>({
      queryKey: [workspaceSettingsPath()],
      enabled: canManage,
      queryFn: () => readBehindAdministration<WorkspaceSettingsResponse>(workspaceSettingsPath()),
    });

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
    members: people?.memberships,
  });
  const tabs = administrationTabs(tab, workspaceRole);

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

  const trackingPolicy = composeTrackingPolicyEditor({
    workspaceName,
    workspaceRole,
    ownerName,
    condition,
    saved: savedPolicy,
    draft: policyDraft,
    savedTimezones,
    draftTimezones: timezoneDraft,
    refused: settingsRefused,
  });

  function refuseWrite(message: string) {
    if (!isStandingRefusal(message)) return notify.error(message);
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
      notify.success("Service Account created");
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
      notify.success("Webhook Endpoint created");
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
        planKey: planChoice,
        interval: intervalChoice,
        seatQuantity: seats,
        successUrl: returnUrl(),
        cancelUrl: returnUrl(),
      });
      const redirect = hostedBillingSession({ url: session.url });
      window.location.assign(redirect.url);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const changePlan = useMutation({
    mutationFn: () => apiRequest("POST", billingPlanPath(), { planKey: planChoice, interval: intervalChoice }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [billingSubscriptionPath()] });
      queryClient.invalidateQueries({ queryKey: [entitlementsPath()] });
      setChosenPlan(null);
      setChosenInterval(null);
      setActionRefusal(null);
      notify.success("Plan changed");
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const changeSeats = useMutation({
    mutationFn: () => apiRequest("POST", billingSeatsPath(), { seatQuantity: Number(seatQuantity) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [billingSubscriptionPath()] });
      setSeatQuantity("");
      setActionRefusal(null);
      notify.success("Seats updated");
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
      notify.success(TRACKING_POLICY_SAVED);
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const saveTimezones = useMutation({
    mutationFn: () => apiRequest("PATCH", workspaceSettingsPath(), { allowedTimezones: timezoneDraft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [workspaceSettingsPath()] });
      setActionRefusal(null);
      notify.success("Screencasts timezones saved");
    },
    onError: (error: Error) => refuseWrite(error.message),
  });

  const cancelAtPeriodEnd = useMutation({
    mutationFn: () => apiRequest("POST", billingCancelPath(), {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [billingSubscriptionPath()] });
      setActionRefusal(null);
      notify.success("Subscription set to cancel at period end");
    },
    onError: (error: Error) => refuseWrite(error.message),
  });
  const pipelineLists = composePipelineLists(crmModules);
  const savePipeline = useMutation({
    mutationFn: ({ list, edit }: { list: PipelineListModel; edit: { options: string[] }; feedback: PipelineFeedback }) =>
      savePipelineList(list, edit, (method, path, body) => apiRequest(method, path, body)),
    onSuccess: (_data, { feedback }) => {
      setActionRefusal(null);
      setPipelineStatus((current) =>
        current?.id === feedback.id ? pipelineFeedback(feedback.id, feedback.listId, feedback.rowId, { phase: "saved" }) : current,
      );
    },
    onError: (error: Error, { feedback }) => {
      refuseWrite(error.message);
      setPipelineStatus((current) => (current?.id === feedback.id ? null : current));
    },
    // A failed step may still have written the module or field before it.
    onSettled: () => {
      for (const queryKey of PIPELINE_LIST_QUERY_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });

  useEffect(() => {
    if (pipelineStatus?.phase !== "saved") return;
    const shown = pipelineStatus.id;
    const timer = window.setTimeout(
      () => setPipelineStatus((current) => (current?.id === shown ? null : current)),
      PIPELINE_SAVED_MS,
    );
    return () => window.clearTimeout(timer);
  }, [pipelineStatus]);

  /**
   * Whether the edit went to the server; a refused one leaves the row as it
   * was. `rowId` is the row the feedback sits beside, or null for the list.
   */
  function onPipelineEdit(list: PipelineListModel, edit: PipelineEdit, rowId: string | null): boolean {
    if (!guardWrite()) return false;
    pipelineSaves.current += 1;
    const id = pipelineSaves.current;
    if (!edit.ok) {
      setPipelineStatus(pipelineFeedback(id, list.id, rowId, { phase: "failed", reason: edit.reason }));
      return false;
    }
    const feedback = pipelineFeedback(id, list.id, rowId, { phase: "saving" });
    setPipelineStatus(feedback);
    savePipeline.mutate({ list, edit: { options: edit.options }, feedback });
    return true;
  }

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
      notify.success("Service Account key rotated");
      if (rotated.plaintextKey) {
        setRevealedSecret({
          kind: "service-account",
          id,
          label,
          plaintext: rotated.plaintextKey,
        });
      }
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Key could not be rotated.");
    }
  }

  async function onRevokeAccount(id: string) {
    if (!guardWrite()) return;
    try {
      await apiRequest("POST", revokeServiceAccountPath(id));
      queryClient.invalidateQueries({ queryKey: [serviceAccountsPath()] });
      setActionRefusal(null);
      notify.success("Service Account revoked");
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Service Account could not be revoked.");
    }
  }

  async function onRotateEndpoint(id: string, label: string) {
    if (!guardWrite()) return;
    try {
      const rotated = await apiRequest("POST", rotateWebhookEndpointPath(id));
      queryClient.invalidateQueries({ queryKey: [webhookEndpointsPath()] });
      setActionRefusal(null);
      notify.success("Webhook Endpoint secret rotated");
      if (rotated.plaintextSecret) {
        setRevealedSecret({
          kind: "webhook-endpoint",
          id,
          label,
          plaintext: rotated.plaintextSecret,
        });
      }
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Secret could not be rotated.");
    }
  }

  async function onDisableEndpoint(id: string) {
    if (!guardWrite()) return;
    try {
      await apiRequest("POST", webhookDisablePath(id));
      queryClient.invalidateQueries({ queryKey: [webhookEndpointsPath()] });
      setActionRefusal(null);
      notify.success("Webhook Endpoint disabled");
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Webhook Endpoint could not be disabled.");
    }
  }

  async function onEnableEndpoint(id: string) {
    if (!guardWrite()) return;
    try {
      await apiRequest("POST", webhookEnablePath(id));
      queryClient.invalidateQueries({ queryKey: [webhookEndpointsPath()] });
      setActionRefusal(null);
      notify.success("Webhook Endpoint enabled");
    } catch (error) {
      refuseWrite(error instanceof Error ? error.message : "Webhook Endpoint could not be enabled.");
    }
  }

  function editPolicy(patch: Partial<ScreenshotPolicy>) {
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

  function onCreateAccount() {
    if (!guardWrite()) return;
    if (!accountName.trim()) return;
    createAccount.mutate();
  }

  function onCreateEndpoint() {
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

      {shownRefusal && !creatingAccount && !creatingEndpoint ? <p className="df-refusal">{shownRefusal}</p> : null}

      {/* One configuration section at a time (#281). The tab lives in the path,
          so a deep link opens the section it names. Manual activation: arrowing
          across the tabs moves focus, not history. */}
      <Tabs
        value={tab}
        onValueChange={(next) => navigate(administrationTabHref(next as AdministrationTabId))}
        activationMode="manual"
        className="df-admin-tabs"
      >
        <TabsList className="df-tabs" aria-label="Administration">
          {tabs.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="df-tab"
              data-testid={`v2-administration-tab-${item.id}`}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="workspace" className="df-admin-panel" data-testid="v2-administration-panel-workspace">
          <section className="df-card" data-testid="v2-administration-workspace">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Workspace</h2>
                <p className="df-card-sub">Who owns {workspaceName}, and the Workspace Role you hold in it.</p>
              </div>
            </div>
            <FigureBand figures={page.workspace.figures} testId="v2-administration-workspace-figures" />
          </section>
        </TabsContent>

        <TabsContent value="members" className="df-admin-panel" data-testid="v2-administration-panel-members">
          <section className="df-card df-admin-register" data-testid="v2-administration-members">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Members &amp; Roles</h2>
                <p className="df-card-sub">{page.members.note}</p>
              </div>
              <Button asChild variant="outline" className="df-btn">
                <Link href="/people" data-testid="v2-administration-members-people">
                  Open People
                </Link>
              </Button>
            </div>
            <AnalyticsRegister
              stacked={layout.stackedRegister}
              head={["MEMBER", "EMAIL", "WORKSPACE ROLE"]}
              rows={page.members.rows.map((row) => ({ id: row.id, cells: [row.name, row.email, row.workspaceRole] }))}
              empty={page.members.empty}
              emptyCopy={page.members.emptyCopy}
              testId="v2-administration-member"
            />
          </section>
        </TabsContent>

        <TabsContent value="pipeline-lists" className="df-admin-panel" data-testid="v2-administration-panel-pipeline-lists">
          <p className="df-policy-hint" data-testid="v2-administration-pipeline-lists">{PIPELINE_LISTS_INTRO}</p>
          {pipelineLists.map((list) => (
            <PipelineListCard
              key={list.id}
              list={list}
              pending={savePipeline.isPending}
              feedback={pipelineStatus?.listId === list.id ? pipelineStatus : null}
              onEdit={(edit, rowId) => onPipelineEdit(list, edit, rowId)}
            />
          ))}
        </TabsContent>

        <TabsContent value="billing" className="df-admin-panel" data-testid="v2-administration-panel-billing">
          <section className="df-card df-policy-form" data-testid="v2-administration-billing">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Billing</h2>
                <p className="df-card-sub">
                  Plan, Billable Seats, and the term for this Workspace. Card details stay with Stripe.
                </p>
              </div>
              {page.billing.condition ? (
                <span className="df-status" data-status={page.billing.condition} data-tone={billingConditionTone(page.billing.condition)}>
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

            {entitlements && page.billing.actions.some((action) => action.id === "checkout" || action.id === "plan") ? (
              <PlanPicker
                entitlements={entitlements}
                mode={page.billing.actions.some((action) => action.id === "plan") ? "change" : "checkout"}
                plan={planChoice}
                interval={intervalChoice}
                onPlan={setChosenPlan}
                onInterval={setChosenInterval}
                pending={startCheckout.isPending || changePlan.isPending}
                // Checkout is how a Read-only Workspace recovers, so it is not a
                // write the Read-only guard stops.
                onCheckout={() => startCheckout.mutate()}
                onChange={() => {
                  if (!guardWrite()) return;
                  changePlan.mutate();
                }}
              />
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
              {page.billing.actions.filter((action) => action.tone !== "destructive").map((action) => {
                if (action.id === "seats" || action.id === "checkout" || action.id === "plan") return null;
                return (
                  <Button variant="outline" key={action.id} type="button" disabled={updatePaymentMethod.isPending} onClick={() => updatePaymentMethod.mutate()} className="df-btn">
                    {action.label}
                  </Button>
                );
              })}
            </div>

            {/* The one action that ends the Subscription sits apart from the
                routine ones, with its cost stated before it runs (#245 F1). */}
            {page.billing.actions.filter((action) => action.tone === "destructive").map((action) => (
              <div key={action.id} className="df-danger-row" data-testid="v2-administration-billing-cancel">
                <div className="df-danger-copy">
                  <span className="df-row-title">{action.label}</span>
                  <span className="df-meta">{action.consequence}</span>
                </div>
                <CancelControl
                  action={action}
                  pending={cancelAtPeriodEnd.isPending}
                  onConfirm={() => {
                    if (!guardWrite()) return;
                    cancelAtPeriodEnd.mutate();
                  }}
                />
              </div>
            ))}
          </section>
        </TabsContent>

        <TabsContent value="integrations" className="df-admin-panel" data-testid="v2-administration-panel-integrations">
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
                <Button variant="outline" type="button" onClick={() => copyToClipboard(page.secretOnce!.plaintext, "Secret copied")} className="df-btn">
                  Copy
                </Button>
              </div>
            </section>
          ) : null}

          <section className="df-card df-admin-register" data-testid="v2-administration-service-accounts">
            <div className="df-card-head">
              <h2 className="df-card-title">Service Accounts</h2>
              {page.serviceAccounts.createAllowed ? (
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setActionRefusal(null);
                    setCreatingAccount(true);
                  }}
                  className="df-btn"
                >
                  New Service Account
                </Button>
              ) : null}
            </div>
            <V2FormDialog
              open={creatingAccount}
              onOpenChange={setCreatingAccount}
              title="New Service Account"
              description="An integration that calls the public API with its own key. The key is shown once, right after it is created."
              submitLabel={createAccount.isPending ? "Creating…" : "Create Service Account"}
              pending={createAccount.isPending}
              canSubmit={Boolean(accountName.trim())}
              onSubmit={onCreateAccount}
              refusal={actionRefusal}
              testId="v2-administration-new-service-account"
            >
              <label className="df-daily-field">
                NAME
                <input
                  type="text"
                  value={accountName}
                  autoFocus
                  aria-label="Service Account name"
                  onChange={(event) => setAccountName(event.target.value)}
                />
              </label>
              <fieldset className="df-daily-field">
                <legend>CAPABILITIES</legend>
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
            </V2FormDialog>
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
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setActionRefusal(null);
                    setCreatingEndpoint(true);
                  }}
                  className="df-btn"
                >
                  New Webhook Endpoint
                </Button>
              ) : null}
            </div>
            <V2FormDialog
              open={creatingEndpoint}
              onOpenChange={setCreatingEndpoint}
              title="New Webhook Endpoint"
              description="A URL that receives the chosen events. Its signing secret is shown once, right after it is created."
              submitLabel={createEndpoint.isPending ? "Creating…" : "Create Webhook Endpoint"}
              pending={createEndpoint.isPending}
              canSubmit={Boolean(endpointUrl.trim()) && eventTypes.length > 0}
              onSubmit={onCreateEndpoint}
              refusal={actionRefusal}
              testId="v2-administration-new-webhook-endpoint"
            >
              <label className="df-daily-field">
                URL
                <input
                  type="url"
                  value={endpointUrl}
                  autoFocus
                  aria-label="Webhook Endpoint URL"
                  onChange={(event) => setEndpointUrl(event.target.value)}
                />
              </label>
              <fieldset className="df-daily-field">
                <legend>EVENT TYPES</legend>
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
            </V2FormDialog>
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
        </TabsContent>

        <TabsContent value="tracking-policy" className="df-admin-panel" data-testid="v2-administration-panel-tracking-policy">
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
                  {policyDraft.screenshotsEnabled && screenshotCapacity != null ? (
                    <div className="df-policy-group" data-testid="v2-administration-screenshot-project">
                      <p className="df-policy-hint">
                        The {entitlements?.planLabel} Plan captures screenshots on {screenshotCapacity} Project.
                        Time on every other Project is still tracked, without screenshots.
                      </p>
                      <V2FilterSelect
                        label="PROJECT"
                        ariaLabel="Screenshot Project"
                        value={policyDraft.screenshotProjectIds?.[0] ?? V2_SELECT_NONE}
                        disabled={!trackingPolicy.editable}
                        onChange={(next) =>
                          editPolicy({ screenshotProjectIds: next === V2_SELECT_NONE ? null : [next] })
                        }
                        options={[
                          { value: V2_SELECT_NONE, label: "Choose a Project" },
                          ...(screenshotProjects?.data ?? []).map((project) => ({ value: project.id, label: project.name })),
                        ]}
                        testId="v2-administration-screenshot-project-select"
                      />
                    </div>
                  ) : null}
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
                      <p className="df-policy-hint">{trackingPolicy.hints.activeHours}</p>
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
                  <div className="df-policy-group">
                    <p className="df-policy-hint">{trackingPolicy.hints.idleTimeout}</p>
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
                    </div>
                  </div>
                  <CheckRow
                    id="df-policy-idle"
                    label="Prompt on idle"
                    checked={policyDraft.idlePromptEnabled}
                    disabled={!trackingPolicy.editable}
                    onChange={(next) => editPolicy({ idlePromptEnabled: next })}
                  />
                  <p className="df-policy-hint">{trackingPolicy.hints.prompt}</p>
                  {policyDraft.idlePromptEnabled ? (
                    <div className="df-policy-group">
                      <p className="df-policy-hint">{trackingPolicy.hints.countdown}</p>
                      <div className="df-policy-grid">
                      <label className="df-daily-field">
                        Prompt countdown (seconds)
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
        </TabsContent>

        <TabsContent value="support-access" className="df-admin-panel" data-testid="v2-administration-panel-support-access">
          <V2SupportAccess workspaceRole={workspaceRole} />
        </TabsContent>
      </Tabs>
    </div>
  );
}



function AdministrationSkeleton() {
  return (
    <V2PageSkeleton
      title="Administration"
      testId="v2-administration"
      status="Loading Administration for this Workspace."
    >
      <SkeletonSection title="Workspace" className="df-analytics-register" tiles={4} />
    </V2PageSkeleton>
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
        <DestructiveConfirm
          label="Revoke"
          title={`Revoke ${row.name}`}
          consequence="Its key stops working at once, and every call the integration makes with it is refused. A revoked Service Account cannot be restored."
          confirmLabel="Revoke Service Account"
          keepLabel="Keep Service Account"
          pending={false}
          testId={`v2-administration-sa-revoke-${row.id}`}
          onConfirm={() => onRevoke(row.id)}
        />
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

/**
 * The Plans a Workspace can buy or move to (#299). Checkout opens Stripe; a
 * change to a live Subscription asks first, because a lower Plan leaves areas
 * read-only and Stripe prorates the difference.
 */
function PlanPicker({
  entitlements,
  mode,
  plan,
  interval,
  onPlan,
  onInterval,
  pending,
  onCheckout,
  onChange,
}: {
  entitlements: Entitlements;
  mode: "checkout" | "change";
  plan: PricedPlanKey;
  interval: BillingInterval;
  onPlan: (plan: PricedPlanKey) => void;
  onInterval: (interval: BillingInterval) => void;
  pending: boolean;
  onCheckout: () => void;
  onChange: () => void;
}) {
  const plans = pricedPlans(entitlements);
  const intentNote = planIntentNote(entitlements);
  const chosen = plans.find((row) => row.planKey === plan);
  const unchanged =
    mode === "change" && plan === entitlements.planKey && interval === entitlements.billingInterval;
  const lost = chosen
    ? (Object.keys(entitlements.features) as (keyof Entitlements["features"])[]).filter(
        (feature) => entitlements.features[feature] && !chosen.features[feature],
      )
    : [];
  const consequence =
    lost.length > 0
      ? `${chosen?.label} leaves out ${lost.map((feature) => FEATURE_LABEL[feature]).join(", ")}. What is already there stays visible but read-only. Stripe prorates the difference on the next invoice.`
      : "Stripe prorates the difference on the next invoice.";

  return (
    <>
      <p className="df-admin-billing-note" data-testid="v2-administration-plans-note">
        {planPickerNote(mode, entitlements.planLabel)}
      </p>
      {intentNote ? (
        <p className="df-admin-billing-note" data-testid="v2-administration-plan-intent">
          {intentNote}
        </p>
      ) : null}
      <div className="df-plan-grid" data-testid="v2-administration-plans">
        {plans.map((row) => {
          const current = row.planKey === entitlements.planKey;
          const selected = row.planKey === plan;
          return (
            <div
              key={row.planKey}
              className="df-plan-card"
              data-current={current ? "true" : "false"}
              data-testid={`v2-administration-plan-${row.planKey}`}
            >
              <div className="df-plan-card-head">
                <span className="df-row-title">{row.label}</span>
                {current ? <span className="df-mono df-plan-tag">CURRENT PLAN</span> : null}
              </div>
              <p className="df-plan-card-includes">{planIncludes(row)}</p>
              <Button
                type="button"
                variant={selected ? "default" : "outline"}
                size="sm"
                className="df-btn"
                aria-pressed={selected}
                onClick={() => onPlan(row.planKey as PricedPlanKey)}
              >
                {selected ? "Selected" : `Select ${row.label}`}
              </Button>
            </div>
          );
        })}
      </div>
      <div className="df-plan-controls">
        <V2FilterSelect
          label="BILLING"
          ariaLabel="Billing interval"
          value={interval}
          onChange={(next) => onInterval(next as BillingInterval)}
          options={(Object.keys(BILLING_INTERVAL_LABEL) as BillingInterval[]).map((value) => ({
            value,
            label: BILLING_INTERVAL_LABEL[value],
          }))}
          testId="v2-administration-plan-interval"
        />
        {mode === "checkout" ? (
          <Button type="button" className="df-btn" disabled={pending} onClick={onCheckout} data-testid="v2-administration-plan-checkout">
            {pending ? "Opening Checkout…" : `Continue to Checkout with ${chosen?.label ?? "this Plan"}`}
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" className="df-btn" disabled={pending || unchanged}>
                {unchanged ? "Current Plan" : `Change to ${chosen?.label ?? "this Plan"}`}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="df-v2 df-alert">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Change to {chosen?.label}, billed {BILLING_INTERVAL_LABEL[interval].toLowerCase()}
                </AlertDialogTitle>
                <AlertDialogDescription>{consequence}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="df-btn" autoFocus>
                  Keep {entitlements.planLabel}
                </AlertDialogCancel>
                <AlertDialogAction
                  className={lost.length > 0 ? "df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90" : "df-btn"}
                  disabled={pending}
                  data-testid="v2-administration-plan-confirm"
                  onClick={onChange}
                >
                  {pending ? "Changing…" : `Change to ${chosen?.label}`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </>
  );
}

/**
 * A destructive row action asks first (#281): the trigger reads as destructive,
 * and the dismissal is focused so the keyboard does not agree by reflex.
 */
function DestructiveConfirm({
  label,
  title,
  consequence,
  confirmLabel,
  keepLabel,
  pending,
  testId,
  onConfirm,
}: {
  label: string;
  title: string;
  consequence: string;
  confirmLabel: string;
  keepLabel: string;
  pending: boolean;
  testId: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructiveOutline" className="df-btn" disabled={pending} data-testid={testId}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="df-v2 df-alert">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="df-btn" autoFocus>
            {keepLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * One of the three lists on Pipeline & lists. Every control writes at once,
 * the way a timezone is added; there is no draft to lose.
 */
function PipelineListCard({
  list,
  pending,
  feedback,
  onEdit,
}: {
  list: PipelineListModel;
  pending: boolean;
  feedback: PipelineFeedback | null;
  onEdit: (edit: PipelineEdit, rowId: string | null) => boolean;
}) {
  const [draft, setDraft] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const listStatus = feedbackFor(feedback, list.id, null);
  return (
    <section className="df-card df-policy-form" data-testid={`v2-administration-list-${list.id}`}>
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">{list.title}</h2>
          <p className="df-card-sub">{list.sub}</p>
        </div>
        {list.saved ? null : <span className="df-status">DEFAULTS</span>}
      </div>
      <div className="df-daily-form">
        {list.unsavedNote ? <p className="df-policy-hint">{list.unsavedNote}</p> : null}
        <ol className="df-pipeline-options" data-list={list.id} aria-label={list.title}>
          {list.rows.map((row) => {
            const rowStatus = feedbackFor(feedback, list.id, row.id);
            const hintId = `v2-pipeline-hint-${list.id}-${row.id}`;
            return (
              <li key={row.id} className="df-pipeline-item" data-testid={`v2-pipeline-option-${list.id}-${row.value}`}>
                <div className="df-pipeline-option">
                  {/* A brand's colour is not the Workspace's to choose, so a Source
                      with its own mark has no picker. */}
                  {list.id === "source" && sourceIcon(row.value) ? (
                    <span className="df-pipeline-mark" data-testid={`v2-pipeline-mark-${row.value}`}>
                      <SourceMark value={row.value} size="box" />
                    </span>
                  ) : (
                    <ColourPicker
                      label={row.label}
                      color={row.color}
                      disabled={pending}
                      onChoose={(color) => onEdit(recolourPipelineOption(list, row.index, color), row.id)}
                    />
                  )}
                  {row.outcome ? (
                    <span className="df-pipeline-outcome">
                      <span className="df-status" data-swatch="" style={swatchStyle(row.color)}>{row.label}</span>
                      <span className="df-mono df-meta">FIXED OUTCOME</span>
                    </span>
                  ) : row.builtIn ? (
                    <span className="df-pipeline-outcome">
                      <span className="df-pipeline-builtin">{row.label}</span>
                      <span className="df-mono df-meta">BUILT IN</span>
                    </span>
                  ) : (
                    <Input
                      // A refused save remounts the field, so it reads the saved name again.
                      key={`${row.label}:${rowStatus?.phase === "failed" ? rowStatus.id : 0}`}
                      className="df-pipeline-label"
                      aria-label={`Name of ${row.label}`}
                      aria-describedby={hintId}
                      defaultValue={row.label}
                      disabled={pending}
                      onFocus={() => setNaming(row.id)}
                      onBlur={(event) => {
                        setNaming(null);
                        const next = event.target.value.trim();
                        if (next === row.label) return;
                        if (!onEdit(renamePipelineOption(list, row.index, next), row.id)) event.target.value = row.label;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") event.currentTarget.value = row.label;
                        if (event.key === "Enter" || event.key === "Escape") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  )}
                  {row.outcome ? null : (
                    <span className="df-row-actions">
                      <Button variant="outline" type="button" className="df-btn" disabled={pending || !row.canMoveUp} aria-label={`Move ${row.label} up`} onClick={() => onEdit(movePipelineOption(list, row.index, -1), row.id)}>
                        Up
                      </Button>
                      <Button variant="outline" type="button" className="df-btn" disabled={pending || !row.canMoveDown} aria-label={`Move ${row.label} down`} onClick={() => onEdit(movePipelineOption(list, row.index, 1), row.id)}>
                        Down
                      </Button>
                      {row.canRemove ? (
                        <DestructiveConfirm
                          label="Remove"
                          title={`Remove ${row.label}`}
                          consequence={row.removeConsequence}
                          confirmLabel={`Remove ${list.noun}`}
                          keepLabel={`Keep ${list.noun}`}
                          pending={pending}
                          testId={`v2-pipeline-remove-${list.id}-${row.value}`}
                          onConfirm={() => onEdit(removePipelineOption(list, row.index), null)}
                        />
                      ) : null}
                    </span>
                  )}
                </div>
                <PipelineStatus
                  status={rowStatus}
                  hintId={hintId}
                  hint={naming === row.id ? PIPELINE_RENAME_HINT : null}
                />
              </li>
            );
          })}
        </ol>
        <form
          className="df-admin-form df-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (onEdit(addPipelineOption(list, draft), null)) setDraft("");
          }}
        >
          <label className="df-daily-field">
            New {list.noun}
            <Input value={draft} disabled={pending} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <Button variant="default" type="submit" disabled={pending || !draft.trim()} className="df-btn">
            Add {list.noun}
          </Button>
        </form>
        <PipelineStatus status={listStatus} />
        <p className="df-policy-hint">{list.renameNote}</p>
        {/* One polite voice per list, so a save is heard once wherever it shows. */}
        <p className="df-sr-only" aria-live="polite" data-testid={`v2-pipeline-live-${list.id}`}>
          {feedback && feedback.phase !== "failed" ? feedback.message : ""}
        </p>
      </div>
    </section>
  );
}

/**
 * The slot beside a row (or under the list): the keys while its name has
 * focus, then “Saving…”, a brief “Saved”, or why the save was refused.
 */
function PipelineStatus({
  status,
  hint = null,
  hintId,
}: {
  status: PipelineFeedback | null;
  hint?: string | null;
  hintId?: string;
}) {
  if (status?.phase === "failed") {
    return (
      <p id={hintId} className="df-pipeline-status df-refusal" data-phase="failed" role="alert">
        {status.message}
      </p>
    );
  }
  return (
    <p id={hintId} className="df-pipeline-status" data-phase={status?.phase ?? (hint ? "hint" : "idle")}>
      {status?.phase === "saved" ? <CheckIcon /> : null}
      {status ? status.message : hint}
    </p>
  );
}

/** The colours an option may wear, each drawn as the pill it would make. */
function ColourPicker({
  label,
  color,
  disabled,
  onChoose,
}: {
  label: string;
  color: string;
  disabled: boolean;
  onChoose: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const known = PIPELINE_COLOURS.some((colour) => colour.hex === color.toLowerCase());
  const colours = known ? PIPELINE_COLOURS : [{ name: "Current", hex: color }, ...PIPELINE_COLOURS];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" type="button" disabled={disabled} className="df-btn df-pipeline-colour" aria-label={`Colour of ${label}`}>
          <span className="df-pipeline-swatch" style={swatchStyle(color)} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="df-v2 df-select-content df-colour-picker">
        <Command>
          <CommandList>
            {colours.map((colour) => (
              <CommandItem
                key={colour.hex}
                value={colour.name}
                className="df-select-item"
                onSelect={() => {
                  setOpen(false);
                  if (colour.hex !== color) onChoose(colour.hex);
                }}
              >
                <span className="df-colour-option" style={swatchStyle(colour.hex)}>
                  <span className="df-colour-chip" aria-hidden="true" />
                  <span className="df-status" data-swatch="">{colour.name}</span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
