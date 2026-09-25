import { useState } from "react";
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
import { workspaceOwnerName } from "./workspace";
import { useV2Chrome } from "./V2Shell";
import { V2FilterSelect } from "./V2Select";
import { V2RefusalPopover } from "./V2RefusalPopover";
import { V2FormDialog } from "./V2FormDialog";
import { V2RowMenu, type V2RowMenuItem } from "./V2RowMenu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonRegister, V2PageSkeleton } from "./V2Skeleton";

type WorkspaceMembershipsResponse = { memberships: PeopleMembershipInput[] };
type BillingSubscription = { purchasedSeatCapacity?: number };
type RefusalTarget = { id: string; message: string };

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
  const [settingsFor, setSettingsFor] = useState<PeopleRow | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ hoursPerDay: "", canViewDailyUpdates: false });
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

  const ownerName = workspaceOwnerName(data?.memberships ?? []);

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
    onError: (error: Error) => refuse("invite-send", error.message),
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
      setSettingsFor(null);
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/memberships"] });
    },
    onError: (error: Error) => refuse("member-settings", error.message),
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

  function onInvite() {
    if (!guardWrite("invite-send")) return;
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

  function onOpenSettings(row: PeopleRow) {
    if (!guardWrite(row.userId)) return;
    setRefusal(null);
    setSettingsDraft({
      hoursPerDay: row.hoursPerDay != null ? String(row.hoursPerDay) : "",
      canViewDailyUpdates: row.canViewDailyUpdates === 1,
    });
    setSettingsFor(row);
  }

  const settingsHours = Number(settingsDraft.hoursPerDay);
  const settingsValid =
    settingsFor?.hoursPerDay == null || (Number.isInteger(settingsHours) && settingsHours >= 1 && settingsHours <= 24);

  function onSaveSettings() {
    if (!settingsFor) return;
    if (!guardWrite("member-settings")) return;
    profile.mutate({
      membershipId: settingsFor.membershipId,
      hoursPerDay: settingsFor.hoursPerDay != null ? settingsHours : undefined,
      canViewDailyUpdates: settingsFor.canViewDailyUpdates != null ? (settingsDraft.canViewDailyUpdates ? 1 : 0) : undefined,
    });
  }

  function rowMenuProps(row: PeopleRow) {
    return {
      row,
      canManage,
      pending: archive.isPending || revoke.isPending || profile.isPending,
      refusal,
      onArchive,
      onRevoke: (id: string) => {
        if (!guardWrite(id)) return;
        revoke.mutate(id);
      },
      onSettings: onOpenSettings,
      onDismiss: () => setRefusal(null),
    };
  }

  if (isLoading) {
    return (
      <V2PageSkeleton title="People" testId="v2-people" status="Loading People for this Workspace.">
        <SkeletonRegister
          className="df-people-register"
          heads={["MEMBER", "WORKSPACE ROLE", "CAPABILITIES", "STATUS"]}
        />
      </V2PageSkeleton>
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

      <p className="df-empty df-people-seats" data-edge="end">
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
        {/* A Workspace Role or condition refusal hangs from the Invite control (#245, F3, #249). */}
        <V2RefusalPopover
          controlId="invite"
          failedControlId={refusal?.id ?? null}
          message={refusal?.id === "invite" ? refusal.message : null}
          testId="v2-people-refusal-invite"
          onDismiss={() => setRefusal(null)}
          trigger={
            <span className="df-refusal-anchor">
              <Button
                variant="default"
                type="button"
                data-testid="v2-people-invite"
                onClick={() => {
                  if (!guardWrite("invite")) return;
                  setInviteEmail("");
                  setRefusal(null);
                  setInviting(true);
                }}
                className="df-btn"
              >
                Invite
              </Button>
            </span>
          }
        />
      </div>

      <V2FormDialog
        open={inviting}
        onOpenChange={(open) => {
          setInviting(open);
          if (!open) setRefusal(null);
        }}
        title="Invite to Workspace"
        description={page.invitePreview}
        submitLabel="Send Invitation"
        pending={invite.isPending}
        canSubmit={Boolean(inviteEmail.trim())}
        onSubmit={onInvite}
        refusal={refusal?.id === "invite-send" ? refusal.message : null}
        testId="v2-people-invite-dialog"
      >
        <label className="df-daily-field">
          EMAIL
          <input
            type="email"
            value={inviteEmail}
            autoFocus
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="name@company.com"
            aria-label="Invitation email"
          />
        </label>
        <label className="df-daily-field">
          WORKSPACE ROLE
          <V2FilterSelect
            label=""
            ariaLabel="Workspace Role"
            value={inviteRole}
            options={PEOPLE_INVITE_ROLES.map((role) => ({ value: role, label: role }))}
            onChange={(value) => setInviteRole(value as (typeof PEOPLE_INVITE_ROLES)[number])}
          />
        </label>
      </V2FormDialog>

      <V2FormDialog
        open={settingsFor !== null}
        onOpenChange={(open) => {
          if (open) return;
          setSettingsFor(null);
          setRefusal(null);
        }}
        title="Member settings"
        description={`How ${settingsFor?.name ?? "this Member"} works in ${workspaceName}.`}
        submitLabel="Save settings"
        pending={profile.isPending}
        canSubmit={settingsValid}
        onSubmit={onSaveSettings}
        refusal={refusal?.id === "member-settings" ? refusal.message : null}
        testId="v2-people-settings-dialog"
      >
        {settingsFor?.hoursPerDay != null ? (
          <label className="df-daily-field">
            HOURS PER DAY
            <input
              type="number"
              min={1}
              max={24}
              value={settingsDraft.hoursPerDay}
              autoFocus
              onChange={(event) => setSettingsDraft((draft) => ({ ...draft, hoursPerDay: event.target.value }))}
              aria-label={`Hours per day for ${settingsFor.name}`}
            />
          </label>
        ) : null}
        {settingsFor?.canViewDailyUpdates != null ? (
          <div className="df-checkbox-row">
            <Checkbox
              id="df-member-daily-updates"
              className="df-checkbox"
              checked={settingsDraft.canViewDailyUpdates}
              onCheckedChange={(next) => setSettingsDraft((draft) => ({ ...draft, canViewDailyUpdates: next === true }))}
            />
            <label htmlFor="df-member-daily-updates">Can view Daily Updates</label>
          </div>
        ) : null}
      </V2FormDialog>

      <section className="df-card df-people-register" data-testid="v2-people-register">
        {page.empty ? (
          <p className="df-empty">{page.emptyCopy}</p>
        ) : layout.stackedRegister ? (
          page.rows.map((row) => (
            <div
              key={row.kind === "invitation" ? row.invitationId : row.membershipId}
              className="df-people-row-wrap"
              data-just-accepted={row.justAccepted ? "true" : "false"}
              data-motion={row.justAccepted ? ACCEPT_MOTION : "instant"}
            >
              <div className="df-register-row" data-testid={`v2-people-row-${row.userId}`}>
                <span className="df-project-mobile">
                  <span className="df-avatar" data-self={row.self ? "true" : "false"}>
                    {row.initials}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.name}</div>
                    <div className="df-mono df-meta">
                      {row.workspaceRole} · {statusLabel(row.status)}
                      {row.capabilities !== "—" ? ` · ${row.capabilities}` : ""}
                    </div>
                  </span>
                  <PeopleRowMenu {...rowMenuProps(row)} />
                </span>
              </div>
            </div>
          ))
        ) : (
          <Table className="df-table" data-testid="v2-people-table">
            <TableHeader>
              <TableRow className="df-table-head-row">
                <TableHead className="df-table-head" data-column="member">MEMBER</TableHead>
                <TableHead className="df-table-head" data-column="role">WORKSPACE ROLE</TableHead>
                <TableHead className="df-table-head" data-column="capabilities">CAPABILITIES</TableHead>
                <TableHead className="df-table-head" data-column="status">STATUS</TableHead>
                <TableHead className="df-table-head" data-column="actions">
                  <span className="df-sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((row) => (
                <TableRow
                  key={row.kind === "invitation" ? row.invitationId : row.membershipId}
                  className="df-table-row df-people-row-wrap"
                  data-just-accepted={row.justAccepted ? "true" : "false"}
                  data-motion={row.justAccepted ? ACCEPT_MOTION : "instant"}
                  data-testid={`v2-people-row-${row.userId}`}
                >
                  <TableCell className="df-table-cell" data-column="member">
                    <span className="df-people-member">
                      <span className="df-avatar" data-self={row.self ? "true" : "false"}>
                        {row.initials}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <div className="df-row-title">{row.name}</div>
                        <div className="df-mono df-meta" data-case="preserve">
                          {row.email}
                        </div>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="df-table-cell" data-column="role">
                    <span className="df-status">{row.workspaceRole}</span>
                  </TableCell>
                  <TableCell className="df-table-cell" data-column="capabilities">
                    <span className="df-mono df-meta">{row.capabilities}</span>
                  </TableCell>
                  <TableCell className="df-table-cell" data-column="status">
                    <span className="df-status" data-status={row.status}>
                      {statusLabel(row.status)}
                    </span>
                  </TableCell>
                  <TableCell className="df-table-cell" data-column="actions">
                    <PeopleRowMenu {...rowMenuProps(row)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

type PeopleRow = ReturnType<typeof composePeople>["rows"][number];

function statusLabel(status: string): string {
  return status === "INVITATION PENDING" ? "Invitation pending" : status;
}

/**
 * Every row carries the same one control, so the columns line up and no row
 * grows taller than another. A refusal hangs from that control (#245, F3).
 */
function PeopleRowMenu({
  row,
  canManage,
  pending,
  refusal,
  onArchive,
  onRevoke,
  onSettings,
  onDismiss,
}: {
  row: PeopleRow;
  canManage: boolean;
  pending: boolean;
  refusal: RefusalTarget | null;
  onArchive: (row: { userId: string; archiveAction: "archive" | "restore" }) => void;
  onRevoke: (id: string) => void;
  onSettings: (row: PeopleRow) => void;
  onDismiss: () => void;
}) {
  const items: V2RowMenuItem[] = [];
  let controlId = row.userId;
  if (row.kind === "invitation" && row.invitationId) {
    controlId = row.invitationId;
    items.push({
      label: "Revoke invitation",
      disabled: pending,
      testId: `v2-people-revoke-${row.invitationId}`,
      onSelect: () => onRevoke(row.invitationId!),
    });
  } else {
    if (canManage && (row.hoursPerDay != null || row.canViewDailyUpdates != null)) {
      items.push({
        label: "Member settings",
        disabled: pending,
        testId: `v2-people-settings-${row.userId}`,
        onSelect: () => onSettings(row),
      });
    }
    if (row.archiveAction) {
      items.push({
        label: row.archiveAction === "restore" ? "Restore" : "Archive",
        disabled: pending,
        testId: `v2-people-archive-${row.userId}`,
        onSelect: () => onArchive({ userId: row.userId, archiveAction: row.archiveAction! }),
      });
    }
  }
  if (items.length === 0) return null;
  const open = refusal?.id === controlId;
  return (
    <V2RefusalPopover
      controlId={controlId}
      failedControlId={refusal?.id ?? null}
      message={open ? refusal.message : null}
      testId={`v2-people-refusal-${controlId}`}
      onDismiss={onDismiss}
      trigger={
        <span className="df-row-actions">
          <V2RowMenu ariaLabel={`Actions on ${row.name}`} testId={`v2-people-menu-${row.userId}`} items={items} />
        </span>
      }
    />
  );
}
