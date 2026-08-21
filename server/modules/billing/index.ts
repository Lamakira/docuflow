import type { BillingPersistence } from "./persistence";
import { PUBLIC_API_RATE_LIMITS } from "./rateLimits";

export type { BillingPersistence };
export { PUBLIC_API_RATE_LIMITS };

export const BILLING_TABLES = [] as const;

export const billingModule = {
  id: "billing",
  name: "Billing",
  tables: BILLING_TABLES,
  persistence: {} as BillingPersistence,
} as const;
