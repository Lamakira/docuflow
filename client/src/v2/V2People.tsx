import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motionForSurface } from "./motion";
import {
  PEOPLE_INVITE_ROLES,
  composePeople,
  invitationRevokePath,
  membershipProfilePath,
  peopleWriteRefusal,
  workspaceInvitationsPath,
  workspaceMembershipsPath,
  type PeopleInvitationInput,
  type PeopleMembershipInput,
} from "./people";
import { memberName } from "./today";
import { useV2Chrome } from "./V2Shell";

type WorkspaceMembershipsResponse = { memberships: PeopleMembershipInput[] };
type BillingSubscription = { purchasedSeatCapacity?: number };
type RefusalTarget = { id: string; message: string };

const REFUSAL_MOTION = motionForSurface("capability-refusal").enterExit;
const ACCEPT_MOTION = motionForSurface("invitation-accept").enterExit;

export function V2PeoplePage() {
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof PEOPLE_INVITE_ROLES)[number]>("MEMBER");
  const [refusal, setRefusal] = useState<RefusalTarget | null>(null);
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const workspaceRole = current?.workspaceRole ?? "MEMBER";
  const readOnly = current?.condition === "Read-only";
  const canReviewArchived = workspaceRole === "OWNER" || workspaceRole === "ADMINISTRATOR";
  const canManage = canReviewArchived;

  const listUrl = workspaceMembershipsPath({ includeArchived: canReviewArchived && includeArchived });
  const { data, isLoading, isError } = useQuery<WorkspaceMembershipsResponse>({
    queryKey: ["/api/workspace/memberships", listUrl],
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Memberships");
      return res.json();
    },
  });
  const { data: invitations = [] } = useQuery<PeopleInvitationInput[]>({
    queryKey: [workspaceInvitationsPath()],
    queryFn: async () => {
      const res = await fetch(workspaceInvitationsPath(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Invitations");
      return res.json();
    },
  });
  const { data: subscription } = useQuery<BillingSubscription | null>({
    queryKey: ["/api/billing/subscription"],
    queryFn: async () => {
      const res = await fetch("/api/billing/subscription", { credentials: "include" });
      if (res.status === 403) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  const owner = (data?.memberships ?? []).find((row) => row.workspaceRole === "OWNER");
  const ownerName = owner ? memberName(owner) : null;

  const page = composePeople({
    workspaceName,
    currentUserId: user?.id ?? "",
    ownerName,
    condition: current?.condition ?? null,
    includeArchived: canReviewArchived && includeArchived,
    purchasedSeats: subscription?.purchasedSeatCapacity ?? null,
    memberships: data?.memberships ?? [],
    invitations,
    filterQuery,
  });

  function refuse(id: string, errorMessage: string) {
    setRefusal({
      id,
      message: peopleWriteRefusal({
        kind: "error",
        workspaceName,
        workspaceRole,
        ownerName,
        errorMessage,
        purchasedSeats: subscription?.purchasedSeatCapacity ?? null,
      }),
    });
  }

  const archive = useMutation({
    mutationFn: async (row: { userId: string; archiveAction: "archive" | "restore" }) => {
      await apiRequest("PATCH", `/api/admin/users/${row.userId}/archive`, {
        isArchived: row.archiveAction === "archive",
      });
    },
    onSuccess: () => {
      setRefusal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/memberships"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error: Error, row) => refuse(row.userId, error.message),
  });

  const invite = useMutation({
    mutationFn: () =>
      apiRequest("POST", workspaceInvitationsPath(), {
        email: inviteEmail.trim(),
        workspaceRole: inviteRole,
      }),
    onSuccess: () => {
      setRefusal(null);
      setInviteEmail("");
      setInviting(false);
      queryClient.invalidateQueries({ queryKey: [workspaceInvitationsPath()] });
    },
    onError: (error: Error) => refuse("invite", error.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest("POST", invitationRevokePath(id)),
    onSuccess: () => {
      setRefusal(null);
      queryClient.invalidateQueries({ queryKey: [workspaceInvitationsPath()] });
    },
    onError: (error: Error, id) => refuse(id, error.message),
  });

  const profile = useMutation({
    mutationFn: (input: { membershipId: string; hoursPerDay?: number; canViewDailyUpdates?: number }) =>
      apiRequest("PATCH", membershipProfilePath(input.membershipId), {
        hoursPerDay: input.hoursPerDay,
        canViewDailyUpdates: input.canViewDailyUpdates,
      }),
    onSuccess: () => {
      setRefusal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/memberships"] });
    },
    onError: (error: Error, input) => refuse(input.membershipId, error.message),
  });

  function guardWrite(id: string): boolean {
    if (readOnly) {
      setRefusal({
        id,
        message: peopleWriteRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }),
      });
      return false;
    }
    if (!canManage) {
      setRefusal({
        id,
        message: peopleWriteRefusal({ kind: "workspace-role", workspaceRole, ownerName }),
      });
      return false;
    }
    return true;
  }

  function onInvite(event: FormEvent) {
    event.preventDefault();
    if (!guardWrite("invite")) return;
    if (!inviteEmail.trim()) return;
    invite.mutate();
  }

  function onArchive(row: { userId: string; archiveAction: "archive" | "restore" }) {
    if (readOnly) {
      setRefusal({
        id: row.userId,
        message: peopleWriteRefusal({ kind: "workspace-condition", workspaceName, condition: "Read-only" }),
      });
      return;
    }
    archive.mutate(row);
  }

  if (isLoading) {
    return (
      <div className="df-page" data-testid="v2-people">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">People</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="df-page" data-testid="v2-people">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">People</h1>
            <p className="df-subhead">{page.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Memberships in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-people">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">People</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
        <span className="df-count-chip df-people-seats">{page.rows.length}</span>
      </header>

      <p className="df-empty df-people-seats" style={{ paddingTop: 0 }}>
        {page.seatCopy}
      </p>

      <div className="df-filter-bar df-people-filter">
        <label className="df-filter-input">
          <input
            type="search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter People"
            aria-label="Filter People"
          />
        </label>
        {canReviewArchived ? (
          <label className="df-filter-chip" data-active={includeArchived ? "true" : "false"}>
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked);
                setRefusal(null);
              }}
            />
            Show archived
          </label>
        ) : null}
        <button
          type="button"
          className="df-ink-btn"
          data-testid="v2-people-invite"
          onClick={() => {
            if (!guardWrite("invite")) return;
            setInviting((open) => !open);
          }}
        >
          Invite
        </button>
      </div>

      {/*
        The invite refusal hangs from this anchor (#245, F3). `.df-refusal-pop`
        is positioned against `.df-refusal-anchor`; without one here the popover
        resolved against a distant ancestor and landed near the bottom-right of
        the page, hundreds of pixels from the form that raised it.
      */}
      {inviting || refusal?.id === "invite" ? (
      <div className="df-refusal-anchor df-refusal-anchor-block">
      {inviting ? (
        <form className="df-filter-bar df-people-filter" onSubmit={onInvite}>
          <label className="df-filter-input">
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="Email"
              aria-label="Invitation email"
            />
          </label>
          <label className="df-filter-input">
            <select
              className="df-people-role"
              aria-label="Workspace Role"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as (typeof PEOPLE_INVITE_ROLES)[number])}
            >
              {PEOPLE_INVITE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="df-ink-btn" disabled={invite.isPending || !inviteEmail.trim()}>
            Send Invitation
          </button>
        </form>
      ) : null}
      {inviting ? <p className="df-empty df-people-seats">{page.invitePreview}</p> : null}

      {refusal?.id === "invite" ? (
        <div className="df-refusal-pop" data-motion={REFUSAL_MOTION} role="status" data-testid="v2-people-refusal-invite">
          <p className="df-refusal">{refusal.message}</p>
          <button type="button" className="df-ghost-btn" onClick={() => setRefusal(null)}>
            Close
          </button>
        </div>
      ) : null}
      </div>
      ) : null}

      <section className="df-card df-people-register" data-testid="v2-people-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>MEMBER</span>
            <span>WORKSPACE ROLE</span>
            <span>CAPABILITIES</span>
            <span>STATUS</span>
            <span />
          </div>
        )}
        {page.empty ? (
          <p className="df-empty">{page.emptyCopy}</p>
        ) : (
          page.rows.map((row) => (
            <div
              key={row.kind === "invitation" ? row.invitationId : row.membershipId}
              className="df-people-row-wrap"
              data-just-accepted={row.justAccepted ? "true" : "false"}
              data-motion={row.justAccepted ? ACCEPT_MOTION : "instant"}
            >
              <div className="df-register-row" data-testid={`v2-people-row-${row.userId}`}>
                {layout.stackedRegister ? (
                  <span className="df-project-mobile">
                    <span className="df-avatar" data-self={row.self ? "true" : "false"}>
                      {row.initials}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="df-row-title">{row.name}</div>
                      <div className="df-mono df-meta">
                        {row.workspaceRole} ·{" "}
                        {row.status === "INVITATION PENDING" ? "Invitation pending" : row.status}
                        {row.capabilities !== "—" ? ` · ${row.capabilities}` : ""}
                      </div>
                    </span>
                    <RowActions
                      row={row}
                      canManage={canManage}
                      pending={archive.isPending || revoke.isPending || profile.isPending}
                      refusal={refusal}
                      onArchive={onArchive}
                      onRevoke={(id) => {
                        if (!guardWrite(id)) return;
                        revoke.mutate(id);
                      }}
                      onProfile={(patch) => {
                        if (!guardWrite(row.membershipId)) return;
                        profile.mutate(patch);
                      }}
                      onDismiss={() => setRefusal(null)}
                    />
                  </span>
                ) : (
                  <>
                    <span className="df-people-member">
                      <span className="df-avatar" data-self={row.self ? "true" : "false"}>
                        {row.initials}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <div className="df-row-title">{row.name}</div>
                        <div className="df-mono df-meta">{row.email}</div>
                      </span>
                    </span>
                    <span className="df-status">{row.workspaceRole}</span>
                    <span className="df-mono df-meta">{row.capabilities}</span>
                    <span className="df-status" data-status={row.status}>
                      {row.status === "INVITATION PENDING" ? "Invitation pending" : row.status}
                    </span>
                    <span className="df-people-action">
                      <RowActions
                        row={row}
                        canManage={canManage}
                        pending={archive.isPending || revoke.isPending || profile.isPending}
                        refusal={refusal}
                        onArchive={onArchive}
                        onRevoke={(id) => {
                          if (!guardWrite(id)) return;
                          revoke.mutate(id);
                        }}
                        onProfile={(patch) => {
                          if (!guardWrite(row.membershipId)) return;
                          profile.mutate(patch);
                        }}
                        onDismiss={() => setRefusal(null)}
                      />
                    </span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function RowActions({
  row,
  canManage,
  pending,
  refusal,
  onArchive,
  onRevoke,
  onProfile,
  onDismiss,
}: {
  row: ReturnType<typeof composePeople>["rows"][number];
  canManage: boolean;
  pending: boolean;
  refusal: RefusalTarget | null;
  onArchive: (row: { userId: string; archiveAction: "archive" | "restore" }) => void;
  onRevoke: (id: string) => void;
  onProfile: (input: { membershipId: string; hoursPerDay?: number; canViewDailyUpdates?: number }) => void;
  onDismiss: () => void;
}) {
  if (row.kind === "invitation" && row.invitationId) {
    return (
      <RefusalAnchor
        id={row.invitationId}
        pending={pending}
        refusal={refusal}
        onDismiss={onDismiss}
        label="Revoke"
        testId={`v2-people-revoke-${row.invitationId}`}
        onClick={() => onRevoke(row.invitationId!)}
      />
    );
  }
  const hours =
    canManage && row.hoursPerDay != null ? (
      <label className="df-mono df-meta">
        Hours/day
        <input
          type="number"
          min={1}
          max={24}
          defaultValue={row.hoursPerDay}
          aria-label={`Hours per day for ${row.name}`}
          onBlur={(event) => {
            const hoursPerDay = Number(event.target.value);
            if (hoursPerDay === row.hoursPerDay) return;
            onProfile({ membershipId: row.membershipId, hoursPerDay });
          }}
        />
      </label>
    ) : null;
  const daily =
    canManage && row.canViewDailyUpdates != null ? (
      <label className="df-filter-chip">
        <input
          type="checkbox"
          checked={row.canViewDailyUpdates === 1}
          onChange={(event) =>
            onProfile({
              membershipId: row.membershipId,
              canViewDailyUpdates: event.target.checked ? 1 : 0,
            })
          }
        />
        View Daily Updates
      </label>
    ) : null;
  const archive = row.archiveAction ? (
    <RefusalAnchor
      id={row.userId}
      pending={pending}
      refusal={refusal}
      onDismiss={onDismiss}
      label={row.archiveAction === "restore" ? "Restore" : "Archive"}
      testId={`v2-people-archive-${row.userId}`}
      onClick={() => onArchive({ userId: row.userId, archiveAction: row.archiveAction! })}
    />
  ) : null;
  if (!hours && !daily && !archive) return null;
  return (
    <span className="df-people-action">
      {hours}
      {daily}
      {archive}
    </span>
  );
}

function RefusalAnchor({
  id,
  pending,
  refusal,
  onDismiss,
  label,
  testId,
  onClick,
}: {
  id: string;
  pending: boolean;
  refusal: RefusalTarget | null;
  onDismiss: () => void;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  const open = refusal?.id === id;
  return (
    <span className="df-refusal-anchor">
      <button type="button" className="df-ghost-btn" disabled={pending} data-testid={testId} onClick={onClick}>
        {label}
      </button>
      {open ? (
        <div className="df-refusal-pop" data-motion={REFUSAL_MOTION} role="status" data-testid={`v2-people-refusal-${id}`}>
          <p className="df-refusal">{refusal.message}</p>
          <button type="button" className="df-ghost-btn" onClick={onDismiss}>
            Close
          </button>
        </div>
      ) : null}
    </span>
  );
}
