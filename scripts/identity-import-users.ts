/**
 * identity-import-users.ts — classify remaining Users for the IdentityProvider
 * (#108, #161, ADR-0007).
 *
 *   npm run identity:import:users -- --dry-run   # classify only, no provider call
 *   npm run identity:import:users                # same classification; hashes are gone
 *
 * Hashes are no longer on `users`, so nobody is imported by digest. Unlinked
 * Users are printed for a provider-side password-set invite. A User already
 * carrying a subject id is skipped.
 */

import { isEntryPoint } from "./lib/entrypoint";
import type {
  ImportPlanEntry,
  UserImportReport,
} from "../server/modules/identity/userImport";

/** Both commands name the same list the same way; the operator reads one heading. */
const INVITE_HEADING = "Password-set invite (no digest on the User, not imported):";

function inviteBlock(emails: string[]): string[] {
  if (emails.length === 0) return [];
  return ["", INVITE_HEADING, ...emails.map((email) => `  ${email}`)];
}

export function formatPlan(plan: ImportPlanEntry[]): string {
  const counts = {
    "already-linked": plan.filter((entry) => entry.action === "already-linked").length,
    "password-set-invite": plan.filter((entry) => entry.action === "password-set-invite").length,
  };
  const lines = [
    `Users: ${plan.length}`,
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
    `already linked:       ${report.counts.alreadyLinked}`,
    `password-set invite:  ${report.counts.passwordSetInvite}`,
  ];
  lines.push(...inviteBlock(report.passwordSetInvites));
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
  console.log(`verifier: ${report.remainingToImport} importable Users remain unlinked`);
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
