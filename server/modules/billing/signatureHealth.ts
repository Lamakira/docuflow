/**
 * Telling a wrong webhook secret from a forged request (#229).
 *
 * A `STRIPE_WEBHOOK_SECRET` belonging to a different Stripe account than
 * `STRIPE_SECRET_KEY` rejects the signature on every delivery. So does an
 * attacker. The two are indistinguishable from one event, and the Phase 8 run
 * spent half an hour on the wrong one of them — Checkout kept returning
 * perfectly good hosted URLs, because creating a Session and verifying a
 * webhook use different credentials and nothing compared them.
 *
 * Neither credential can be resolved to an account without a network call, and
 * boot must not depend on Stripe being reachable. The distinction is drawn from
 * the shape of the failures instead: an attacker forging events does not stop
 * the real ones arriving, so *some* delivery verifies. A wrong secret rejects
 * every single one. Nothing verified, and rejections piling up, is
 * configuration — and saying so is the whole point.
 *
 * Process-local on purpose. It describes this process's credentials, and a
 * restart with a corrected secret should start the judgement over.
 */

import { logWarn } from "../../logger";

/** Below this, a rejection is just a rejection. */
const MISCONFIGURATION_THRESHOLD = 3;

let everVerified = false;
let consecutiveRejections = 0;
let warned = false;

export type SignatureDiagnosis = {
  everVerified: boolean;
  consecutiveRejections: number;
  /** Every delivery rejected, none ever accepted: the secret, not an attacker. */
  likelyMisconfigured: boolean;
};

export function recordVerifiedSignature(): void {
  everVerified = true;
  consecutiveRejections = 0;
}

export function recordRejectedSignature(): void {
  consecutiveRejections += 1;
}

export function signatureDiagnosis(): SignatureDiagnosis {
  return {
    everVerified,
    consecutiveRejections,
    likelyMisconfigured: !everVerified && consecutiveRejections >= MISCONFIGURATION_THRESHOLD,
  };
}

/**
 * Say it once per process. Repeating it on every delivery would bury the very
 * thing it is trying to make visible.
 */
export function warnIfSecretLooksWrong(): void {
  const diagnosis = signatureDiagnosis();
  if (!diagnosis.likelyMisconfigured || warned) return;
  warned = true;
  logWarn("billing.webhook_secret_mismatch", {
    consecutiveRejections: diagnosis.consecutiveRejections,
    detail:
      "Every Stripe webhook this process has seen failed signature verification and none has ever " +
      "succeeded. That is what a STRIPE_WEBHOOK_SECRET from a different Stripe account than " +
      "STRIPE_SECRET_KEY looks like — check both resolve to the same acct_… before treating these " +
      "as forged requests.",
  });
}

export function resetSignatureHealth(): void {
  everVerified = false;
  consecutiveRejections = 0;
  warned = false;
}
