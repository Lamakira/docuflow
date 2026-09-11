import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  billingCancelPath,
  billingCheckoutPath,
  billingPaymentMethodPath,
  billingSeatsPath,
  billingSubscriptionPath,
  composeAdministration,
  hostedBillingSession,
  rotateServiceAccountPath,
  rotateWebhookEndpointPath,
  revokeServiceAccountPath,
  serviceAccountsPath,
  webhookDisablePath,
  webhookEnablePath,
  webhookEndpointsPath,
  administrationWriteRefusal,
  type AdministrationInput,
} from "../../client/src/v2/administration";

/**
 * Administration from existing Workspace operator routes (#193).
 * Seams: matchV2Route (flagged app chrome) and composeAdministration over `/api/*`.
 * HTTP `/api/*` stays characterized elsewhere. Do not assert hex.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Administration.tsx"),
  "utf8",
);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function emptyAdmin(overrides: Partial<AdministrationInput> = {}): AdministrationInput {
  return {
    workspaceName: "Harbor Co",
    ownerName: "Sam Lee",
    workspaceRole: "OWNER",
    condition: null,
    serviceAccounts: [],
    webhookEndpoints: [],
    billing: null,
    revealedSecret: null,
    ...overrides,
  };
}

describe("Administration routing (#193)", () => {
  it("shows a live Administration destination on /administration, not a placeholder", () => {
    const match = matchV2Route("/administration");
    expect(match.kind).toBe("administration");
    expect(navIdForPath("/administration")).toBe("administration");
    expect(breadcrumbFor("/administration", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "ADMINISTRATION",
    ]);
    expect(appSource).toContain("V2AdministrationPage");
    expect(appSource).toMatch(/path="\/administration"/);
    expect(appSource).not.toContain('data-testid="v2-placeholder"');
  });

  it("rewrites v1 /admin here under the v2 flag", () => {
    expect(matchV2Route("/admin")).toMatchObject({ kind: "administration", href: "/administration" });
    expect(matchV2Route("/admin/create")).toMatchObject({ kind: "administration", href: "/administration" });
    expect(matchV2Route("/admin/analytics")).toMatchObject({ kind: "administration", href: "/administration" });
    expect(appSource).toMatch(/path="\/admin"/);
  });
});

describe("Administration from operator routes (#193)", () => {
  it("refuses Members with a named Capability, never permission denied", () => {
    const page = composeAdministration(
      emptyAdmin({
        workspaceRole: "MEMBER",
      }),
    );

    expect(page.kind).toBe("refusal");
    if (page.kind !== "refusal") return;
    expect(page.refusal).toBe(
      "You do not have the Administration Capability. Sam Lee (Owner) can grant it.",
    );
    expect(page.refusal.toLowerCase()).not.toContain("permission denied");
  });

  it("empty operator lists use empty geometry and never show sample names", () => {
    const page = composeAdministration(emptyAdmin());
    const blob = JSON.stringify(page);

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.serviceAccounts.empty).toBe(true);
    expect(page.serviceAccounts.rows).toEqual([]);
    expect(page.serviceAccounts.emptyCopy.toLowerCase()).toContain("service account");
    expect(page.webhookEndpoints.empty).toBe(true);
    expect(page.webhookEndpoints.rows).toEqual([]);
    expect(page.webhookEndpoints.emptyCopy.toLowerCase()).toContain("webhook");
    expect(page.secretOnce).toBeNull();
    expect(page.pagePrimary).toBe("case-ink");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("lists Service Accounts and Webhook Endpoints without plaintext secrets", () => {
    const page = composeAdministration(
      emptyAdmin({
        serviceAccounts: [
          {
            id: "sa-1",
            name: "Invoices",
            capabilityIds: ["clients_read", "webhook_endpoints_manage"],
            revokedAt: null,
          },
          {
            id: "sa-2",
            name: "Retired",
            capabilityIds: [],
            revokedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
        webhookEndpoints: [
          {
            id: "wh-1",
            url: "https://hooks.example.test/crm",
            eventTypes: ["client.created"],
            disabledAt: null,
          },
          {
            id: "wh-2",
            url: "https://hooks.example.test/idle",
            eventTypes: ["time_entry.stopped"],
            disabledAt: "2026-09-02T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.serviceAccounts.rows).toEqual([
      {
        id: "sa-1",
        name: "Invoices",
        capabilities: "Read Clients · Manage Webhook Endpoints",
        status: "ACTIVE",
        rotate: true,
        revoke: true,
      },
      {
        id: "sa-2",
        name: "Retired",
        capabilities: "—",
        status: "REVOKED",
        rotate: false,
        revoke: false,
      },
    ]);
    expect(page.webhookEndpoints.rows).toEqual([
      {
        id: "wh-1",
        url: "https://hooks.example.test/crm",
        eventTypes: "client.created",
        status: "ACTIVE",
        rotate: true,
        disable: true,
        enable: false,
      },
      {
        id: "wh-2",
        url: "https://hooks.example.test/idle",
        eventTypes: "time_entry.stopped",
        status: "DISABLED",
        rotate: true,
        disable: false,
        enable: true,
      },
    ]);
    expect(JSON.stringify(page.serviceAccounts)).not.toMatch(/plaintext/i);
    expect(JSON.stringify(page.webhookEndpoints)).not.toMatch(/plaintext/i);
    expect(JSON.stringify(page.serviceAccounts)).not.toContain("dfsa_");
    expect(JSON.stringify(page.webhookEndpoints)).not.toContain("dfwh_");
  });

  it("shows a newly created or rotated secret once, then gone from the list", () => {
    const listed = composeAdministration(
      emptyAdmin({
        serviceAccounts: [
          {
            id: "sa-1",
            name: "Invoices",
            capabilityIds: [],
            revokedAt: null,
            plaintextKey: "dfsa_should_never_list",
          },
        ],
        webhookEndpoints: [
          {
            id: "wh-1",
            url: "https://hooks.example.test/crm",
            eventTypes: ["client.created"],
            disabledAt: null,
            plaintextSecret: "dfwh_should_never_list",
          },
        ],
      }),
    );
    expect(listed.kind).toBe("ready");
    if (listed.kind !== "ready") return;
    expect(listed.secretOnce).toBeNull();
    expect(JSON.stringify(listed.serviceAccounts.rows)).not.toContain("dfsa_");
    expect(JSON.stringify(listed.webhookEndpoints.rows)).not.toContain("dfwh_");

    const shown = composeAdministration(
      emptyAdmin({
        serviceAccounts: [
          {
            id: "sa-1",
            name: "Invoices",
            capabilityIds: [],
            revokedAt: null,
          },
        ],
        revealedSecret: {
          kind: "service-account",
          id: "sa-1",
          label: "Invoices",
          plaintext: "dfsa_shown_once",
        },
      }),
    );
    expect(shown.kind).toBe("ready");
    if (shown.kind !== "ready") return;
    expect(shown.secretOnce).toEqual({
      kind: "service-account",
      id: "sa-1",
      label: "Invoices",
      plaintext: "dfsa_shown_once",
      confirmation: "Copy this now. It will not be shown again.",
    });
    expect(JSON.stringify(shown.serviceAccounts.rows)).not.toContain("dfsa_shown_once");
  });

  it("reads billing projection and offers Plan or seat decisions, never a card form", () => {
    const trial = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "trial",
          billingState: "Trialing",
          purchasedSeatCapacity: 1,
          consumedSeatCount: 1,
          trialEndsAt: "2026-09-20T00:00:00.000Z",
          periodEndsAt: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
        },
      }),
    );
    expect(trial.kind).toBe("ready");
    if (trial.kind !== "ready") return;
    expect(trial.billing.plan).toBe("Trial");
    expect(trial.billing.condition).toBe("Trial");
    expect(trial.billing.seats).toBe("1 of 1 Billable Seats consumed.");
    expect(trial.billing.entitlements).toContain("Writes allowed");
    expect(trial.billing.actions.map((action) => action.id)).toEqual(["checkout"]);
    expect(trial.billing.checkout).toBe("redirect");
    expect(pageSource).not.toMatch(/card number|cvc|cardholder/i);
    expect(pageSource).not.toMatch(/password|clerk/i);

    const active = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "pro",
          billingState: "Active",
          purchasedSeatCapacity: 8,
          consumedSeatCount: 3,
          trialEndsAt: null,
          periodEndsAt: "2026-10-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          stripeCustomerId: "cus_123",
        },
      }),
    );
    expect(active.kind).toBe("ready");
    if (active.kind !== "ready") return;
    expect(active.billing.plan).toBe("Pro");
    expect(active.billing.condition).toBe("Active");
    expect(active.billing.seats).toBe("3 of 8 Billable Seats consumed.");
    expect(active.billing.actions.map((action) => action.id)).toEqual([
      "seats",
      "payment-method",
      "cancel",
    ]);

    expect(hostedBillingSession({ url: "https://checkout.stripe.com/c/cs_test" })).toEqual({
      kind: "redirect",
      url: "https://checkout.stripe.com/c/cs_test",
    });
  });

  it("keeps payment-method recovery in Read-only and names the Workspace condition on writes", () => {
    const page = composeAdministration(
      emptyAdmin({
        condition: "Read-only",
        billing: {
          planKey: "pro",
          billingState: "ReadOnly",
          purchasedSeatCapacity: 8,
          consumedSeatCount: 3,
          trialEndsAt: null,
          periodEndsAt: null,
          cancelAtPeriodEnd: true,
          stripeCustomerId: "cus_123",
        },
      }),
    );
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.billing.condition).toBe("Read-only");
    expect(page.billing.entitlements).toContain("Writes blocked");
    expect(page.billing.actions.map((action) => action.id)).toEqual(["payment-method"]);
    expect(page.serviceAccounts.createAllowed).toBe(false);
    expect(page.webhookEndpoints.createAllowed).toBe(false);
    expect(page.writeRefusal).toBe(
      "Harbor Co is read-only. Viewing, export, and recovery stay available.",
    );

    const expiredTrial = composeAdministration(
      emptyAdmin({
        condition: "Read-only",
        billing: {
          planKey: "trial",
          billingState: "ReadOnly",
          purchasedSeatCapacity: 1,
          consumedSeatCount: 1,
          trialEndsAt: null,
          periodEndsAt: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
        },
      }),
    );
    expect(expiredTrial.kind).toBe("ready");
    if (expiredTrial.kind !== "ready") return;
    expect(expiredTrial.billing.actions.map((action) => action.id)).toEqual(["checkout"]);
    expect(expiredTrial.billing.checkout).toBe("redirect");
  });

  it("asks the BFF for operator routes and does not wire a card form", () => {
    expect(serviceAccountsPath()).toBe("/api/service-accounts");
    expect(revokeServiceAccountPath("sa-1")).toBe("/api/service-accounts/sa-1/revoke");
    expect(rotateServiceAccountPath("sa-1")).toBe("/api/service-accounts/sa-1/rotate");
    expect(webhookEndpointsPath()).toBe("/api/webhook-endpoints");
    expect(webhookDisablePath("wh-1")).toBe("/api/webhook-endpoints/wh-1/disable");
    expect(webhookEnablePath("wh-1")).toBe("/api/webhook-endpoints/wh-1/enable");
    expect(rotateWebhookEndpointPath("wh-1")).toBe("/api/webhook-endpoints/wh-1/rotate");
    expect(billingSubscriptionPath()).toBe("/api/billing/subscription");
    expect(billingCheckoutPath()).toBe("/api/billing/checkout");
    expect(billingSeatsPath()).toBe("/api/billing/seats");
    expect(billingPaymentMethodPath()).toBe("/api/billing/payment-method");
    expect(billingCancelPath()).toBe("/api/billing/cancel-at-period-end");

    expect(
      administrationWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Access denied",
      }),
    ).toBe("You do not have the Administration Capability. Sam Lee (Owner) can grant it.");
    expect(pageSource).toContain("window.location");
    expect(pageSource).toContain("df-project-mobile");
    expect(pageSource).not.toContain("input type=\"password\"");
    expect(pageSource).not.toMatch(/stripe-card|CardElement|cardNumber/i);
  });
});

describe("Administration secret confirmation motion (#193)", () => {
  it("marks the shown-once secret as rare state indication and keeps reduced motion on opacity", () => {
    const open = motionForSurface("secret-once");
    expect(open.enterExit).toBe("standard");
    expect(open.movement).toBe("allowed");

    const reduced = motionForSurface("secret-once", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-secret-once[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-secret-once[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule(".df-admin-form input")).toMatch(/animation:\s*none/);
    expect(rule(".df-admin-billing-figure")).toMatch(/animation:\s*none/);
    expect(reducedMotionCss()).toMatch(
      /\.df-secret-once\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
    );
  });
});

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function reducedMotionCss(): string {
  return [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n");
}
