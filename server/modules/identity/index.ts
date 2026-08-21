import type { IdentityPersistence } from "./persistence";
import {
  createServiceAccount,
  listServiceAccounts,
  principalContextFromApiKey,
  revokeServiceAccount,
  rotateServiceAccountSecret,
  type ServiceAccountPersistence,
} from "./serviceAccounts";

export type { IdentityPersistence };
export type {
  CreatedServiceAccount,
  PrincipalContext,
  ServiceAccountPersistence,
  ServiceAccountView,
} from "./serviceAccounts";
export {
  canManageServiceAccounts,
  createServiceAccount,
  listServiceAccounts,
  principalContextFromApiKey,
  revokeServiceAccount,
  rotateServiceAccountSecret,
  ServiceAccountNotFoundError,
  UnknownCapabilityError,
} from "./serviceAccounts";

export const IDENTITY_TABLES = [
  "users",
  "sessions",
  "devices",
  "agent_pairing_codes",
  "device_enrollments",
  "desktop_releases",
  "service_accounts",
  "service_account_capabilities",
] as const;

export const identityPersistence: ServiceAccountPersistence = {
  createServiceAccount,
  listServiceAccounts,
  principalContextFromApiKey,
  revokeServiceAccount,
  rotateServiceAccountSecret,
};

export const identityModule = {
  id: "identity",
  name: "Identity & Access",
  tables: IDENTITY_TABLES,
  persistence: identityPersistence,
} as const;
