/**
 * Billing's slice of `IStorage` stays empty: Entitlement APIs live on the
 * billing module, not on `postgresStorage` (#139). This module must not own
 * another module's tables.
 */
export interface BillingPersistence {}
