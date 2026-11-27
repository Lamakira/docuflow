import { useEffect, useState } from "react";
import { useReturnFocus } from "./returnFocus";
import { Ban, Copy, Plus, RotateCw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { PUBLIC_API_CAPABILITIES, WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID, WEBHOOK_EVENT_TYPES } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  SERVICE_ACCOUNT_NAME_MAX,
  composeServiceAccounts,
  composeWebhookEndpoints,
  revokeServiceAccountPath,
  rotateServiceAccountPath,
  rotateWebhookEndpointPath,
  secretOnce,
  serviceAccountIssue,
  serviceAccountPath,
  serviceAccountsPath,
  webhookDisablePath,
  webhookEnablePath,
  webhookEndpointsPath,
  type RevealedSecretInput,
  type ServiceAccountInput,
  type ServiceAccountRow,
  type WebhookEndpointInput,
  type WebhookEndpointRow,
} from "./administration";
import { copyToClipboard, errorMessage, notify } from "./notify";
import { FilterCheck } from "./V2FilterCheck";
import { V2FormDialog } from "./V2FormDialog";
import { SkeletonSection } from "./V2Skeleton";
import { V2EmptyState, V2LoadFailed } from "./V2EmptyState";
import { DestructiveConfirm } from "./V2DestructiveConfirm";
import {
  AdministrationRefused,
  CheckRow,
  WriteRefusal,
  useAdministrationRead,
  useAdministrationWrites,
  type AdministrationContext,
} from "./V2AdministrationParts";

/**
 * Nothing on `main` delivers to a Webhook Endpoint yet (F105): the card and its
 * dialog stay out of the page until the delivery is merged.
 */
const WEBHOOKS_AVAILABLE = false;

type AccountDraft = { name: string; capabilityIds: string[]; problem: string | null };

const EMPTY_DRAFT: AccountDraft = { name: "", capabilityIds: [], problem: null };

/** The Integrations tab: Service Accounts, and the key shown once after a create or a rotation. */
export function V2AdministrationIntegrations({ context }: { context: AdministrationContext }) {
  const read = useAdministrationRead<ServiceAccountInput[]>(serviceAccountsPath(), "Service Accounts", "service-accounts");
  const writes = useAdministrationWrites(context);
  const [showRevoked, setShowRevoked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<ServiceAccountRow | null>(null);
  const [editDraft, setEditDraft] = useState<AccountDraft>(EMPTY_DRAFT);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<RevealedSecretInput | null>(null);

  const accounts = composeServiceAccounts({
    serviceAccounts: read.data ?? [],
    condition: context.condition,
    showRevoked,
  });

  function refreshAccounts() {
    void queryClient.invalidateQueries({ queryKey: [serviceAccountsPath()] });
  }

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", serviceAccountsPath(), { name: draft.name.trim(), capabilityIds: draft.capabilityIds }),
    onSuccess: (created: ServiceAccountInput & { plaintextKey?: string }) => {
      refreshAccounts();
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      writes.clear();
      notify.success("Service Account created");
      if (created.plaintextKey) {
        setRevealedSecret({ kind: "service-account", id: created.id, label: created.name, plaintext: created.plaintextKey });
      }
    },
    onError: (error) => setDraft((current) => ({ ...current, problem: errorMessage(error) })),
  });

  const save = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", serviceAccountPath(id), { name: editDraft.name.trim(), capabilityIds: editDraft.capabilityIds }),
    onSuccess: () => {
      refreshAccounts();
      setEditing(null);
      notify.success("Service Account saved");
    },
    onError: (error) => setEditDraft((current) => ({ ...current, problem: errorMessage(error) })),
  });

  const rotate = useMutation({
    mutationFn: (row: ServiceAccountRow) => apiRequest("POST", rotateServiceAccountPath(row.id)),
    onMutate: (row) => setRotatingId(row.id),
    onSuccess: (rotated: { plaintextKey?: string }, row) => {
      refreshAccounts();
      writes.clear();
      notify.success("Service Account key rotated");
      if (rotated.plaintextKey) {
        setRevealedSecret({ kind: "service-account", id: row.id, label: row.name, plaintext: rotated.plaintextKey });
      }
    },
    onError: (error: Error) => writes.refuse(error.message || "The key could not be rotated."),
    onSettled: () => setRotatingId(null),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest("POST", revokeServiceAccountPath(id)),
    onSuccess: () => {
      refreshAccounts();
      writes.clear();
      notify.success("Service Account revoked");
    },
    onError: (error: Error) => writes.refuse(error.message || "The Service Account could not be revoked."),
  });

  function openCreate() {
    if (!writes.guard()) return;
    writes.clear();
    setDraft(EMPTY_DRAFT);
    setCreating(true);
  }

  function openEdit(row: ServiceAccountRow) {
    if (!writes.guard()) return;
    setEditDraft({ name: row.name, capabilityIds: row.capabilityIds, problem: null });
    setEditing(row);
  }

  function onCreate() {
    const issue = serviceAccountIssue(draft.name, draft.capabilityIds);
    if (issue) return setDraft((current) => ({ ...current, problem: issue }));
    create.mutate();
  }

  function onSave() {
    if (!editing) return;
    const issue = serviceAccountIssue(editDraft.name, editDraft.capabilityIds);
    if (issue) return setEditDraft((current) => ({ ...current, problem: issue }));
    save.mutate(editing.id);
  }

  const createButton = (variant: "default" | "outline") => (
    <Button variant={variant} type="button" onClick={openCreate} className="df-btn">
      <Plus strokeWidth={1.6} aria-hidden />
      New Service Account
    </Button>
  );

  return (
    <>
      <WriteRefusal refusal={writes.refusal} />
      {read.state === "loading" ? (
        <SkeletonSection title="Service Accounts" className="df-admin-register" columns={4} rows={2} />
      ) : (
        <section className="df-card df-admin-register" data-testid="v2-administration-service-accounts">
          <div className="df-card-head">
            <h2 className="df-card-title">Service Accounts</h2>
            {read.state === "ready" ? (
              <span className="df-row-actions">
                {accounts.revokedCount > 0 ? (
                  <FilterCheck
                    id="df-service-accounts-revoked"
                    label="Show revoked"
                    checked={showRevoked}
                    onChange={setShowRevoked}
                  />
                ) : null}
                {/* An empty card has one create button: the one in its empty state. */}
                {accounts.createAllowed && !accounts.empty ? createButton("outline") : null}
              </span>
            ) : null}
          </div>
          {read.state === "failed" ? (
            <V2LoadFailed title="Service Accounts could not be loaded" onRetry={read.retry} testId="v2-administration-sa-failed" />
          ) : read.state === "refused" ? (
            <AdministrationRefused context={context} />
          ) : accounts.empty ? (
            <V2EmptyState
              icon="keys"
              title={accounts.emptyTitle}
              copy={accounts.emptyCopy}
              action={accounts.createAllowed ? createButton("default") : undefined}
              testId="v2-administration-sa-empty"
            />
          ) : (
            <>
              {context.stacked ? null : (
                <div className="df-register-head df-desktop-only">
                  <span>Name</span>
                  <span>Capabilities</span>
                  <span>Status</span>
                  <span />
                </div>
              )}
              {accounts.rows.map((row) => (
                <div key={row.id} className="df-register-row" data-testid={`v2-administration-sa-${row.id}`}>
                  {context.stacked ? (
                    <span className="df-project-mobile df-admin-stacked-row">
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <div className="df-row-title">{row.name}</div>
                        <div className="df-mono df-meta">
                          {row.status}
                          {row.capabilities !== "-" ? ` · ${row.capabilities}` : ""}
                        </div>
                      </span>
                      <AccountActions
                        row={row}
                        rotating={rotatingId === row.id}
                        onEdit={openEdit}
                        onRotate={(target) => writes.guard() && rotate.mutate(target)}
                        onRevoke={(id) => writes.guard() && revoke.mutate(id)}
                      />
                    </span>
                  ) : (
                    <>
                      <span className="df-row-title">{row.name}</span>
                      <span className="df-mono df-meta">{row.capabilities}</span>
                      <span>
                        <span className="df-status-word" data-tone={row.status === "Active" ? "positive" : undefined}>
                          {row.status}
                        </span>
                      </span>
                      <AccountActions
                        row={row}
                        rotating={rotatingId === row.id}
                        onEdit={openEdit}
                        onRotate={(target) => writes.guard() && rotate.mutate(target)}
                        onRevoke={(id) => writes.guard() && revoke.mutate(id)}
                      />
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      )}

      <V2FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New Service Account"
        description="An integration that calls the public API with its own key. The key is shown once, right after it is created."
        submitLabel={create.isPending ? "Creating…" : "Create Service Account"}
        pending={create.isPending}
        canSubmit
        onSubmit={onCreate}
        refusal={draft.problem}
        testId="v2-administration-new-service-account"
      >
        <AccountFields idPrefix="df-capability" draft={draft} onDraft={setDraft} />
      </V2FormDialog>

      <V2FormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={editing ? `Edit ${editing.name}` : "Edit Service Account"}
        description="Its key stays the same. A Capability taken away is refused from the integration's next call."
        submitLabel={save.isPending ? "Saving…" : "Save Service Account"}
        pending={save.isPending}
        canSubmit
        onSubmit={onSave}
        refusal={editDraft.problem}
        testId="v2-administration-edit-service-account"
      >
        <AccountFields idPrefix="df-edit-capability" draft={editDraft} onDraft={setEditDraft} />
      </V2FormDialog>

      {WEBHOOKS_AVAILABLE ? <WebhookEndpointsCard context={context} onSecret={setRevealedSecret} /> : null}

      <KeyDialog secret={revealedSecret} onClose={() => setRevealedSecret(null)} />
    </>
  );
}

function AccountFields({
  idPrefix,
  draft,
  onDraft,
}: {
  idPrefix: string;
  draft: AccountDraft;
  onDraft: (update: (current: AccountDraft) => AccountDraft) => void;
}) {
  return (
    <>
      <label className="df-daily-field">
        Name
        <input
          type="text"
          value={draft.name}
          autoFocus
          maxLength={SERVICE_ACCOUNT_NAME_MAX}
          aria-label="Service Account name"
          onChange={(event) => onDraft((current) => ({ ...current, name: event.target.value, problem: null }))}
        />
      </label>
      <fieldset className="df-daily-field">
        <legend>Capabilities (at least one)</legend>
        {/* Managing Webhook Endpoints is offered once they deliver (F105). */}
        {PUBLIC_API_CAPABILITIES.filter((capability) => WEBHOOKS_AVAILABLE || capability.id !== WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID).map((capability) => (
          <CheckRow
            key={capability.id}
            id={`${idPrefix}-${capability.id}`}
            label={capability.name}
            checked={draft.capabilityIds.includes(capability.id)}
            onChange={(next) =>
              onDraft((current) => ({
                ...current,
                problem: null,
                capabilityIds: next
                  ? [...current.capabilityIds, capability.id]
                  : current.capabilityIds.filter((id) => id !== capability.id),
              }))
            }
          />
        ))}
      </fieldset>
    </>
  );
}

function AccountActions({
  row,
  rotating,
  onEdit,
  onRotate,
  onRevoke,
}: {
  row: ServiceAccountRow;
  rotating: boolean;
  onEdit: (row: ServiceAccountRow) => void;
  onRotate: (row: ServiceAccountRow) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <span className="df-people-action">
      {row.edit ? (
        <Button variant="outline" type="button" onClick={() => onEdit(row)} className="df-btn">
          Edit
        </Button>
      ) : null}
      {row.rotate ? (
        <DestructiveConfirm
          icon={RotateCw}
          label={rotating ? "Rotating…" : "Rotate"}
          title={`Rotate the key of ${row.name}`}
          consequence="The current key stops working at once. The integration is refused until it uses the new key, which is shown once."
          confirmLabel="Rotate key"
          keepLabel="Keep the current key"
          pending={rotating}
          testId={`v2-administration-sa-rotate-${row.id}`}
          onConfirm={() => onRotate(row)}
        />
      ) : null}
      {row.revoke ? (
        <DestructiveConfirm
          icon={Ban}
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

/**
 * The key shown once (F109). It closes by its own button only: any other way
 * out (Esc, a click outside, the corner cross) asks first, and so does leaving
 * the page while it is open.
 */
function KeyDialog({ secret, onClose }: { secret: RevealedSecretInput | null; onClose: () => void }) {
  const [asking, setAsking] = useState(false);
  const shown = secretOnce(secret);
  const returnFocus = useReturnFocus(shown !== null);

  useEffect(() => {
    setAsking(false);
    if (!secret) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [secret]);

  return (
    <Dialog
      open={shown !== null}
      onOpenChange={(open) => {
        if (!open) setAsking(true);
      }}
    >
      <DialogContent onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        className="df-v2 df-alert df-form-dialog"
        data-testid="v2-administration-secret"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          setAsking(true);
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          setAsking(true);
        }}
        // Focus moving out (a closing confirmation hands it back to its
        // trigger) is no attempt to leave: the dialog stays, without asking.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="df-form-dialog-title">The key for {shown?.label}</DialogTitle>
          <DialogDescription className="df-form-dialog-copy">{shown?.confirmation}</DialogDescription>
        </DialogHeader>
        <code className="df-admin-secret">{shown?.plaintext}</code>
        {asking ? (
          <p className="df-refusal" role="alert">
            This key is not shown again. Close without copying it?
          </p>
        ) : null}
        <DialogFooter className="df-form-dialog-actions">
          {asking ? (
            <>
              <Button variant="outline" type="button" className="df-btn" onClick={() => setAsking(false)} autoFocus>
                Keep it open
              </Button>
              <Button variant="destructiveOutline" type="button" className="df-btn" onClick={onClose}>
                Close without copying
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                type="button"
                className="df-btn"
                onClick={() => shown && copyToClipboard(shown.plaintext, "Key copied")}
              >
                <Copy strokeWidth={1.6} aria-hidden />
                Copy
              </Button>
              <Button variant="default" type="button" className="df-btn" onClick={onClose} data-testid="v2-administration-secret-done">
                I copied it
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Kept for the day delivery lands (F105); not rendered while WEBHOOKS_AVAILABLE is false. */
function WebhookEndpointsCard({
  context,
  onSecret,
}: {
  context: AdministrationContext;
  onSecret: (secret: RevealedSecretInput) => void;
}) {
  const read = useAdministrationRead<WebhookEndpointInput[]>(webhookEndpointsPath(), "Webhook Endpoints", "webhooks", {
    enabled: WEBHOOKS_AVAILABLE,
  });
  const writes = useAdministrationWrites(context);
  const [creating, setCreating] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const endpoints = composeWebhookEndpoints({ webhookEndpoints: read.data ?? [], condition: context.condition });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [webhookEndpointsPath()] });
  }

  const create = useMutation({
    mutationFn: () => apiRequest("POST", webhookEndpointsPath(), { url: endpointUrl.trim(), eventTypes }),
    onSuccess: (created: WebhookEndpointInput & { plaintextSecret?: string }) => {
      refresh();
      setCreating(false);
      setEndpointUrl("");
      setEventTypes([]);
      writes.clear();
      notify.success("Webhook Endpoint created");
      if (created.plaintextSecret) {
        onSecret({ kind: "webhook-endpoint", id: created.id, label: created.url, plaintext: created.plaintextSecret });
      }
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  async function act(path: string, done: string, row: WebhookEndpointRow, reveal = false) {
    if (!writes.guard()) return;
    try {
      const result = await apiRequest("POST", path);
      refresh();
      writes.clear();
      notify.success(done);
      if (reveal && result?.plaintextSecret) {
        onSecret({ kind: "webhook-endpoint", id: row.id, label: row.url, plaintext: result.plaintextSecret });
      }
    } catch (error) {
      writes.refuse(error instanceof Error ? error.message : "The Webhook Endpoint could not be changed.");
    }
  }

  const createButton = (variant: "default" | "outline") => (
    <Button
      variant={variant}
      type="button"
      onClick={() => {
        writes.clear();
        setCreating(true);
      }}
      className="df-btn"
    >
      <Plus strokeWidth={1.6} aria-hidden />
      New Webhook Endpoint
    </Button>
  );

  return (
    <section className="df-card df-admin-register" data-testid="v2-administration-webhooks">
      <div className="df-card-head">
        <h2 className="df-card-title">Webhook Endpoints</h2>
        {endpoints.createAllowed && !endpoints.empty ? createButton("outline") : null}
      </div>
      <WriteRefusal refusal={writes.refusal} />
      <V2FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New Webhook Endpoint"
        description="A public https address that receives the chosen events. Its signing secret is shown once, right after it is created."
        submitLabel={create.isPending ? "Creating…" : "Create Webhook Endpoint"}
        pending={create.isPending}
        canSubmit={Boolean(endpointUrl.trim()) && eventTypes.length > 0}
        onSubmit={() => writes.guard() && create.mutate()}
        testId="v2-administration-new-webhook-endpoint"
      >
        <label className="df-daily-field">
          Address
          <input
            type="url"
            value={endpointUrl}
            autoFocus
            placeholder="https://hooks.example.com/docuflow"
            aria-label="Webhook Endpoint address"
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
              onChange={(next) =>
                setEventTypes((current) => (next ? [...current, type] : current.filter((value) => value !== type)))
              }
            />
          ))}
        </fieldset>
      </V2FormDialog>
      {read.state === "failed" ? (
        <V2LoadFailed title="Webhook Endpoints could not be loaded" onRetry={read.retry} />
      ) : read.state === "refused" ? (
        <AdministrationRefused context={context} />
      ) : endpoints.empty ? (
        <V2EmptyState
          icon="webhooks"
          title={endpoints.emptyTitle}
          copy={endpoints.emptyCopy}
          action={endpoints.createAllowed ? createButton("default") : undefined}
          testId="v2-administration-wh-empty"
        />
      ) : (
        <>
          {context.stacked ? null : (
            <div className="df-register-head df-desktop-only">
              <span>Address</span>
              <span>Events</span>
              <span>Status</span>
              <span />
            </div>
          )}
          {endpoints.rows.map((row) => (
            <div key={row.id} className="df-register-row" data-testid={`v2-administration-wh-${row.id}`}>
              <span className="df-row-title">{row.url}</span>
              <span className="df-mono df-meta">{row.eventTypes}</span>
              <span>
                <span className="df-status-word" data-tone={row.status === "Active" ? "positive" : undefined}>
                  {row.status}
                </span>
              </span>
              <span className="df-people-action">
                {row.rotate ? (
                  <Button variant="outline" type="button" className="df-btn" onClick={() => act(rotateWebhookEndpointPath(row.id), "Webhook Endpoint secret rotated", row, true)}>
                    Rotate
                  </Button>
                ) : null}
                {row.disable ? (
                  <Button variant="outline" type="button" className="df-btn" onClick={() => act(webhookDisablePath(row.id), "Webhook Endpoint disabled", row)}>
                    Disable
                  </Button>
                ) : null}
                {row.enable ? (
                  <Button variant="outline" type="button" className="df-btn" onClick={() => act(webhookEnablePath(row.id), "Webhook Endpoint enabled", row)}>
                    Enable
                  </Button>
                ) : null}
              </span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
