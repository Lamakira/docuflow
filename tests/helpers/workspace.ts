import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { runWithWorkspaceContext } from "../../server/workspaceContext";

/** Run repository work as the seeded Workspace — the only production Membership. */
export function inSeededWorkspace<T>(fn: () => T): T {
  return runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, fn);
}
