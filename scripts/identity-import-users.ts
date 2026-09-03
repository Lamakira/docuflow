/**
 * identity-import-users.ts — import existing Users into the IdentityProvider
 * (#108, ADR-0007).
 *
 *   npm run identity:import:users -- --dry-run   # classify only, no provider call
 *   npm run identity:import:users                # import and write the links back
 *
 * The import is by bcrypt hash, so nobody is reset, and it is idempotent: a User
 * already carrying a subject id is skipped, and re-running after a partial run
 * picks up where it stopped. Users with no usable hash — the Replit OIDC
 * placeholder among them — are never imported as password Users; they are
 * printed for a provider-side password-set invite instead.
 *
 * Missing provider credentials stop the run rather than failing every User.
 */

import { isEntryPoint } from "./lib/entrypoint";
import type {
  ImportPlanEntry,
  UserImportReport,
} from "../server/modules/identity/userImport";

/** Both commands name the same list the same way; the operator reads one heading. */
const INVITE_HEADING = "Password-set invite (no usable hash, not imported):";

function inviteBlock(emails: string[]): string[] {
  if (emails.length === 0) return [];
  return ["", INVITE_HEADING, ...emails.map((email) => `  ${email}`)];
}

export function formatPlan(plan: ImportPlanEntry[]): string {
  const counts = {
    import: plan.filter((entry) => entry.action === "import").length,
    "already-linked": plan.filter((entry) => entry.action === "already-linked").length,
    "password-set-invite": plan.filter((entry) => entry.action === "password-set-invite").length,
  };
  const lines = [
    `Users: ${plan.length}`,
    `  to import:            ${counts.import}`,
    `  already linked:       ${counts["already-linked"]}`,
    `  password-set invite:  ${counts["password-set-invite"]}`,
  ];
  lines.push(
    ...inviteBlock(
      plan
        .filter((entry) => entry.action === "password-set-invite")
        .map((entry) => entry.email)
    )
  );
  return lines.join("\n");
}

export function formatReport(report: UserImportReport): string {
  const lines = [
    `imported and linked:  ${report.counts.linked}`,
    `already linked:       ${report.counts.alreadyLinked}`,
    `password-set invite:  ${report.counts.passwordSetInvite}`,
    `failed:               ${report.counts.failed}`,
  ];
  lines.push(...inviteBlock(report.passwordSetInvites));
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
  const { identityProvider, importUsersIntoIdentityProvider, planUserImport } = await import(
    "../server/modules/identity"
  );

  if (dryRun) {
    console.log(formatPlan(await planUserImport(storage)));
    return;
  }

  const report = await importUsersIntoIdentityProvider({
    persistence: storage,
    provider: identityProvider,
  });
  console.log(formatReport(report));

  // The verifier ADR-0017 asks every data-movement script to carry: the run is
  // only done when no User that wants importing is left behind. Password-set
  // invites are an expected leftover and do not fail it.
  if (report.remainingToImport > 0) {
    console.error(
      `VERIFIER FAILED: ${report.remainingToImport} User(s) still have no provider subject id`
    );
    process.exitCode = 1;
    return;
  }
  console.log("verifier: 0 importable Users remain unlinked");
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
