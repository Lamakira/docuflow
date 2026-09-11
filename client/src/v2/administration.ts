/**
 * Administration destination (#193).
 * Novelty: a newly created or rotated secret is shown once
 * (rare state indication). Do not animate: the settings form on
 * every keystroke, billing numbers counting up.
 */

import {
  PUBLIC_API_CAPABILITIES,
  VIEW_DAILY_UPDATES_CAPABILITY_ID,
} from "@shared/schema";
import { chromeRefusal } from "./chrome";
import type { WorkspaceCondition } from "./workspace";

const CAPABILITY_LABELS = new Map<string, string>([
  [VIEW_DAILY_UPDATES_CAPABILITY_ID, "View daily updates"],
  ...PUBLIC_API_CAPABILITIES.map((row) => [row.id, row.name] as const),
]);

export type ServiceAccountInput = {
  id: string;
  name: string;
  capabilityIds: string[];
  revokedAt: string | Date | null;
  plaintextKey?: string;
};

export type WebhookEndpointInput = {
  id: string;
  url: string;
  eventTypes: string[];
  disabledAt: string | Date | null;
  plaintextSecret?: string;
};

export type BillingInput = {
  planKey: "legacy" | "trial" | "pro" | string;
  billingState: "Trialing" | "Active" | "PastDue" | "ReadOnly" | string;
  purchasedSeatCapacity: number;
  consumedSeatCount: number;
  trialEndsAt: string | Date | null;
  periodEndsAt: string | Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
};

export type RevealedSecretInput = {
  kind: "service-account" | "webhook-endpoint";
  id: string;
  label: string;
  plaintext: string;
};

export type AdministrationInput = {
  workspaceName: string;
  ownerName: string | null;
  workspaceRole: string;
  condition: WorkspaceCondition;
  serviceAccounts: ServiceAccountInput[];
  webhookEndpoints: WebhookEndpointInput[];
  billing: BillingInput | null;
  revealedSecret: RevealedSecretInput | null;
};

export type ServiceAccountRow = {
  id: string;
  name: string;
  capabilities: string;
  status: "ACTIVE" | "REVOKED";
  rotate: boolean;
  revoke: boolean;
};

export type WebhookEndpointRow = {
  id: string;
  url: string;
  eventTypes: string;
  status: "ACTIVE" | "DISABLED";
  rotate: boolean;
  disable: boolean;
  enable: boolean;
};

export type BillingAction = {
  id: "checkout" | "seats" | "payment-method" | "cancel";
  label: string;
};

export type BillingModel = {
  available: boolean;
  plan: string;
  condition: "Trial" | "Active" | "Past due" | "Read-only" | null;
  seats: string;
  entitlements: string;
  actions: BillingAction[];
  checkout: "redirect";
};

export type SecretOnce = RevealedSecretInput & {
  confirmation: string;
};

export type AdministrationModel =
  | { kind: "refusal"; refusal: string; pagePrimary: "case-ink" }
  | {
      kind: "ready";
      subhead: string;
      pagePrimary: "case-ink";
      writeRefusal: string | null;
      secretOnce: SecretOnce | null;
      serviceAccounts: {
        empty: boolean;
        emptyCopy: string;
        rows: ServiceAccountRow[];
        createAllowed: boolean;
      };
      webhookEndpoints: {
        empty: boolean;
        emptyCopy: string;
        rows: WebhookEndpointRow[];
        createAllowed: boolean;
      };
      billing: BillingModel;
    };

export function serviceAccountsPath(): string {
  return "/api/service-accounts";
}

export function revokeServiceAccountPath(id: string): string {
  return `/api/service-accounts/${id}/revoke`;
}

export function rotateServiceAccountPath(id: string): string {
  return `/api/service-accounts/${id}/rotate`;
}

export function webhookEndpointsPath(): string {
  return "/api/webhook-endpoints";
}

export function webhookDisablePath(id: string): string {
  return `/api/webhook-endpoints/${id}/disable`;
}

export function webhookEnablePath(id: string): string {
  return `/api/webhook-endpoints/${id}/enable`;
}

export function rotateWebhookEndpointPath(id: string): string {
  return `/api/webhook-endpoints/${id}/rotate`;
}

export function billingSubscriptionPath(): string {
  return "/api/billing/subscription";
}

export function billingCheckoutPath(): string {
  return "/api/billing/checkout";
}

export function billingSeatsPath(): string {
  return "/api/billing/seats";
}

export function billingPaymentMethodPath(): string {
  return "/api/billing/payment-method";
}

export function billingCancelPath(): string {
  return "/api/billing/cancel-at-period-end";
}

export function hostedBillingSession(input: { url: string }): { kind: "redirect"; url: string } {
  return { kind: "redirect", url: input.url };
}

export function canManageAdministration(workspaceRole: string): boolean {
  const role = workspaceRole.trim().toUpperCase();
  return role === "OWNER" || role === "ADMINISTRATOR";
}

export type AdministrationWriteRefusal =
  | { kind: "capability"; ownerName?: string | null }
  | { kind: "workspace-condition"; workspaceName: string; condition: "Read-only" | "Trial" | "Past due" }
  | {
      kind: "error";
      workspaceName: string;
      ownerName?: string | null;
      errorMessage: string;
    };

export function administrationWriteRefusal(input: AdministrationWriteRefusal): string {
  if (input.kind === "capability") {
    return chromeRefusal({
      kind: "capability",
      capability: "Administration",
      ownerName: input.ownerName,
    });
  }
  if (input.kind === "workspace-condition") {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: input.condition,
    });
  }
  const message = input.errorMessage;
  if (/read-only/i.test(message)) {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: "Read-only",
    });
  }
  if (/permission denied|not authorized|access denied|forbidden/i.test(message)) {
    return administrationWriteRefusal({ kind: "capability", ownerName: input.ownerName });
  }
  return chromeRefusal({ kind: "generic", message });
}

function capabilityLabel(capabilityIds: string[]): string {
  if (capabilityIds.length === 0) return "—";
  return capabilityIds.map((id) => CAPABILITY_LABELS.get(id) ?? id).join(" · ");
}

function planLabel(planKey: string): string {
  if (planKey === "trial") return "Trial";
  if (planKey === "pro") return "Pro";
  if (planKey === "legacy") return "Legacy";
  return planKey;
}

function billingCondition(
  billingState: string,
): "Trial" | "Active" | "Past due" | "Read-only" | null {
  if (billingState === "Trialing") return "Trial";
  if (billingState === "Active") return "Active";
  if (billingState === "PastDue") return "Past due";
  if (billingState === "ReadOnly") return "Read-only";
  return null;
}

function composeBilling(input: AdministrationInput): BillingModel {
  const pin = input.billing;
  if (!pin) {
    return {
      available: false,
      plan: "—",
      condition: input.condition === "Trial" || input.condition === "Past due" || input.condition === "Read-only"
        ? input.condition
        : null,
      seats: "Seat counts are not available.",
      entitlements: "",
      actions: [],
      checkout: "redirect",
    };
  }

  const condition = billingCondition(pin.billingState);
  const readOnly = pin.billingState === "ReadOnly" || input.condition === "Read-only";
  const actions: BillingAction[] = [];
  if (pin.planKey === "trial") {
    actions.push({ id: "checkout", label: "Start Pro" });
  }
  if (!readOnly && pin.planKey === "pro") {
    actions.push({ id: "seats", label: "Change seats" });
  }
  if (pin.stripeCustomerId) {
    actions.push({ id: "payment-method", label: "Update payment method" });
  }
  if (!readOnly && pin.billingState === "Active" && !pin.cancelAtPeriodEnd) {
    actions.push({ id: "cancel", label: "Cancel at period end" });
  }

  return {
    available: true,
    plan: planLabel(pin.planKey),
    condition,
    seats: `${pin.consumedSeatCount} of ${pin.purchasedSeatCapacity} Billable Seats consumed.`,
    entitlements: readOnly
      ? "Writes blocked. Viewing, export, and recovery stay available."
      : "Writes allowed.",
    actions,
    checkout: "redirect",
  };
}

export function composeAdministration(input: AdministrationInput): AdministrationModel {
  if (!canManageAdministration(input.workspaceRole)) {
    return {
      kind: "refusal",
      refusal: chromeRefusal({
        kind: "capability",
        capability: "Administration",
        ownerName: input.ownerName,
      }),
      pagePrimary: "case-ink",
    };
  }

  const readOnly = input.condition === "Read-only";
  const serviceRows: ServiceAccountRow[] = input.serviceAccounts.map((row) => {
    const revoked = row.revokedAt != null;
    return {
      id: row.id,
      name: row.name,
      capabilities: capabilityLabel(row.capabilityIds),
      status: revoked ? "REVOKED" : "ACTIVE",
      rotate: !revoked,
      revoke: !revoked,
    };
  });
  const webhookRows: WebhookEndpointRow[] = input.webhookEndpoints.map((row) => {
    const disabled = row.disabledAt != null;
    return {
      id: row.id,
      url: row.url,
      eventTypes: row.eventTypes.join(" · "),
      status: disabled ? "DISABLED" : "ACTIVE",
      rotate: true,
      disable: !disabled,
      enable: disabled,
    };
  });

  return {
    kind: "ready",
    subhead: `Operator controls for ${input.workspaceName}.`,
    pagePrimary: "case-ink",
    writeRefusal: readOnly
      ? chromeRefusal({
          kind: "workspace-condition",
          workspaceName: input.workspaceName,
          condition: "Read-only",
        })
      : null,
    secretOnce: input.revealedSecret
      ? {
          ...input.revealedSecret,
          confirmation: "Copy this now. It will not be shown again.",
        }
      : null,
    serviceAccounts: {
      empty: serviceRows.length === 0,
      emptyCopy: "No Service Accounts in this Workspace.",
      rows: serviceRows,
      createAllowed: !readOnly,
    },
    webhookEndpoints: {
      empty: webhookRows.length === 0,
      emptyCopy: "No Webhook Endpoints in this Workspace.",
      rows: webhookRows,
      createAllowed: !readOnly,
    },
    billing: composeBilling(input),
  };
}
