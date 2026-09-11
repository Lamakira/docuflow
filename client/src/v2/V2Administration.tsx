import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PUBLIC_API_CAPABILITIES, WEBHOOK_EVENT_TYPES } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  administrationWriteRefusal,
  billingCancelPath,
  billingCheckoutPath,
  billingPaymentMethodPath,
  billingSeatsPath,
  billingSubscriptionPath,
  canManageAdministration,
  composeAdministration,
  hostedBillingSession,
  rotateServiceAccountPath,
  rotateWebhookEndpointPath,
  revokeServiceAccountPath,
  serviceAccountsPath,
  webhookDisablePath,
  webhookEnablePath,
  webhookEndpointsPath,
  type BillingInput,
  type RevealedSecretInput,
  type ServiceAccountInput,
  type WebhookEndpointInput,
} from "./administration";
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

function returnUrl(): string {
  return `${window.location.origin}/administration`;
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

  if (!memberships || peopleLoading || (canManage && (accountsLoading || endpointsLoading || billingLoading))) {
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
