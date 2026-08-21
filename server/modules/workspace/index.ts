import type { WorkspacePersistence } from "./persistence";

export type { WorkspacePersistence };
export { workspaceOwnerUserId } from "./owner";

/**
 * `org_settings` is a shared clump: Activity (`getScreenshotPolicy`) and Time
 * (`getAllowedTimezones`) persist into it. ADR-0008 keeps policy with those
 * engines, so the table stays unowned until a later split.
 */
export const WORKSPACE_TABLES = [
  "workspaces",
  "capabilities",
  "workspace_roles",
  "workspace_role_capabilities",
  "memberships",
  "membership_capabilities",
] as const;

export const workspaceModule = {
  id: "workspace",
  name: "Workspace",
  tables: WORKSPACE_TABLES,
  persistence: {} as WorkspacePersistence,
} as const;
