/**
 * Self-service registration presentation (#230, Flow 1 steps 1–2; ADR-0007).
 *
 * Clerk provides the fields, the provider buttons, and any verification step.
 * DocuFlow provides the frame, the brand, and the one screen Clerk cannot: the
 * moment after it hands back an authenticated identity, while DocuFlow links or
 * creates its own `User`. That is a step, not a decision — so it states what is
 * happening and offers nothing to press.
 *
 * A failure is the exception. There is exactly one a person can act on — the
 * address already belongs to another account — and the way out of it is to
 * sign out and come back as that account.
 */

export const SIGN_IN_PATH = "/auth";
export const SIGN_UP_PATH = "/sign-up";

/** Flow 1 step 2, at HTTP: the User behind this provider session. */
export function registrationPath(): string {
  return "/api/auth/user";
}

export type RegistrationStatus = "registering" | "failed";

export type RegistrationModel = {
  title: string;
  copy: string;
  /** Registering is a step; only a failure has a way out worth offering. */
  action: "none" | "sign-out";
};

const UNEXPLAINED =
  "DocuFlow could not finish setting your account up. Sign out and try again — nothing was charged and no Workspace was created.";

export function composeRegistration(input: {
  status: RegistrationStatus;
  message?: string;
}): RegistrationModel {
  if (input.status === "registering") {
    return {
      title: "Setting up your account",
      copy: "A moment — then you name your first Workspace.",
      action: "none",
    };
  }

  const reason = input.message?.trim();
  return {
    // Not "Error" and not "Failed": the person did nothing wrong, and the most
    // likely reason is that they already have an account.
    title: "Your account is not set up yet",
    copy: reason && reason.length > 0 ? `${reason}.` : UNEXPLAINED,
    action: "sign-out",
  };
}
