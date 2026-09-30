import { storage } from "../../storage";
import { canManageAdministration } from "../../workspaceRole";

/**
 * Project Assignment (#310). Owners and Administrators reach every Project.
 * A Member reaches a Project they belong to, one they are assigned while it
 * has no Members, or an Opportunity they own. Callers answer anyone else the
 * way they answer a Project that is not there.
 */
export async function canAccessProject(userId: string, projectId: string): Promise<boolean> {
  if (await canManageAdministration()) return true;
  return storage.isProjectVisibleTo(projectId, userId);
}

/** `crmProjectId` is the CRM row. A missing row is not reachable. */
export async function canAccessCrmProject(userId: string, crmProjectId: string): Promise<boolean> {
  const crmProject = await storage.getCrmProject(crmProjectId);
  if (!crmProject) return false;
  return canAccessProject(userId, crmProject.projectId);
}

/** Unset for Owners and Administrators, so a list holds every Project. */
export async function visibleProjectScope(userId: string): Promise<{ visibleToUserId?: string }> {
  if (await canManageAdministration()) return {};
  return { visibleToUserId: userId };
}
