export type { BillingPersistence } from "./persistence";

export const BILLING_TABLES = [] as const;

export const billingModule = {
  id: "billing",
  name: "Billing",
  tables: BILLING_TABLES,
  persistence: "BillingPersistence",
} as const;
