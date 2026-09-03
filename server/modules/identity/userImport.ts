/**
 * Import existing DocuFlow Users into the IdentityProvider (#108, ADR-0007).
 *
 * By bcrypt hash, so an imported User authenticates with the password they
 * already have and nobody is reset. The provider subject id comes back onto
 * `users.identity_provider_subject_id`; `users.password` stays, and Membership,
 * Workspace Context, and Device Enrollment are not touched here — authorization
 * remains DocuFlow's, and this only adds a link.
 *
 * Idempotent twice over: a linked User short-circuits before the port, and the
 * port itself resolves an already-present email to its existing subject.
 */

import {
  IdentityProviderClosedError,
  isUsablePasswordHash,
  type IdentityProvider,
} from "./identityProvider";

/** The `users` columns an import reads. Never the whole row. */
export type ImportableUser = {
  id: string;
  email: string;
  password: string | null;
  firstName: string | null;
  lastName: string | null;
  identityProviderSubjectId: string | null;
};

export interface UserImportPersistence {
  listUsersForIdentityImport(): Promise<ImportableUser[]>;
  linkUserToIdentityProvider(userId: string, providerSubjectId: string): Promise<void>;
}

export type ImportAction = "import" | "already-linked" | "password-set-invite";

export type ImportPlanEntry = {
  userId: string;
  email: string;
  action: ImportAction;
};

export type UserImportStatus = "linked" | "already-linked" | "password-set-invite" | "failed";

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
   * Emails with no usable password hash — OIDC-only Users, and anything else the
   * hash check rejects. They get a Clerk password-set invite; a password is never
   * invented for them here.
   */
  passwordSetInvites: string[];
  counts: {
    linked: number;
    alreadyLinked: number;
    passwordSetInvite: number;
    failed: number;
  };
  /**
   * The verifier ADR-0017 asks every data-movement script to carry, re-read from
   * the database rather than tallied in the loop: Users that still want importing
   * once the run is over. Zero is done. Password-set invites are not counted —
   * they are an expected leftover, not an unfinished one.
   */
  remainingToImport: number;
};

/** What an import would do to this User, decided without reaching the provider. */
export function classifyUserForImport(user: ImportableUser): ImportAction {
  if (user.identityProviderSubjectId) return "already-linked";
  if (!isUsablePasswordHash(user.password)) return "password-set-invite";
  return "import";
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
  const { persistence, provider } = deps;
  const users = await persistence.listUsersForIdentityImport();
  const outcomes: UserImportOutcome[] = [];
  const passwordSetInvites: string[] = [];

  // Sequential on purpose: the provider is rate-limited, and a partial run has to
  // be resumable by re-running rather than by reasoning about interleaved writes.
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

    if (action === "password-set-invite") {
      passwordSetInvites.push(user.email);
      outcomes.push({ userId: user.id, email: user.email, status: "password-set-invite" });
      continue;
    }

    try {
      const identity = await provider.importPasswordUser({
        email: user.email,
        passwordHash: user.password as string,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      await persistence.linkUserToIdentityProvider(user.id, identity.providerSubjectId);
      outcomes.push({
        userId: user.id,
        email: user.email,
        status: "linked",
        providerSubjectId: identity.providerSubjectId,
      });
    } catch (error) {
      // Missing credentials fail every User identically, so surface it once and
      // stop rather than writing a report that says the whole directory failed.
      if (error instanceof IdentityProviderClosedError) throw error;
      outcomes.push({
        userId: user.id,
        email: user.email,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const remaining = await planUserImport(persistence);

  return {
    outcomes,
    passwordSetInvites,
    remainingToImport: remaining.filter((entry) => entry.action === "import").length,
    counts: {
      linked: outcomes.filter((outcome) => outcome.status === "linked").length,
      alreadyLinked: outcomes.filter((outcome) => outcome.status === "already-linked").length,
      passwordSetInvite: passwordSetInvites.length,
      failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    },
  };
}
