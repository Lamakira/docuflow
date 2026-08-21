/**
 * DocuFlow-owned public `/api/v1` rate-limit defaults (#126, ADR-0011).
 * Billing is still a shell: when the Plan Registry exists it substitutes
 * these values. This phase does not invent entitlements.
 */
export const PUBLIC_API_RATE_LIMITS = {
  serviceAccountRequestsPerMinute: 60,
  workspaceRequestsPerMinute: 120,
} as const;
