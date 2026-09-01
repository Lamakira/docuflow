import type { BillingConfig } from "../../config";
import {
  UnconfiguredBillingProvider,
  type BillingProvider,
  type BillingProviderConfig,
} from "./billingProvider";
import { StripeBillingProvider } from "./stripeAdapter";

export function createBillingProvider(config: BillingProviderConfig): BillingProvider {
  if (!config.secretKey) return new UnconfiguredBillingProvider();
  return new StripeBillingProvider(config);
}

export function billingProviderFromAppConfig(billing: BillingConfig): BillingProvider {
  return createBillingProvider({
    secretKey: billing.secretKey,
    webhookSecret: billing.webhookSecret,
    priceIds: billing.pricePro ? { pro: billing.pricePro } : {},
  });
}
