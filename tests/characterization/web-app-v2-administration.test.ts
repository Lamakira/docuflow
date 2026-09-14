import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import { DEFAULT_SCREENSHOT_POLICY, type ScreenshotPolicy } from "@shared/schema";
import {
  addAllowedTimezone,
  analyticsActivityPath,
  analyticsCoveragePath,
  analyticsDevicesPath,
  analyticsExportPath,
  analyticsOverviewPath,
  analyticsRange,
  billingCancelPath,
  billingCheckoutPath,
  billingPaymentMethodPath,
  billingSeatsPath,
  billingSubscriptionPath,
  composeAdministration,
  composeAnalytics,
  composeTrackingPolicyEditor,
  hostedBillingSession,
  workspaceSettingsPath,
  removeAllowedTimezone,
  rotateServiceAccountPath,
  rotateWebhookEndpointPath,
  revokeServiceAccountPath,
  serviceAccountsPath,
  webhookDisablePath,
  webhookEnablePath,
  webhookEndpointsPath,
  administrationWriteRefusal,
  trackingPolicyIssue,
  type AdministrationInput,
  type AnalyticsInput,
  type TrackingPolicyInput,
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

describe("Administration CRM modules and fields (#213)", () => {
  it("rewrites the v1 modules tab into live v2 Administration controls", () => {
    expect(pageSource).toContain('queryKey: ["/api/admin/modules"]');
    expect(pageSource).toContain('apiRequest("POST", "/api/admin/modules"');
    expect(pageSource).toContain('apiRequest("PATCH", `/api/admin/modules/${id}`');
    expect(pageSource).toContain('apiRequest("DELETE", `/api/admin/modules/${id}`');
    expect(pageSource).toContain('apiRequest("POST", `/api/admin/modules/${selectedModule.id}/fields`');
    expect(pageSource).toContain('apiRequest("PATCH", `/api/admin/fields/${id}`');
    expect(pageSource).toContain('apiRequest("DELETE", `/api/admin/fields/${id}`');
    expect(pageSource).toContain('data-testid="v2-administration-crm-modules"');
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

/**
 * Administration deepened with analytics, Tracking Policy, and the remaining
 * billing actions (#212). Seams stay the pure composers over existing
 * `/api/admin/analytics*` and `/api/admin/org-settings`. HTTP stays
 * characterized in admin-analytics.test.ts and notifications-org-settings.test.ts.
 */

const NOW = new Date("2026-09-14T12:00:00.000Z");
const RANGE = analyticsRange("7d", NOW);

function emptyAnalytics(overrides: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    now: NOW,
    workspaceRole: "OWNER",
    ownerName: "Sam Lee",
    range: RANGE,
    overview: null,
    activity: null,
    coverage: null,
    devices: [],
    ...overrides,
  };
}

function policyDraft(overrides: Partial<ScreenshotPolicy> = {}): ScreenshotPolicy {
  return { ...DEFAULT_SCREENSHOT_POLICY, ...overrides };
}

function editorInput(overrides: Partial<TrackingPolicyInput> = {}): TrackingPolicyInput {
  return {
    workspaceName: "Harbor Co",
    workspaceRole: "OWNER",
    ownerName: "Sam Lee",
    condition: null,
    saved: policyDraft(),
    draft: policyDraft(),
    savedTimezones: [],
    draftTimezones: [],
    justSaved: false,
    ...overrides,
  };
}

describe("Administration analytics (#212)", () => {
  it("asks the existing analytics routes for the chosen range", () => {
    expect(RANGE.end).toEqual(NOW);
    expect(RANGE.start).toEqual(new Date("2026-09-07T12:00:00.000Z"));
    expect(analyticsRange("30d", NOW).start).toEqual(new Date("2026-08-15T12:00:00.000Z"));
    expect(analyticsRange("90d", NOW).start).toEqual(new Date("2026-06-16T12:00:00.000Z"));

    const query = "start=2026-09-07T12%3A00%3A00.000Z&end=2026-09-14T12%3A00%3A00.000Z";
    expect(analyticsOverviewPath(RANGE)).toBe(`/api/admin/analytics/overview?${query}`);
    expect(analyticsActivityPath(RANGE)).toBe(`/api/admin/analytics/activity?${query}`);
    expect(analyticsCoveragePath(RANGE)).toBe(`/api/admin/analytics/coverage?${query}`);
    expect(analyticsDevicesPath()).toBe("/api/admin/analytics/devices");
    expect(analyticsExportPath(RANGE)).toBe(`/api/admin/analytics/export?${query}`);
    expect(workspaceSettingsPath()).toBe("/api/admin/org-settings");
  });

  it("refuses a Member from the analytics control by naming the Capability", () => {
    const page = composeAnalytics(emptyAnalytics({ workspaceRole: "MEMBER" }));

    expect(page.kind).toBe("refusal");
    if (page.kind !== "refusal") return;
    expect(page.refusal).toBe(
      "You do not have the Administration Capability. Sam Lee (Owner) can grant it.",
    );
    expect(page.refusal.toLowerCase()).not.toContain("permission denied");
    expect(page.refusal.toLowerCase()).not.toContain("403");
  });

  it("names the refusal when the BFF refuses the read, instead of drawing an empty range", () => {
    const analytics = composeAnalytics(emptyAnalytics({ refused: true }));
    expect(analytics.kind).toBe("refusal");
    if (analytics.kind !== "refusal") return;
    expect(analytics.refusal).toBe(
      "You do not have the Administration Capability. Sam Lee (Owner) can grant it.",
    );

    const policy = composeTrackingPolicyEditor(editorInput({ refused: true }));
    expect(policy.kind).toBe("refusal");
  });

  it("says a failed read failed, rather than reporting an outage as an empty Workspace", () => {
    const analytics = composeAnalytics(emptyAnalytics({ readFailed: true }));
    expect(analytics.kind).toBe("unreadable");
    if (analytics.kind !== "unreadable") return;
    expect(analytics.note.toLowerCase()).toContain("could not be read");
    expect(analytics.note.toLowerCase()).not.toContain("no tracked time");
  });

  it("refuses to edit an unread Tracking Policy so a save cannot overwrite it with defaults", () => {
    const policy = composeTrackingPolicyEditor(editorInput({ saved: null }));
    expect(policy.kind).toBe("unreadable");
    if (policy.kind !== "unreadable") return;
    expect(policy.note.toLowerCase()).toContain("could not be read");
    expect(JSON.stringify(policy)).not.toContain("canSave");
  });

  it("reads overview, activity, coverage, devices, and export for an Owner", () => {
    const page = composeAnalytics(
      emptyAnalytics({
        overview: {
          totalTrackedSeconds: 45000,
          totalIdleSeconds: 5400,
          entriesCount: 12,
          runningNow: 1,
          activeUsersToday: 3,
          screenshotsInWindow: 40,
          lowActivityEntries: 2,
          revokedDevices: 1,
        },
        activity: {
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              totalSeconds: 36000,
              idleSeconds: 3600,
              idleEventCount: 4,
            },
          ],
        },
        coverage: {
          summary: {
            totalTrackedSeconds: 45000,
            totalScreenshots: 40,
            expectedScreenshots: 50,
            coveragePercent: 80,
            totalEntries: 12,
            entriesWithoutScreenshots: 2,
            lowCoverageEntries: 3,
            deletedScreenshots: 1,
          },
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              trackedSeconds: 36000,
              entriesCount: 9,
              entriesWithoutScreenshots: 1,
              screenshotCount: 32,
              expectedScreenshots: 40,
              coveragePct: 80,
            },
          ],
        },
        devices: [
          {
            id: "dev-1",
            userId: "u-1",
            userName: "Ada Byron",
            name: "Ada MacBook",
            os: "macOS",
            clientVersion: "1.4.0",
            lastSeenAt: "2026-09-14T11:30:00.000Z",
            revokedAt: null,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "dev-2",
            userId: "u-2",
            userName: "Grace Hopper",
            name: "Retired ThinkPad",
            os: "Windows",
            clientVersion: null,
            lastSeenAt: null,
            revokedAt: "2026-09-10T00:00:00.000Z",
            createdAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.rangeLabel).toBe("7 SEP – 14 SEP");
    expect(page.overview).toEqual([
      { label: "TRACKED", value: "12.5 h" },
      { label: "IDLE", value: "1.5 h" },
      { label: "TIME ENTRIES", value: "12" },
      { label: "RUNNING NOW", value: "1" },
      { label: "ACTIVE TODAY", value: "3" },
      { label: "EVIDENCE", value: "40" },
      { label: "LOW ACTIVITY", value: "2" },
      { label: "REVOKED DEVICES", value: "1" },
    ]);
    expect(page.activity.rows).toEqual([
      {
        userId: "u-1",
        who: "Ada Byron",
        tracked: "10.0 h",
        idle: "1.0 h",
        idleEvents: "4",
      },
    ]);
    expect(page.activity.footnote).toBe(
      "Recorded totals with provenance. DocuFlow does not score or rank Members.",
    );
    expect(page.coverage.summary).toEqual([
      { label: "COVERAGE", value: "80%" },
      { label: "EVIDENCE", value: "40 of 50" },
      { label: "ENTRIES WITHOUT EVIDENCE", value: "2" },
      { label: "TOMBSTONED", value: "1" },
    ]);
    expect(page.coverage.rows).toEqual([
      {
        userId: "u-1",
        who: "Ada Byron",
        tracked: "10.0 h",
        entries: "9",
        evidence: "32 of 40",
        coverage: "80%",
      },
    ]);
    expect(page.devices.rows).toEqual([
      {
        id: "dev-1",
        name: "Ada MacBook",
        who: "Ada Byron",
        platform: "macOS · 1.4.0",
        lastSeen: "30m ago",
        status: "ACTIVE",
      },
      {
        id: "dev-2",
        name: "Retired ThinkPad",
        who: "Grace Hopper",
        platform: "Windows",
        lastSeen: "Never",
        status: "REVOKED",
      },
    ]);
    expect(page.export).toEqual({
      href: analyticsExportPath(RANGE),
      label: "Export CSV",
      filename: "docuflow-export-2026-09-07.csv",
    });
  });

  it("keeps empty analytics honest and never shows sample names", () => {
    const page = composeAnalytics(emptyAnalytics());
    const blob = JSON.stringify(page);

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.overview).toEqual([]);
    expect(page.activity.empty).toBe(true);
    expect(page.activity.rows).toEqual([]);
    expect(page.activity.emptyCopy.toLowerCase()).toContain("no tracked time");
    expect(page.coverage.empty).toBe(true);
    expect(page.coverage.summary).toEqual([]);
    expect(page.coverage.emptyCopy.toLowerCase()).toContain("evidence");
    expect(page.devices.empty).toBe(true);
    expect(page.devices.emptyCopy.toLowerCase()).toContain("device");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("reports a missing coverage percentage as unknown, never as zero", () => {
    const page = composeAnalytics(
      emptyAnalytics({
        coverage: {
          summary: {
            totalTrackedSeconds: 0,
            totalScreenshots: 0,
            expectedScreenshots: 0,
            coveragePercent: null,
            totalEntries: 0,
            entriesWithoutScreenshots: 0,
            lowCoverageEntries: 0,
            deletedScreenshots: 0,
          },
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              trackedSeconds: 0,
              entriesCount: 0,
              entriesWithoutScreenshots: 0,
              screenshotCount: 0,
              expectedScreenshots: 0,
              coveragePct: null,
            },
          ],
        },
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.coverage.summary[0]).toEqual({ label: "COVERAGE", value: "—" });
    expect(page.coverage.rows[0].coverage).toBe("—");
  });

  it("reports recorded Activity Evidence totals, never a score or a Member ranking", () => {
    const page = composeAnalytics(
      emptyAnalytics({
        activity: {
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              totalSeconds: 36000,
              idleSeconds: 18000,
              idleEventCount: 4,
            },
          ],
        },
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    // CONTEXT.md Activity Evidence: no productivity scores or member rankings.
    expect(JSON.stringify(page.activity.rows)).not.toContain("50%");
    expect(Object.keys(page.activity.rows[0])).toEqual([
      "userId",
      "who",
      "tracked",
      "idle",
      "idleEvents",
    ]);
    expect(pageSource).not.toMatch(/IDLE SHARE|idleShare|score|ranking/i);
  });

  it("does not decorate analytics with animated charts or counting figures", () => {
    expect(pageSource).not.toMatch(/recharts|chart\.js|ResponsiveContainer/i);
    expect(rule(".df-analytics-figure")).toMatch(/animation:\s*none/);
    expect(rule(".df-analytics-figure")).toMatch(/transition:\s*none/);
  });
});

describe("Tracking Policy editing (#212)", () => {
  it("mirrors the server bounds before a save is attempted", () => {
    expect(trackingPolicyIssue(policyDraft())).toBeNull();
    expect(trackingPolicyIssue(policyDraft({ captureIntervalMinMin: 1 }))).toBe(
      "Minimum capture interval must be at least 3 minutes.",
    );
    expect(
      trackingPolicyIssue(policyDraft({ captureIntervalMinMin: 3, captureIntervalMaxMin: 20 })),
    ).toBe("Maximum capture interval cannot exceed 15 minutes.");
    expect(
      trackingPolicyIssue(policyDraft({ captureIntervalMinMin: 10, captureIntervalMaxMin: 5 })),
    ).toBe("Minimum capture interval cannot exceed the maximum.");
    expect(trackingPolicyIssue(policyDraft({ idleTimeoutMinutes: 90 }))).toBe(
      "Idle timeout must be between 1 and 60 minutes.",
    );
    expect(trackingPolicyIssue(policyDraft({ idleCountdownSeconds: 5 }))).toBe(
      "Idle countdown must be between 15 and 120 seconds.",
    );
  });

  it("refuses a Member and names the Workspace condition for a read-only Workspace", () => {
    const member = composeTrackingPolicyEditor(editorInput({ workspaceRole: "MEMBER" }));
    expect(member.kind).toBe("refusal");
    if (member.kind !== "refusal") return;
    expect(member.refusal).toBe(
      "You do not have the Administration Capability. Sam Lee (Owner) can grant it.",
    );

    const readOnly = composeTrackingPolicyEditor(editorInput({ condition: "Read-only" }));
    expect(readOnly.kind).toBe("ready");
    if (readOnly.kind !== "ready") return;
    expect(readOnly.editable).toBe(false);
    expect(readOnly.writeRefusal).toBe(
      "Harbor Co is read-only. Viewing, export, and recovery stay available.",
    );
    expect(readOnly.canSave).toBe(false);
  });

  it("only offers a save once the draft differs and stays valid", () => {
    const clean = composeTrackingPolicyEditor(editorInput());
    expect(clean.kind).toBe("ready");
    if (clean.kind !== "ready") return;
    expect(clean.dirty).toBe(false);
    expect(clean.canSave).toBe(false);
    expect(clean.issue).toBeNull();
    expect(clean.savedNote).toBeNull();

    const dirty = composeTrackingPolicyEditor(
      editorInput({ draft: policyDraft({ captureIntervalMaxMin: 9 }) }),
    );
    expect(dirty.kind).toBe("ready");
    if (dirty.kind !== "ready") return;
    expect(dirty.dirty).toBe(true);
    expect(dirty.canSave).toBe(true);

    const invalid = composeTrackingPolicyEditor(
      editorInput({ draft: policyDraft({ idleTimeoutMinutes: 0 }) }),
    );
    expect(invalid.kind).toBe("ready");
    if (invalid.kind !== "ready") return;
    expect(invalid.dirty).toBe(true);
    expect(invalid.canSave).toBe(false);
    expect(invalid.issue).toBe("Idle timeout must be between 1 and 60 minutes.");
  });

  it("signs off a saved policy without celebrating it", () => {
    const page = composeTrackingPolicyEditor(editorInput({ justSaved: true }));
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.savedNote).toBe("Policy saved. Devices apply it on their next heartbeat.");
    expect(page.savedNote?.toLowerCase()).not.toMatch(/congratulations|nice work|🎉/);
  });

  it("owns the Screencasts timezone list and validates every entry", () => {
    expect(addAllowedTimezone([], "Europe/Paris")).toEqual({
      ok: true,
      timezones: ["Europe/Paris"],
    });
    expect(addAllowedTimezone(["Europe/Paris"], "  America/New_York  ")).toEqual({
      ok: true,
      timezones: ["Europe/Paris", "America/New_York"],
    });
    expect(addAllowedTimezone(["Europe/Paris"], "Europe/Paris")).toEqual({
      ok: false,
      reason: '"Europe/Paris" is already in the list.',
    });
    expect(addAllowedTimezone([], "Nowhere/Nothing")).toEqual({
      ok: false,
      reason: '"Nowhere/Nothing" is not a valid IANA timezone.',
    });
    expect(addAllowedTimezone([], "   ")).toEqual({
      ok: false,
      reason: "Enter an IANA timezone, for example Europe/Paris.",
    });
    expect(removeAllowedTimezone(["Europe/Paris", "America/New_York"], "Europe/Paris")).toEqual([
      "America/New_York",
    ]);

    const page = composeTrackingPolicyEditor(
      editorInput({ savedTimezones: [], draftTimezones: ["Europe/Paris"] }),
    );
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.timezones.rows).toEqual(["Europe/Paris"]);
    expect(page.timezones.empty).toBe(false);
    expect(page.timezones.dirty).toBe(true);

    const none = composeTrackingPolicyEditor(editorInput());
    expect(none.kind).toBe("ready");
    if (none.kind !== "ready") return;
    expect(none.timezones.empty).toBe(true);
    expect(none.timezones.emptyCopy.toLowerCase()).toContain("browser timezone");
  });

  it("leaves Activity displaying the policy rather than rebuilding it", () => {
    const activitySource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Activity.tsx"),
      "utf8",
    );
    expect(activitySource).toContain("trackingPolicyPath");
    expect(activitySource).toContain("policyLines");
    expect(activitySource).not.toContain("org-settings");
    expect(pageSource).toContain("composeTrackingPolicyEditor");
  });
});

describe("Administration controls (#212)", () => {
  it("uses the shadcn checkbox rather than a bare input, and labels every one", () => {
    expect(pageSource).toContain('from "@/components/ui/checkbox"');
    expect(pageSource).not.toContain('type="checkbox"');
    // Radix renders a button, which a <label> cannot implicitly label.
    expect(pageSource).toContain("htmlFor={id}");
    expect(rule(".df-v2 .df-checkbox")).toMatch(/border-radius/);
    expect(rule('.df-v2 .df-checkbox[data-state="checked"]')).toMatch(/var\(--df-case-ink\)/);
    // The tick must not inherit the ink it sits on.
    expect(rule(".df-v2 .df-checkbox")).toMatch(/color:\s*var\(--df-card-white\)/);
    // shadcn ships Tailwind state classes at equal weight; ours must outrank
    // them so the control never depends on stylesheet order.
    expect(css).toContain('.df-v2 .df-checkbox[data-state="checked"]');
  });

  it("waits with the destination's real geometry, not an empty box", () => {
    expect(pageSource).toContain('from "@/components/ui/skeleton"');
    // The old placeholder was a bare card with a hardcoded height.
    expect(pageSource).not.toContain("minHeight: 280");
    // Section titles are known before any fetch, so the wait states them.
    expect(pageSource).toContain('<SkeletonSection title="Analytics"');
    expect(pageSource).toContain('<SkeletonSection title="Billing"');
    // The wait reuses the real bands and rows, so nothing moves on arrival.
    expect(pageSource).toContain('className="df-figure-band"');
    expect(pageSource).toContain('className="df-register-row"');
    expect(pageSource).toContain('aria-busy="true"');
    expect(pageSource).toContain('role="status"');
  });

  it("breathes on opacity only and stops entirely under reduced motion", () => {
    const recipe = motionForSurface("skeleton");
    expect(recipe.movement).toBe("none");
    expect(recipe.enterExit).toBe("instant");
    expect(recipe.keepOpacity).toBe(true);

    expect(rule(".df-v2 .df-skeleton")).toMatch(/animation:\s*df-skeleton-breathe/);
    // A breathe that moved anything would fight the geometry it is holding.
    expect(css).toMatch(/@keyframes df-skeleton-breathe[^}]*\{[^}]*opacity/);
    expect(rule(".df-v2 .df-skeleton")).not.toMatch(/transform/);
    expect(reducedMotionCss()).toMatch(
      /\.df-v2 \.df-skeleton[^{]*\{[^}]*animation:\s*none/,
    );
  });

  it("uses the shadcn select for the range, not a native one", () => {
    expect(pageSource).toContain('from "@/components/ui/select"');
    expect(pageSource).not.toContain("<select");
    expect(pageSource).not.toContain("<option");
    // Radix portals the panel to document.body, outside `.df-v2`, so it must
    // carry the class itself or every --df-* token stops resolving.
    expect(pageSource).toContain('className="df-v2 df-select-content"');
    expect(rule(".df-v2.df-select-content")).toMatch(/var\(--df-card-white\)/);
    // shadcn's own `h-9 w-full border-input` must lose to the chip.
    expect(rule(".df-v2 .df-select-trigger")).toMatch(/width:\s*auto/);
    expect(rule(".df-v2 .df-select-item\[data-highlighted\]")).toMatch(/var\(--df-hover\)/);
  });

  it("gives a field and the button beside it one shared control height", () => {
    expect(css).toMatch(/--df-control-h:\s*\d+px/);
    const shared = css.match(/([^}]*)\{\s*height:\s*var\(--df-control-h\);\s*\}/);
    expect(shared).not.toBeNull();
    const selectors = shared![1];
    for (const control of [
      ".df-toolbar .df-ghost-btn",
      ".df-form-actions .df-ink-btn",
      ".df-inline-form .df-ghost-btn",
    ]) {
      expect(selectors).toContain(control);
    }
  });

  it("scrolls the chrome without drawing a scrollbar", () => {
    expect(rule(".df-main,\n.df-rail-body")).toMatch(/scrollbar-width:\s*none/);
    expect(css).toMatch(/\.df-main::-webkit-scrollbar[^{]*\{[^}]*display:\s*none/);
  });
});

describe("Tracking Policy save motion (#212)", () => {
  it("treats the save as occasional state indication and keeps reduced motion on opacity", () => {
    const recipe = motionForSurface("tracking-policy-save");
    expect(recipe.enterExit).toBe("standard");
    expect(recipe.keepOpacity).toBe(true);

    const reduced = motionForSurface("tracking-policy-save", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-policy-saved[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-policy-saved[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule(".df-policy-form input")).toMatch(/animation:\s*none/);
    expect(reducedMotionCss()).toMatch(
      /\.df-policy-saved\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
    );
  });
});

describe("Administration billing remainder (#212)", () => {
  it("keeps a seeded or legacy Workspace out of Checkout", () => {
    const legacy = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "legacy",
          billingState: "Active",
          purchasedSeatCapacity: 25,
          consumedSeatCount: 4,
          trialEndsAt: null,
          periodEndsAt: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
        },
      }),
    );

    expect(legacy.kind).toBe("ready");
    if (legacy.kind !== "ready") return;
    expect(legacy.billing.plan).toBe("Legacy");
    expect(legacy.billing.actions.map((action) => action.id)).toEqual(["cancel"]);
    expect(legacy.billing.actions.map((action) => action.id)).not.toContain("checkout");
    expect(legacy.billing.actions.map((action) => action.id)).not.toContain("seats");
  });

  it("reads the subscription as discrete facts, including the term the BFF already returns", () => {
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
    expect(trial.billing.figures).toEqual([
      { label: "PLAN", value: "Trial" },
      { label: "CONDITION", value: "Trial" },
      { label: "BILLABLE SEATS", value: "1 of 1" },
      { label: "TRIAL ENDS", value: "20 SEP 2026" },
    ]);

    const cancelling = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "pro",
          billingState: "Active",
          purchasedSeatCapacity: 8,
          consumedSeatCount: 3,
          trialEndsAt: null,
          periodEndsAt: "2026-10-01T00:00:00.000Z",
          cancelAtPeriodEnd: true,
          stripeCustomerId: "cus_123",
        },
      }),
    );
    expect(cancelling.kind).toBe("ready");
    if (cancelling.kind !== "ready") return;
    expect(cancelling.billing.figures[3]).toEqual({
      label: "ACCESS ENDS",
      value: "1 OCT 2026",
    });

    const renewing = composeAdministration(
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
    expect(renewing.kind).toBe("ready");
    if (renewing.kind !== "ready") return;
    expect(renewing.billing.figures[3]).toEqual({ label: "RENEWS", value: "1 OCT 2026" });

    const none = composeAdministration(emptyAdmin());
    expect(none.kind).toBe("ready");
    if (none.kind !== "ready") return;
    expect(none.billing.available).toBe(false);
    expect(none.billing.figures).toEqual([]);
  });

  it("names the refusal when Checkout is refused for a seeded Workspace", () => {
    expect(
      administrationWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Checkout is not available for this Workspace",
      }),
    ).toBe("Checkout is not available for this Workspace");
  });
});
