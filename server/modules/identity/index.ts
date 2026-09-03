import type { IdentityPersistence } from "./persistence";
import { config } from "../../config";
import { identityProviderFromAppConfig } from "./createIdentityProvider";
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
export type {
  IdentityProvider,
  IdentityProviderConfig,
  IdentitySession,
  PasswordImportRequest,
  PasswordSetInvite,
  PasswordSetInviteRequest,
  ProviderIdentity,
} from "./identityProvider";
export {
  IdentityProviderClosedError,
  IdentityProviderError,
  IdentityProviderImportError,
  IdentitySessionError,
  isUsablePasswordHash,
  UnconfiguredIdentityProvider,
} from "./identityProvider";
export { identityProviderFromAppConfig, createIdentityProvider } from "./createIdentityProvider";
export type {
  ImportableUser,
  ImportAction,
  ImportPlanEntry,
  UserImportOutcome,
  UserImportPersistence,
  UserImportReport,
  UserImportStatus,
} from "./userImport";
export {
  classifyUserForImport,
  importUsersIntoIdentityProvider,
  planUserImport,
} from "./userImport";
export type { DualAuthPersistence } from "./dualAuth";
export { bearerToken, isDrainablePath, userIdFromIdentitySession } from "./dualAuth";
export type {
  PasswordSetInviteOutcome,
  PasswordSetInviteReport,
  PasswordSetInviteStatus,
} from "./passwordSetInvites";
export { planPasswordSetInvites, sendPasswordSetInvites } from "./passwordSetInvites";

/** Process-wide IdentityProvider. Missing Clerk credentials fail closed. HTTP still authenticates as today. */
export const identityProvider = identityProviderFromAppConfig(config.identity);

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
