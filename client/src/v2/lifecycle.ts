/**
 * Workspace lifecycle presentation (#217, Flows 1, 5, 10).
 *
 * Naming the first Workspace is one field and one action — no wizard, no tour,
 * no role or team-size question (ADR-0004). The Trial it enters is stated, not
 * chosen, and carries no card (Flow 5, ADR-0010). Account deletion states its
 * precondition, runs a cancelable window, and never offers to purge Workspace
 * content the person does not control (Flow 10, ADR-0015).
 */

export function workspacesPath(): string {
  return "/api/workspaces";
}

export function workspacePath(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}`;
}

export function workspaceOwnerPath(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/owner`;
}

export function accountDeletionPath(): string {
  return "/api/account/deletion";
}

export const WORKSPACE_NAME_MAX = 255;

export type WorkspaceNameError = "empty" | "too-long" | null;

export function workspaceNameError(name: string): WorkspaceNameError {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > WORKSPACE_NAME_MAX) return "too-long";
  return null;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A sensible default so a solo User passes through without inventing anything
 * (Flow 1, step 3). Their name first, then the address they signed in with.
 */
export function suggestedWorkspaceName(
  user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined,
): string {
  const first = user?.firstName?.trim();
  if (first) return `${first}'s Workspace`;

  const local = user?.email?.split("@")[0] ?? "";
  const word = local.split(/[^A-Za-z]+/).filter(Boolean)[0];
  if (word) return `${capitalize(word.toLowerCase())}'s Workspace`;

  return "My Workspace";
}

export type FirstWorkspaceStatus = "ready" | "creating" | "created" | "error";

export type FirstWorkspaceModel = {
  kicker: "WORKSPACE";
  title: string;
  copy: string;
  fieldLabel: string;
  action: string;
  canSubmit: boolean;
  error: string | null;
  trialNote: string;
  /** Flow 2's other way out: this screen is also where an archived Member lands. */
  invitationNote: string;
  /** Rare state indication when the Workspace exists — never a celebration. */
  motion: "standard" | "none";
};

const NAME_REFUSAL: Record<Exclude<WorkspaceNameError, null>, string> = {
  empty: "A Workspace needs a name.",
  "too-long": `A Workspace name is at most ${WORKSPACE_NAME_MAX} characters.`,
};

export function composeFirstWorkspace(input: {
  name: string;
  status: FirstWorkspaceStatus;
  message?: string;
  reducedMotion?: boolean;
}): FirstWorkspaceModel {
  const nameError = workspaceNameError(input.name);
  const error =
    input.status === "error"
      ? input.message ?? "The Workspace could not be created."
      : nameError === "too-long"
        ? NAME_REFUSAL["too-long"]
        : null;

  return {
    kicker: "WORKSPACE",
    title: "Name your Workspace",
    copy: "A Workspace holds your Clients, Projects, and recorded time. You will be its Owner.",
    fieldLabel: "Workspace name",
    action: input.status === "creating" ? "Creating…" : "Create Workspace",
    canSubmit: nameError === null && input.status !== "creating",
    error,
    trialNote: "It starts on a Trial with every capability. No card, nothing locked.",
    invitationNote:
      "Expecting an Invitation instead? Open the link you were sent — accepting it gives you a Membership, and you do not need a Workspace of your own.",
    motion: input.status === "created" ? "standard" : "none",
  };
}

export type OwnedWorkspace = {
  workspaceId: string;
  workspaceName: string;
  otherActiveMembers: number;
  members?: Array<{ userId: string; name: string }>;
};

export type AccountDeletionState = {
  ownedWorkspaces: OwnedWorkspace[];
  scheduled: { requestedAt: string; completesAt: string } | null;
  gracePeriodDays: number;
};

export type OwnedWorkspaceRow = OwnedWorkspace & {
  /** Transfer while anyone else holds a Membership; delete only when alone. */
  choice: "transfer" | "delete";
  choiceLabel: string;
  note: string;
};

export type AccountDeletionModel = {
  kicker: "ACCOUNT";
  title: string;
  lead: string;
  precondition: { met: boolean; copy: string; rows: OwnedWorkspaceRow[] };
  survives: string;
  grace: { active: boolean; copy: string; completesOn: string | null; cancelLabel: string };
  action: "blocked" | "start" | "cancel";
  actionLabel: string;
  confirmPhrase: string;
  canSubmit: boolean;
  /** Explanation, not delight. */
  motion: "none";
};

export const ACCOUNT_DELETION_CONFIRM_PHRASE = "delete my account";

export function accountDeletionConfirmed(confirmation: string): boolean {
  return confirmation.trim().toLowerCase() === ACCOUNT_DELETION_CONFIRM_PHRASE;
}

/** A recorded date never truncates, so it is written out in full. */
export function formatDeletionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function ownedWorkspaceRow(workspace: OwnedWorkspace): OwnedWorkspaceRow {
  const alone = workspace.otherActiveMembers === 0;
  return {
    ...workspace,
    choice: alone ? "delete" : "transfer",
    choiceLabel: alone ? "Delete this Workspace" : "Transfer to another Member",
    note: alone
      ? "You are its only Member. Deleting it removes its records with it."
      : `${workspace.otherActiveMembers} other ${
          workspace.otherActiveMembers === 1 ? "Member holds" : "Members hold"
        } a Membership here. Their records stay with the Workspace.`,
  };
}

export function composeAccountDeletion(input: {
  state: AccountDeletionState;
  confirmation: string;
  reducedMotion?: boolean;
}): AccountDeletionModel {
  const rows = input.state.ownedWorkspaces.map(ownedWorkspaceRow);
  const met = rows.length === 0;
  const scheduled = input.state.scheduled;
  const confirmed = accountDeletionConfirmed(input.confirmation);

  const action: AccountDeletionModel["action"] = scheduled ? "cancel" : met ? "start" : "blocked";

  return {
    kicker: "ACCOUNT",
    title: "Delete your account",
    lead: "Your account is yours. The Workspaces you belong to are not.",
    precondition: {
      met,
      copy: met
        ? "You own no Workspace. Nothing stands in the way."
        : "Every Workspace you own must be transferred or deleted before your account can go.",
      rows,
    },
    survives:
      "Recorded time, Activity Evidence, and Daily Updates stay with the Workspaces they belong to. " +
      "DocuFlow holds Workspace content for the customer, so deleting your account does not remove your colleagues' history. " +
      "Your Memberships stay in place under a pseudonym so those records keep their references.",
    grace: {
      active: Boolean(scheduled),
      completesOn: scheduled ? formatDeletionDate(scheduled.completesAt) : null,
      copy: scheduled
        ? `Deletion completes on ${formatDeletionDate(
            scheduled.completesAt,
          )}. You can cancel any time until then.`
        : `Deletion does not happen at once. A ${input.state.gracePeriodDays}-day window opens first, and you can cancel it any time inside that window.`,
      cancelLabel: "Cancel deletion",
    },
    action,
    actionLabel: scheduled
      ? "Cancel deletion"
      : met
        ? "Start deletion"
        : "Transfer or delete your Workspaces first",
    confirmPhrase: ACCOUNT_DELETION_CONFIRM_PHRASE,
    canSubmit: action === "cancel" ? true : action === "start" && confirmed,
    motion: "none",
  };
}
