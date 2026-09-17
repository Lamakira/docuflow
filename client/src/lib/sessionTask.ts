/**
 * A provider session that is not finished yet (ADR-0007).
 *
 * Clerk can hold a session in `pending` while it asks for one more thing before
 * the session becomes active: a new password, a second factor, an Organization.
 * `useAuth()` reports `isSignedIn: false` for such a session, so the app renders
 * its signed-out surface — and Clerk's `<SignIn>` paints nothing there, because
 * the step has been routed away to `taskUrls`. If that destination has no task
 * surface mounted, the person gets a white page with no way out.
 *
 * Found while walking #230: the instance had Organization membership set to
 * required, every sign-up came back pending, and registration never ran.
 *
 * The rule here is not "handle the Organization task". It is that a pending
 * session always renders something: Clerk's own surface for a key this build
 * knows, and a stated condition with a sign-out for one it does not.
 */

/** `SessionTask['key']` in `@clerk/shared`. Kept in step by hand — see the test. */
export const SESSION_TASK_KEYS = ["choose-organization", "reset-password", "setup-mfa"] as const;

export type SessionTaskKey = (typeof SESSION_TASK_KEYS)[number];

/** The page that mounts the task surfaces. Clerk is told to send every key here. */
export const SESSION_TASK_PATH = "/auth";

/**
 * Where Clerk sends the person once the step is done. `/` rather than back to
 * `/auth`: the session is active from that moment, and `/` is where Flow 1
 * step 3 waits for someone who has no Workspace yet (#217, #230).
 */
export const SESSION_TASK_COMPLETE_PATH = "/";

export function sessionTaskUrls(): Record<SessionTaskKey, string> {
  return Object.fromEntries(SESSION_TASK_KEYS.map((key) => [key, SESSION_TASK_PATH])) as Record<
    SessionTaskKey,
    string
  >;
}

export type SessionTaskModel = {
  /** Which Clerk surface completes it, or none this build can name. */
  surface: SessionTaskKey | "unknown";
  title: string;
  /** One line above Clerk's own card, so the person knows whose step this is. */
  note: string;
  action: "clerk" | "sign-out";
};

const TASKS: Record<SessionTaskKey, { title: string; note: string }> = {
  "choose-organization": {
    title: "Choose an organization",
    // The confusion worth heading off: this is not the Workspace they are about
    // to name, and it grants nothing here. Clerk cannot grant Workspace
    // authority (ADR-0007), so saying so costs one line and saves a support
    // question.
    note: "Your sign-in provider asks for this before the session starts. It is not a DocuFlow Workspace — you name that next, and it is the one that holds your work.",
  },
  "reset-password": {
    title: "Set a new password",
    note: "Your sign-in provider needs a new password before you continue. DocuFlow never sees it.",
  },
  "setup-mfa": {
    title: "Set up two-factor authentication",
    note: "Your sign-in provider needs a second factor before you continue. DocuFlow never sees it.",
  },
};

function isKnown(key: unknown): key is SessionTaskKey {
  return (SESSION_TASK_KEYS as readonly unknown[]).includes(key);
}

export function composeSessionTask(input: { key?: string | null }): SessionTaskModel {
  if (isKnown(input.key)) {
    return { surface: input.key, action: "clerk", ...TASKS[input.key] };
  }
  // A key this build has no surface for — a Clerk upgrade, most likely. Saying
  // so is worth more than a blank page, and signing out is a way back in.
  return {
    surface: "unknown",
    title: "Your sign-in provider needs one more step",
    note: "DocuFlow cannot show this step. Finish it with your provider, or sign out and start again.",
    action: "sign-out",
  };
}
