import type { BillingPersistence } from "./persistence";

export type { BillingPersistence };

export const BILLING_TABLES = [] as const;

export const billingModule = {
  id: "billing",
  name: "Billing",
  tables: BILLING_TABLES,
  persistence: {} as BillingPersistence,
} as const;
