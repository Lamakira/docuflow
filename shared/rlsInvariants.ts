/**
 * Tables that must stay outside row-level security (#328, migration 0041).
 *
 * `jobs` and `dead_letters` are a queue the Worker claims across Workspaces and
 * carry a nullable `workspace_id`, so a `workspace_isolation` policy makes every
 * enqueue from a Workspace-scoped request fail. Migration 0041 turned RLS off on
 * both, yet on 2026-10-21 production had it back on. The publish-time invariants
 * step (`scripts/lib/rlsInvariants.ts`) and the boot check
 * (`server/rlsInvariantsCheck.ts`) both read this one list.
 */
export const RLS_EXEMPT_TABLES: readonly string[] = ["jobs", "dead_letters"];

/** The policy name migration 0041 drops from each exempt table. */
export const WORKSPACE_ISOLATION_POLICY = "workspace_isolation";
