import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Telling a misconfigured webhook secret from a forged request (#229, Defect C).
 *
 * `STRIPE_WEBHOOK_SECRET` belonging to a different Stripe account than
 * `STRIPE_SECRET_KEY` presents as `invalid signature` on every delivery —
 * exactly what a forged request presents as. The Phase 8 run lost half an hour
 * to that: Checkout returned perfectly good hosted URLs the whole time.
 *
 * Neither key can be resolved to an account without a network call, so the
 * distinction is drawn from the shape of the failures instead. An attacker
 * does not stop the real events arriving; a wrong secret rejects every single
 * one. So: rejections with nothing ever verified, repeated, means
 * configuration — and the process should say so in those words.
 */

describe("webhook signature health", () => {
  beforeEach(async () => {
    const { resetSignatureHealth } = await import("../../server/modules/billing/signatureHealth");
    resetSignatureHealth();
  });

  it("does not cry misconfiguration over one rejected delivery", async () => {
    const { recordRejectedSignature, signatureDiagnosis } = await import(
      "../../server/modules/billing/signatureHealth"
    );

    recordRejectedSignature();

    expect(signatureDiagnosis()).toEqual({
      everVerified: false,
      consecutiveRejections: 1,
      likelyMisconfigured: false,
    });
  });

  it("calls it misconfiguration once every delivery has been rejected and none ever verified", async () => {
    const { recordRejectedSignature, signatureDiagnosis } = await import(
      "../../server/modules/billing/signatureHealth"
    );

    recordRejectedSignature();
    recordRejectedSignature();
    recordRejectedSignature();

    expect(signatureDiagnosis()).toMatchObject({
      everVerified: false,
      consecutiveRejections: 3,
      likelyMisconfigured: true,
    });
  });

  it("stops calling it misconfiguration once a signature has ever verified", async () => {
    const { recordVerifiedSignature, recordRejectedSignature, signatureDiagnosis } = await import(
      "../../server/modules/billing/signatureHealth"
    );

    recordVerifiedSignature();
    recordRejectedSignature();
    recordRejectedSignature();
    recordRejectedSignature();
    recordRejectedSignature();

    // A working secret that later sees rejections is the forged-request case,
    // and must never be reported as a configuration problem.
    expect(signatureDiagnosis()).toMatchObject({
      everVerified: true,
      likelyMisconfigured: false,
    });
  });

  it("clears the rejection streak when a delivery verifies", async () => {
    const { recordVerifiedSignature, recordRejectedSignature, signatureDiagnosis } = await import(
      "../../server/modules/billing/signatureHealth"
    );

    recordRejectedSignature();
    recordRejectedSignature();
    recordVerifiedSignature();

    expect(signatureDiagnosis().consecutiveRejections).toBe(0);
  });
});

describe("webhook ingest diagnosis", () => {
  beforeEach(async () => {
    const { resetSignatureHealth } = await import("../../server/modules/billing/signatureHealth");
    resetSignatureHealth();
  });

  it("names the account mismatch in the log once every delivery has been rejected", async () => {
    const { ingestBillingWebhook, BillingWebhookSignatureError } = await import(
      "../../server/modules/billing"
    );
    const { FakeBillingProvider } = await import("../fakes/billingProvider");

    const provider = new FakeBillingProvider();
    const jobs = { enqueue: async () => ({ created: true }) } as never;
    const lines: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((msg) => {
      lines.push(String(msg));
    });

    try {
      for (let i = 0; i < 3; i += 1) {
        await expect(
          ingestBillingWebhook({ provider, jobs, payload: "{}", signature: "wrong" })
        ).rejects.toBeInstanceOf(BillingWebhookSignatureError);
      }
    } finally {
      warn.mockRestore();
    }

    const warned = lines.filter((line) => line.includes("billing.webhook_secret_mismatch"));
    expect(warned.length).toBeGreaterThan(0);
    expect(warned.join("\n")).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("stays quiet about configuration when a signature has verified before", async () => {
    const { ingestBillingWebhook, BillingWebhookSignatureError } = await import(
      "../../server/modules/billing"
    );
    const { recordVerifiedSignature } = await import("../../server/modules/billing/signatureHealth");
    const { FakeBillingProvider } = await import("../fakes/billingProvider");

    const provider = new FakeBillingProvider();
    const jobs = { enqueue: async () => ({ created: true }) } as never;
    recordVerifiedSignature();
    const lines: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((msg) => {
      lines.push(String(msg));
    });

    try {
      for (let i = 0; i < 4; i += 1) {
        await expect(
          ingestBillingWebhook({ provider, jobs, payload: "{}", signature: "wrong" })
        ).rejects.toBeInstanceOf(BillingWebhookSignatureError);
      }
    } finally {
      warn.mockRestore();
    }

    expect(lines.filter((line) => line.includes("billing.webhook_secret_mismatch"))).toEqual([]);
  });
});
