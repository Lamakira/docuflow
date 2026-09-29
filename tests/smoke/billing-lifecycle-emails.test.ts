import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type {
  ProviderInvoice,
  ProviderSubscription,
} from "../../server/modules/billing/billingProvider";
import { createUnlinkedUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { FakeBillingProvider } from "../fakes/billingProvider";
import { emailsTo, resetEmails } from "../fakes/resend";

/**
 * Lifecycle emails (#298). Each trigger writes the Owner's in-app Notification
 * and a billing email Job in the transaction that causes it; the Worker sends
 * the email. Seam: the trigger's own interface, then the Worker, then the
 * Owner's mailbox (the Resend fake) and Notifications.
 */

const TRIAL_STARTS = new Date("2026-10-01T09:00:00.000Z");

/** Runs every billing Job the Worker would, until none is due. */
async function runBillingJobs(provider = new FakeBillingProvider()): Promise<void> {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  const { createJobRunner } = await import("../../server/worker");
  const billing = await import("../../server/modules/billing");
  const runner = createJobRunner({
    role: "worker",
    jobs: createJobsPort({
      db,
      types: {
        [billing.BILLING_EMAIL_JOB]: billing.BILLING_EMAIL_JOB_TYPE,
        [billing.BILLING_EXPIRE_TRIAL_JOB]: billing.BILLING_EXPIRE_TRIAL_JOB_TYPE,
        [billing.BILLING_PROJECT_JOB]: billing.BILLING_PROJECT_JOB_TYPE,
      },
    }),
    handlers: {
      [billing.BILLING_EMAIL_JOB]: billing.handleBillingEmailJob,
      [billing.BILLING_EXPIRE_TRIAL_JOB]: billing.handleExpireTrialJob,
      [billing.BILLING_PROJECT_JOB]: (job) => billing.handleProjectBillingJob(job, provider),
    },
    claimerId: "billing-lifecycle-test",
  });
  while (await runner.runOne()) {
    // drain
  }
}

async function billingStateOf(workspaceId: string) {
  const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
  const { getBillingProjection } = await import("../../server/modules/billing");
  const pin = await runWithWorkspaceContext({ workspaceId }, () => getBillingProjection());
  return pin.billingState;
}

async function notificationsOf(userId: string) {
  const { storage } = await import("../../server/storage");
  return storage.getUserNotifications(userId);
}

async function tickTrialScheduler(): Promise<void> {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  const { createTrialLifecycleScheduler } = await import("../../server/scheduler");
  const { BILLING_EXPIRE_TRIAL_JOB, BILLING_EXPIRE_TRIAL_JOB_TYPE } = await import(
    "../../server/modules/billing"
  );
  const jobs = createJobsPort({
    db,
    types: { [BILLING_EXPIRE_TRIAL_JOB]: BILLING_EXPIRE_TRIAL_JOB_TYPE },
  });
  await createTrialLifecycleScheduler({ role: "worker", jobs, holderId: "trial-test" }).tick();
}

/** A Workspace whose Trial started at TRIAL_STARTS, with its Welcome already sent. */
async function trialWorkspace(name = "Keystone") {
  const { createWorkspace } = await import("../../server/modules/workspace/firstWorkspace");
  const owner = await createUnlinkedUser({ firstName: "Ana" });
  const created = await createWorkspace(owner.id, { name });
  await runBillingJobs();
  resetEmails();
  return { owner, workspaceId: created.workspaceId };
}

const SUBSCRIPTION_ID = "sub_fake_1";

const CURRENT_SUBSCRIPTION: ProviderSubscription = {
  providerCustomerId: "cus_fake_1",
  providerSubscriptionId: SUBSCRIPTION_ID,
  planKey: "growth",
  interval: "monthly",
  seatQuantity: 3,
  currentPeriodEnd: new Date("2026-11-01T09:00:00.000Z"),
  cancelAtPeriodEnd: false,
  collectionState: "Current",
};

/** A Workspace that left its Trial through Checkout and pays for Growth. */
async function paidWorkspace() {
  const { db } = await import("../../server/db");
  const { workspaceBilling } = await import("../../shared/schema");
  const trial = await trialWorkspace();
  await db
    .update(workspaceBilling)
    .set({
      planKey: "growth",
      billingState: "Active",
      purchasedSeatCapacity: 3,
      stripeCustomerId: CURRENT_SUBSCRIPTION.providerCustomerId,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      billingInterval: "monthly",
      trialEndsAt: null,
      periodEndsAt: CURRENT_SUBSCRIPTION.currentPeriodEnd,
    })
    .where(eq(workspaceBilling.workspaceId, trial.workspaceId));
  return trial;
}

async function joinWorkspace(
  userId: string,
  workspaceId: string,
  slug: "administrator" | "member"
): Promise<void> {
  const { db } = await import("../../server/db");
  const { memberships, workspaceRoles } = await import("../../shared/schema");
  const [role] = await db
    .select({ id: workspaceRoles.id })
    .from(workspaceRoles)
    .where(and(eq(workspaceRoles.workspaceId, workspaceId), eq(workspaceRoles.slug, slug)));
  await db.insert(memberships).values({ workspaceId, userId, workspaceRoleId: role.id });
}

async function deliverWebhook(
  provider: FakeBillingProvider,
  event: { providerEventId: string; type: string; objectId: string; providerSubscriptionId?: string }
): Promise<void> {
  const { createBillingJobsPort, ingestBillingWebhook } = await import("../../server/modules/billing");
  await ingestBillingWebhook({
    provider,
    jobs: createBillingJobsPort(),
    payload: JSON.stringify(event),
    signature: "signed",
  });
  await runBillingJobs(provider);
}

describe("Welcome", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TRIAL_STARTS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the new Workspace's Owner one Welcome email with the Trial's end date", async () => {
    const { createWorkspace } = await import("../../server/modules/workspace/firstWorkspace");
    const owner = await createUnlinkedUser({ firstName: "Ana" });

    await createWorkspace(owner.id, { name: "Keystone" });
    await runBillingJobs();

    const mail = emailsTo(owner.email);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("DocuFlow — Your Trial of Keystone has started");
    expect(mail[0].html).toContain("14-day Trial");
    expect(mail[0].html).toContain("October 15, 2026");
    expect(mail[0].html).toContain("http://localhost:5000/devices");
    expect(mail[0].html).toContain("http://localhost:5000/people");
    expect(await notificationsOf(owner.id)).toEqual([]);
  });
});

describe("Trial ending", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TRIAL_STARTS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warns the Owner three days before the Trial ends, once however often the scheduler ticks", async () => {
    const { owner } = await trialWorkspace();

    vi.setSystemTime(new Date("2026-10-12T09:00:00.000Z"));
    await tickTrialScheduler();
    await tickTrialScheduler();
    await runBillingJobs();

    const mail = emailsTo(owner.email);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("DocuFlow — Your Trial of Keystone ends in 3 days");
    expect(mail[0].html).toContain("October 15, 2026");
    expect(mail[0].html).toContain("read-only");
    expect(mail[0].html).toContain("http://localhost:5000/administration/billing");
    const notices = await notificationsOf(owner.id);
    expect(notices.map((notice) => notice.type)).toEqual(["billing_trial_ending"]);
  });

  it("warns the Owner again on the Trial's last day", async () => {
    const { owner } = await trialWorkspace();

    vi.setSystemTime(new Date("2026-10-12T09:00:00.000Z"));
    await tickTrialScheduler();
    vi.setSystemTime(new Date("2026-10-14T10:00:00.000Z"));
    await tickTrialScheduler();
    await tickTrialScheduler();
    await runBillingJobs();

    expect(emailsTo(owner.email).map((mail) => mail.subject)).toEqual([
      "DocuFlow — Your Trial of Keystone ends in 3 days",
      "DocuFlow — Last day of your Trial of Keystone",
    ]);
    expect(await notificationsOf(owner.id)).toHaveLength(2);
  });

  it("makes an expired Trial read-only without anyone stepping in, and tells the Owner once", async () => {
    const { owner, workspaceId } = await trialWorkspace();

    vi.setSystemTime(new Date("2026-10-15T09:01:00.000Z"));
    await tickTrialScheduler();
    await runBillingJobs();
    await tickTrialScheduler();
    await runBillingJobs();

    expect(await billingStateOf(workspaceId)).toBe("ReadOnly");
    const mail = emailsTo(owner.email);
    expect(mail.map((sent) => sent.subject)).toEqual(["DocuFlow — Keystone is now read-only"]);
    expect(mail[0].html).toContain("Your Trial of <strong>Keystone</strong> has ended.");
    expect(mail[0].html).toContain("keeps viewing and exporting its data");
    expect(mail[0].html).toContain("http://localhost:5000/administration/billing");
    const notices = await notificationsOf(owner.id);
    expect(notices.map((notice) => notice.type)).toEqual(["billing_read_only"]);
  });
});

describe("Read-only", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TRIAL_STARTS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells the Owner once when Stripe ends the Subscription, however often the webhook repeats", async () => {
    const { owner, workspaceId } = await paidWorkspace();
    const provider = new FakeBillingProvider();
    provider.subscriptions.set(SUBSCRIPTION_ID, { ...CURRENT_SUBSCRIPTION, collectionState: "Canceled" });
    const deleted = {
      providerEventId: "evt_deleted",
      type: "customer.subscription.deleted",
      objectId: SUBSCRIPTION_ID,
    };

    await deliverWebhook(provider, deleted);
    await deliverWebhook(provider, deleted);
    await deliverWebhook(provider, { ...deleted, providerEventId: "evt_deleted_again" });

    expect(await billingStateOf(workspaceId)).toBe("ReadOnly");
    const mail = emailsTo(owner.email);
    expect(mail.map((sent) => sent.subject)).toEqual(["DocuFlow — Keystone is now read-only"]);
    expect(mail[0].html).toContain("The Subscription for <strong>Keystone</strong> has ended.");
    const notices = await notificationsOf(owner.id);
    expect(notices.map((notice) => notice.type)).toEqual(["billing_read_only"]);
  });

  it("says payment could not be collected when Stripe ends a past-due Subscription", async () => {
    const { owner } = await paidWorkspace();
    const provider = new FakeBillingProvider();
    provider.subscriptions.set(SUBSCRIPTION_ID, { ...CURRENT_SUBSCRIPTION, collectionState: "PastDue" });
    await deliverWebhook(provider, {
      providerEventId: "evt_past_due",
      type: "customer.subscription.updated",
      objectId: SUBSCRIPTION_ID,
    });
    provider.subscriptions.set(SUBSCRIPTION_ID, { ...CURRENT_SUBSCRIPTION, collectionState: "Canceled" });
    await deliverWebhook(provider, {
      providerEventId: "evt_deleted",
      type: "customer.subscription.deleted",
      objectId: SUBSCRIPTION_ID,
    });

    const mail = emailsTo(owner.email);
    expect(mail.map((sent) => sent.subject)).toEqual(["DocuFlow — Keystone is now read-only"]);
    expect(mail[0].html).toContain("We could not collect payment for <strong>Keystone</strong>.");
  });

  it("tells the Owner once when a cancellation reaches the end of the period", async () => {
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { applyPeriodEnd, cancelAtPeriodEnd } = await import("../../server/modules/billing");
    const { owner, workspaceId } = await paidWorkspace();
    const afterPeriodEnd = new Date("2026-11-01T09:01:00.000Z");

    await runWithWorkspaceContext({ workspaceId }, async () => {
      await cancelAtPeriodEnd({ kind: "user", id: owner.id });
      await applyPeriodEnd({ kind: "system" }, { now: afterPeriodEnd });
      await applyPeriodEnd({ kind: "system" }, { now: afterPeriodEnd });
    });
    await runBillingJobs();

    const mail = emailsTo(owner.email);
    expect(mail.map((sent) => sent.subject)).toEqual(["DocuFlow — Keystone is now read-only"]);
    expect(mail[0].html).toContain("The Subscription for <strong>Keystone</strong> has ended.");
  });

  it("tells the Owner once when dunning is exhausted, even if the transition is replayed", async () => {
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { exhaustDunning, markPastDue } = await import("../../server/modules/billing");
    const { owner, workspaceId } = await paidWorkspace();

    await runWithWorkspaceContext({ workspaceId }, async () => {
      await markPastDue({ kind: "system" });
      await exhaustDunning({ kind: "system" });
      await exhaustDunning({ kind: "system" });
    });
    await runBillingJobs();

    const mail = emailsTo(owner.email);
    expect(mail.map((sent) => sent.subject)).toEqual(["DocuFlow — Keystone is now read-only"]);
    expect(mail[0].html).toContain("We could not collect payment for <strong>Keystone</strong>.");
    expect(await notificationsOf(owner.id)).toHaveLength(1);
  });
});

describe("Payment failed", () => {
  const INVOICE_ID = "in_fake_1";
  const INVOICE: ProviderInvoice = {
    paid: false,
    nextPaymentAttemptAt: new Date("2026-10-04T09:00:00.000Z"),
  };
  const FAILED = {
    providerEventId: "evt_failed_1",
    type: "invoice.payment_failed",
    objectId: INVOICE_ID,
    providerSubscriptionId: SUBSCRIPTION_ID,
  };

  beforeEach(async () => {
    await resetDb();
    resetEmails();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TRIAL_STARTS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells the Owner once per failed attempt, with the date of the next one", async () => {
    const { owner, workspaceId } = await paidWorkspace();
    const provider = new FakeBillingProvider();
    provider.invoices.set(INVOICE_ID, INVOICE);

    await deliverWebhook(provider, FAILED);
    await deliverWebhook(provider, FAILED);
    provider.invoices.set(INVOICE_ID, {
      ...INVOICE,
      nextPaymentAttemptAt: new Date("2026-10-08T09:00:00.000Z"),
    });
    await deliverWebhook(provider, { ...FAILED, providerEventId: "evt_failed_2" });

    const mail = emailsTo(owner.email);
    expect(mail.map((sent) => sent.subject)).toEqual([
      "DocuFlow — Payment failed for Keystone",
      "DocuFlow — Payment failed for Keystone",
    ]);
    expect(mail[0].html).toContain("We will try again on <strong>October 4, 2026</strong>.");
    expect(mail[1].html).toContain("We will try again on <strong>October 8, 2026</strong>.");
    expect(mail[0].html).toContain("http://localhost:5000/administration/billing");
    const notices = await notificationsOf(owner.id);
    expect(notices.map((notice) => notice.type)).toEqual([
      "billing_payment_failed",
      "billing_payment_failed",
    ]);
    expect(await billingStateOf(workspaceId)).toBe("Active");
  });

  it("says when the failed attempt was the last one", async () => {
    const { owner } = await paidWorkspace();
    const provider = new FakeBillingProvider();
    provider.invoices.set(INVOICE_ID, { ...INVOICE, nextPaymentAttemptAt: null });

    await deliverWebhook(provider, FAILED);

    const [mail] = emailsTo(owner.email);
    expect(mail.html).toContain("That was the last attempt.");
    expect(mail.html).toContain("becomes read-only");
  });

  it("reaches the Owner even after they turn billing email off in their Delivery Preference", async () => {
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { putDeliveryPreference } = await import(
      "../../server/modules/notifications/deliveryPreference"
    );
    const { owner, workspaceId } = await paidWorkspace();
    await runWithWorkspaceContext({ workspaceId }, () =>
      putDeliveryPreference(owner.id, { billing: false })
    );
    const provider = new FakeBillingProvider();
    provider.invoices.set(INVOICE_ID, INVOICE);

    await deliverWebhook(provider, FAILED);

    expect(emailsTo(owner.email)).toHaveLength(1);
  });

  it("sends nothing when the invoice was paid before the Job ran", async () => {
    const { owner } = await paidWorkspace();
    const provider = new FakeBillingProvider();
    provider.invoices.set(INVOICE_ID, { paid: true, nextPaymentAttemptAt: null });

    await deliverWebhook(provider, FAILED);

    expect(emailsTo(owner.email)).toEqual([]);
    expect(await notificationsOf(owner.id)).toEqual([]);
  });

  it("tells only the Owner, not the Workspace's Administrators or Members", async () => {
    const { owner, workspaceId } = await paidWorkspace();
    const administrator = await createUnlinkedUser({ firstName: "Ada" });
    const member = await createUnlinkedUser({ firstName: "Max" });
    await joinWorkspace(administrator.id, workspaceId, "administrator");
    await joinWorkspace(member.id, workspaceId, "member");
    const provider = new FakeBillingProvider();
    provider.invoices.set(INVOICE_ID, INVOICE);

    await deliverWebhook(provider, FAILED);

    expect(emailsTo(owner.email)).toHaveLength(1);
    expect(emailsTo(administrator.email)).toEqual([]);
    expect(emailsTo(member.email)).toEqual([]);
    expect(await notificationsOf(administrator.id)).toEqual([]);
    expect(await notificationsOf(member.id)).toEqual([]);
  });
});
