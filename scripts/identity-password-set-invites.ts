/**
 * identity-password-set-invites.ts — invite OIDC-only Users to set a password at
 * the IdentityProvider (#109, ADR-0007).
 *
 *   npm run identity:invite:password-set -- --dry-run   # list only, no provider call
 *   npm run identity:invite:password-set                # send the invites
 *
 * The list is the leftover the import (#108) names: unlinked Users, who have no
 * digest to carry over (#161). A User who is already linked is never invited.
 * This is not a Workspace Invitation and grants no Membership.
 *
 * Re-running is safe: the port returns an outstanding invite rather than sending
 * a second, so a partial run resumes and nobody is mailed twice.
 *
 * Missing provider credentials stop the run rather than failing every address.
 */

import { isEntryPoint } from "./lib/entrypoint";
import type { PasswordSetInviteReport } from "../server/modules/identity/passwordSetInvites";

export function formatPlan(owed: Array<{ email: string }>): string {
  const lines = [`Password-set invites owed: ${owed.length}`];
  lines.push(...owed.map((entry) => `  ${entry.email}`));
  return lines.join("\n");
}

export function formatReport(report: PasswordSetInviteReport): string {
  const lines = [
    `invited:              ${report.counts.invited}`,
    `already invited:      ${report.counts.alreadyInvited}`,
    `accepted and linked:  ${report.counts.accepted}`,
    `failed:               ${report.counts.failed}`,
  ];
  const failures = report.outcomes.filter((outcome) => outcome.status === "failed");
  if (failures.length > 0) {
    lines.push("", "Failed:");
    lines.push(...failures.map((outcome) => `  ${outcome.email}\t${outcome.detail ?? ""}`));
  }
  return lines.join("\n");
}

async function main(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const { storage } = await import("../server/storage");
  const { identityProvider, planPasswordSetInvites, sendPasswordSetInvites } = await import(
    "../server/modules/identity"
  );

  if (dryRun) {
    console.log(formatPlan(await planPasswordSetInvites(storage)));
    return;
  }

  const report = await sendPasswordSetInvites({
    persistence: storage,
    provider: identityProvider,
  });
  console.log(formatReport(report));

  // The verifier ADR-0017 asks every data-movement script to carry, re-read from
  // the database and the provider rather than tallied in the loop: the run is
  // only done when every OIDC-only User has an invite outstanding.
  if (report.remainingToInvite > 0) {
    console.error(
      `VERIFIER FAILED: ${report.remainingToInvite} OIDC-only User(s) still have no password-set invite`
    );
    process.exitCode = 1;
    return;
  }
  console.log("verifier: 0 OIDC-only Users remain uninvited");
  if (report.counts.failed > 0) process.exitCode = 1;
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { pool } = await import("../server/db");
      await pool.end().catch(() => {});
    });
}
