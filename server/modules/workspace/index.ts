export type { WorkspacePersistence } from "./persistence";

export const WORKSPACE_TABLES = [
  "workspaces",
  "capabilities",
  "workspace_roles",
  "workspace_role_capabilities",
  "memberships",
  "membership_capabilities",
  "org_settings",
] as const;

export const workspaceModule = {
  id: "workspace",
  name: "Workspace",
  tables: WORKSPACE_TABLES,
  persistence: "WorkspacePersistence",
} as const;
