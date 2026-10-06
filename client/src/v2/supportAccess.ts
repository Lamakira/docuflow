/**
 * Support Access Grants and the Workspace second-factor requirement (#300).
 *
 * Grants are read-only and expire on their own. The Workspace sees them while
 * they are active. A second factor is optional until the Owner requires it;
 * DocuFlow reads that off the session and sends a Member without one to set it
 * up before the Workspace opens.
 */

export const SUPPORT_GRANTS_PATH = "/api/workspace/support-access-grants";
export const TWO_FACTOR_PATH = "/api/workspace/two-factor";
export const PLATFORM_STAFF_PATH = "/api/admin/platform-staff";
export const SUPPORT_GRANT_CREATE_PATH = "/api/admin/support-access-grants";
export const TWO_FACTOR_REQUIRE_PATH = "/api/admin/two-factor";

export function supportGrantRevokePath(id: string): string {
  return `/api/admin/support-access-grants/${id}/revoke`;
}

export type SupportGrantView = {
  id: string;
  platformStaffId: string;
  email: string | null;
  expiresAt: string | Date;
};

export type PlatformStaffOption = {
  id: string;
  email: string | null;
};

export type WorkspaceAssurance = {
  required: boolean;
  secondFactorVerified: boolean;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function grantExpiryLabel(expiresAt: string | Date): string {
  const value = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(value.getTime())) return "";
  return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
}

/** What the Workspace is told while a grant is active. Empty when none is. */
export function supportAccessNotice(grants: SupportGrantView[]): string | null {
  if (grants.length === 0) return null;
  if (grants.length === 1) {
    const who = grants[0].email ?? "Platform Staff";
    const until = grantExpiryLabel(grants[0].expiresAt);
    return until
      ? `${who} has read-only access to this Workspace until ${until}.`
      : `${who} has read-only access to this Workspace.`;
  }
  return `${grants.length} Platform Staff have read-only access to this Workspace.`;
}

/** The Workspace stays closed until the session has a verified second factor. */
export function workspaceNeedsSecondFactor(assurance: WorkspaceAssurance | null | undefined): boolean {
  return assurance?.required === true && assurance.secondFactorVerified !== true;
}

/**
 * A Workspace that requires a second factor closes every page but the account
 * one, where the User sets that factor up.
 */
export function secondFactorBlocksPage(assurance: WorkspaceAssurance | null | undefined, location: string): boolean {
  if (location === "/account" || location.startsWith("/account/")) return false;
  return workspaceNeedsSecondFactor(assurance);
}

export type TwoFactorSetting = {
  required: boolean;
  canChange: boolean;
  action: string;
  note: string;
  /** Why the Owner cannot turn the requirement on yet; null when nothing stops them. */
  blocked: string | null;
};

export function composeTwoFactorSetting(input: {
  required: boolean;
  workspaceRole: string;
  secondFactorVerified: boolean;
}): TwoFactorSetting {
  const owner = input.workspaceRole.trim().toUpperCase() === "OWNER";
  return {
    required: input.required,
    canChange: owner,
    action: input.required ? "Stop requiring a second factor" : "Require a second factor",
    note: input.required
      ? "Everyone in this Workspace must verify a second factor before they can use it."
      : "A second factor is optional. Turning this on sends anyone without one to set it up.",
    blocked:
      owner && !input.required && !input.secondFactorVerified
        ? "Set up a second factor on your own account first. Requiring one now would lock you out of this Workspace too."
        : null,
  };
}

/** 24 hours unless the caller asks for the 7-day maximum. */
export function grantHours(span: "24" | "168"): number | undefined {
  return span === "168" ? 168 : undefined;
}
