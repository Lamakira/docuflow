/**
 * Remaining IdentityProvider import classification (#108, #161, ADR-0007).
 *
 * Hashes are gone from `users`. An unlinked User cannot be imported by digest;
 * they are listed for a password-set invite instead. A linked User
 * short-circuits. Membership, Workspace Context, and Device Enrollment are
 * not touched — authorization remains DocuFlow's.
 *
 * Importing a bcrypt digest into the provider still exists on
 * `IdentityProvider.importPasswordUser` for rehearsal of the #108 cutover; this
 * module no longer reads a hash off the User row.
 */

import { type IdentityProvider } from "./identityProvider";

/** The `users` columns an import reads. Never the whole row. */
export type ImportableUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  identityProviderSubjectId: string | null;
};

export interface UserImportPersistence {
  listUsersForIdentityImport(): Promise<ImportableUser[]>;
  linkUserToIdentityProvider(userId: string, providerSubjectId: string): Promise<void>;
}

export type ImportAction = "already-linked" | "password-set-invite";

export type ImportPlanEntry = {
  userId: string;
  email: string;
  action: ImportAction;
};

export type UserImportStatus = "already-linked" | "password-set-invite";

export type UserImportOutcome = {
  userId: string;
  email: string;
  status: UserImportStatus;
  providerSubjectId?: string;
  detail?: string;
};

export type UserImportReport = {
  outcomes: UserImportOutcome[];
  /**
   * Unlinked Users — they get a Clerk password-set invite; a password is never
   * invented for them here.
   */
  passwordSetInvites: string[];
  counts: {
    alreadyLinked: number;
    passwordSetInvite: number;
  };
  /**
   * Users that still want importing by hash. Always zero since #161: there is
   * no digest on the row to import.
   */
  remainingToImport: number;
};

/** What an import would do to this User, decided without reaching the provider. */
export function classifyUserForImport(user: ImportableUser): ImportAction {
  if (user.identityProviderSubjectId) return "already-linked";
  return "password-set-invite";
}

/** The classification for every User, for a dry run and for the report header. */
export async function planUserImport(
  persistence: UserImportPersistence
): Promise<ImportPlanEntry[]> {
  const users = await persistence.listUsersForIdentityImport();
  return users.map((user) => ({
    userId: user.id,
    email: user.email,
    action: classifyUserForImport(user),
  }));
}

export async function importUsersIntoIdentityProvider(deps: {
  persistence: UserImportPersistence;
  provider: IdentityProvider;
}): Promise<UserImportReport> {
  const { persistence } = deps;
  void deps.provider;
  const users = await persistence.listUsersForIdentityImport();
  const outcomes: UserImportOutcome[] = [];
  const passwordSetInvites: string[] = [];

  for (const user of users) {
    const action = classifyUserForImport(user);

    if (action === "already-linked") {
      outcomes.push({
        userId: user.id,
        email: user.email,
        status: "already-linked",
        providerSubjectId: user.identityProviderSubjectId ?? undefined,
      });
      continue;
    }

    passwordSetInvites.push(user.email);
    outcomes.push({ userId: user.id, email: user.email, status: "password-set-invite" });
  }

  return {
    outcomes,
    passwordSetInvites,
    remainingToImport: 0,
    counts: {
      alreadyLinked: outcomes.filter((outcome) => outcome.status === "already-linked").length,
      passwordSetInvite: passwordSetInvites.length,
    },
  };
}
