export type { IdentityPersistence } from "./persistence";

export const IDENTITY_TABLES = [
  "users",
  "sessions",
  "devices",
  "agent_pairing_codes",
  "device_enrollments",
  "desktop_releases",
] as const;

export const identityModule = {
  id: "identity",
  name: "Identity & Access",
  tables: IDENTITY_TABLES,
  persistence: "IdentityPersistence",
} as const;
