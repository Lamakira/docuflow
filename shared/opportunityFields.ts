/**
 * What an Opportunity carries besides its name, Client and Stage (#276): an
 * Opportunity Owner (who sold it, apart from the Project Manager a win names),
 * an Expected close date (the due date), a Source, an Estimated value, Notes,
 * and a Lost reason once it is Lost.
 *
 * The Estimated value is money: an integer amount in the currency's minor
 * units with its ISO 4217 code. It is never the Project budget, which is hours.
 */

import { projectHasOpportunity } from "./projectLifecycle";

export const OPPORTUNITY_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "MAD"] as const;
export type OpportunityCurrency = (typeof OPPORTUNITY_CURRENCIES)[number];

export const DEFAULT_OPPORTUNITY_CURRENCY: OpportunityCurrency = "EUR";

/** One billion in a two-decimal currency: well inside a safe integer. */
export const ESTIMATED_VALUE_MINOR_MAX = 100_000_000_000;

export const LOST_REASON_DETAIL_MAX = 2000;

export function isOpportunityCurrency(code: string | null | undefined): code is OpportunityCurrency {
  return (OPPORTUNITY_CURRENCIES as readonly string[]).includes(code ?? "");
}

/** Digits after the decimal point: 2 for EUR, 0 for a currency without minor units. */
export function currencyExponent(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export type OpportunityFieldsState = {
  status: string;
  projectType: string | null;
  isDocumentationOnly: number | null;
  estimatedValueMinor: number | null;
  estimatedValueCurrency: string | null;
  lostReason: string | null;
  lostReasonDetail: string | null;
};

/**
 * Why a write would leave an Opportunity inconsistent, or null. `previous` is
 * the row before the write (null on create), `next` the row as it would be
 * saved, and `changing` which keys the write sends. `requireLostReason` is v2's
 * Mark as lost; v1 moves a row to Lost without a reason.
 */
export function opportunityFieldsIssue(
  previous: OpportunityFieldsState | null,
  next: OpportunityFieldsState,
  changing: { status: boolean; lostReason: boolean; requireLostReason: boolean },
): string | null {
  if ((next.estimatedValueMinor == null) !== (next.estimatedValueCurrency == null)) {
    return "An Estimated value needs both an amount and a currency.";
  }
  const winning =
    changing.status &&
    next.status.startsWith("won") &&
    previous !== null &&
    projectHasOpportunity(previous) &&
    !previous.status.startsWith("won");
  if (winning && next.projectType === "internal") {
    return "Winning creates a Client Project, so its Project type cannot be Internal.";
  }
  if (!projectHasOpportunity(next)) return null;
  const lost = next.status === "lost";
  if (lost && !next.lostReason && changing.requireLostReason) {
    return "Choose a Lost reason to mark this Opportunity Lost.";
  }
  if (!lost && changing.lostReason && (next.lostReason || next.lostReasonDetail)) {
    return "A Lost reason is kept only on a Lost Opportunity.";
  }
  return null;
}
