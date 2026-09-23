import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motionForSurface } from "./motion";
import { V2FilterSelect } from "./V2Select";
import {
  accountDeletionPath,
  composeAccountDeletion,
  workspaceOwnerPath,
  workspacePath,
  type AccountDeletionState,
  type OwnedWorkspaceRow,
} from "./lifecycle";
import { Button } from "@/components/ui/button";
import { SkeletonSection, V2PageSkeleton } from "./V2Skeleton";

const GRACE_MOTION = motionForSurface("account-deletion-grace").enterExit;
const CONFIRM_MOTION = motionForSurface("account-confirm-typing").enterExit;

/**
 * Flow 10. The precondition is stated before anything else: every owned
 * Workspace transferred or deleted first. Deletion then opens a cancelable
 * window rather than happening at once, and never touches the Workspace
 * content this User does not control (ADR-0015).
 */
export function V2AccountPage() {
  const [confirmation, setConfirmation] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<AccountDeletionState>({
    queryKey: [accountDeletionPath()],
  });

  const state: AccountDeletionState = data ?? {
    ownedWorkspaces: [],
    scheduled: null,
    gracePeriodDays: 0,
  };
  const page = composeAccountDeletion({ state, confirmation });

  async function refresh() {
    // Transferring or deleting a Workspace changes what this User belongs to,
    // so the chrome's Membership read is stale alongside the deletion state.
    await queryClient.invalidateQueries({ queryKey: [accountDeletionPath()] });
    await queryClient.invalidateQueries({ queryKey: ["/api/memberships"] });
  }

  const start = useMutation({
    mutationFn: () => apiRequest("POST", accountDeletionPath()),
    onSuccess: async () => {
      setConfirmation("");
      setRefusal(null);
      await refresh();
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  const cancel = useMutation({
    mutationFn: () => apiRequest("DELETE", accountDeletionPath()),
    onSuccess: async () => {
      setRefusal(null);
      await refresh();
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  if (isLoading) {
    return (
      <V2PageSkeleton
        title={page.title}
        testId="v2-account"
        subhead="Loading your account…"
        status="Loading your account."
      >
        <SkeletonSection title="Workspaces you own" lines={2} />
        <SkeletonSection title="What stays behind" lines={3} />
      </V2PageSkeleton>
    );
  }

  return (
    <div className="df-page" data-testid="v2-account">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <div className="df-mono df-account-kicker">{page.kicker}</div>
          <h1 className="df-title">{page.title}</h1>
          <p className="df-subhead">{page.lead}</p>
        </div>
      </header>

      {isError ? <p className="df-empty">Your account could not be loaded.</p> : null}
      {refusal ? <p className="df-refusal" data-testid="v2-account-refusal">{refusal}</p> : null}

      {page.precondition.rows.length > 0 ? (
        <section className="df-card df-account-owned" data-testid="v2-account-owned">
          <div className="df-card-head">
            <h2 className="df-card-title">Workspaces you own</h2>
          </div>
          {/* The precondition is stated on the card that holds it, not only in
              a header subhead the narrow chrome hides. */}
          <p className="df-card-sub df-account-precondition">{page.precondition.copy}</p>
          {page.precondition.rows.map((row) => (
            <OwnedWorkspaceCard key={row.workspaceId} row={row} onRefusal={setRefusal} onDone={refresh} />
          ))}
        </section>
      ) : null}

      <section className="df-card df-account-survives" data-testid="v2-account-survives">
        <div className="df-card-head">
          <h2 className="df-card-title">What stays behind</h2>
        </div>
        <p className="df-card-sub">{page.survives}</p>
      </section>

      <section
        className="df-card df-account-grace"
        data-motion={page.grace.active ? GRACE_MOTION : "none"}
        data-testid="v2-account-grace"
      >
        <div className="df-card-head">
          <h2 className="df-card-title">{page.grace.active ? "Deletion scheduled" : "Deletion window"}</h2>
        </div>
        {page.precondition.met ? (
          <p className="df-card-sub df-account-precondition">{page.precondition.copy}</p>
        ) : null}
        <p className="df-card-sub">{page.grace.copy}</p>
        {page.grace.completesOn ? (
          <p className="df-mono df-account-date" data-testid="v2-account-completes-on">
            {page.grace.completesOn}
          </p>
        ) : null}

        {page.action === "cancel" ? (
          <Button variant="default" type="button" data-testid="v2-account-cancel" disabled={cancel.isPending} onClick={() => cancel.mutate()} className="df-btn">
            {page.actionLabel}
          </Button>
        ) : (
          <form
            className="df-account-confirm"
            onSubmit={(event) => {
              event.preventDefault();
              if (page.canSubmit) start.mutate();
            }}
          >
            <label className="df-account-confirm-label" htmlFor="v2-account-confirm">
              Type <span className="df-mono">{page.confirmPhrase}</span> to confirm
            </label>
            <input
              id="v2-account-confirm"
              value={confirmation}
              autoComplete="off"
              data-motion={CONFIRM_MOTION}
              data-testid="v2-account-confirm"
              disabled={!page.precondition.met}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <Button variant="default" type="submit" data-testid="v2-account-start" disabled={!page.canSubmit || start.isPending} className="df-btn">
              {page.actionLabel}
            </Button>
          </form>
        )}
      </section>

      {/* Credentials are Clerk's (ADR-0007), so this page says where they live
          rather than offering a second set of controls for them. Sign out stays
          in the account menu, which already owns it. */}
      <section className="df-card df-account-session" data-testid="v2-account-session">
        <div className="df-card-head">
          <h2 className="df-card-title">Credentials</h2>
        </div>
        <p className="df-card-sub">
          Your password, email address, and multi-factor settings are held by the identity provider, not here.
        </p>
      </section>
    </div>
  );
}

function OwnedWorkspaceCard({
  row,
  onRefusal,
  onDone,
}: {
  row: OwnedWorkspaceRow;
  onRefusal: (message: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const members = row.members ?? [];
  const [successorId, setSuccessorId] = useState(members[0]?.userId ?? "");
  const [confirmName, setConfirmName] = useState("");

  const transfer = useMutation({
    mutationFn: () => apiRequest("POST", workspaceOwnerPath(row.workspaceId), { userId: successorId }),
    onSuccess: async () => {
      onRefusal(null);
      await onDone();
    },
    onError: (error: Error) => onRefusal(error.message),
  });

  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", workspacePath(row.workspaceId), { confirmName }),
    onSuccess: async () => {
      onRefusal(null);
      await onDone();
    },
    onError: (error: Error) => onRefusal(error.message),
  });

  return (
    <div className="df-account-workspace" data-testid={`v2-account-workspace-${row.workspaceId}`}>
      <div className="df-account-workspace-head">
        <span className="df-row-title">{row.workspaceName}</span>
        <span className="df-mono df-account-workspace-count">{row.otherActiveMembers}</span>
      </div>
      <p className="df-card-sub">{row.note}</p>

      {row.choice === "transfer" ? (
        <div className="df-account-workspace-action">
          <V2FilterSelect
            label="NEW OWNER"
            ariaLabel={`New Owner for ${row.workspaceName}`}
            value={successorId}
            onChange={setSuccessorId}
            testId={`v2-account-successor-${row.workspaceId}`}
            options={members.map((member) => ({ value: member.userId, label: member.name }))}
          />
          <Button variant="default" type="button" data-testid={`v2-account-transfer-${row.workspaceId}`} disabled={!successorId || transfer.isPending} onClick={() => transfer.mutate()} className="df-btn">
            {row.choiceLabel}
          </Button>
        </div>
      ) : (
        <div className="df-account-workspace-action">
          <input
            value={confirmName}
            autoComplete="off"
            placeholder={row.workspaceName}
            aria-label={`Type ${row.workspaceName} to confirm`}
            data-motion={CONFIRM_MOTION}
            data-testid={`v2-account-confirm-name-${row.workspaceId}`}
            onChange={(event) => setConfirmName(event.target.value)}
          />
          <Button variant="default" type="button" data-testid={`v2-account-delete-${row.workspaceId}`} disabled={confirmName !== row.workspaceName || remove.isPending} onClick={() => remove.mutate()} className="df-btn">
            {row.choiceLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
