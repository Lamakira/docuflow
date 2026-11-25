import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motionForSurface } from "./motion";
import { errorMessage, notify } from "./notify";
import { useRefreshFailure } from "./useRefreshFailure";
import {
  ARCHIVE_UNDO_MS,
  PEOPLE_ROLE_CHOICES,
  PEOPLE_STALE_KEYS,
  composePeople,
  inviteEmailProblem,
  invitePreview,
  invitationResendPath,
  invitationRevokePath,
  invitationSentNotice,
  membershipArchivePath,
  membershipProfilePath,
  membershipRestorePath,
  memberSettingsPatch,
  peopleFailure,
  readPeopleFilters,
  workspaceInvitationsPath,
  workspaceMembershipsPath,
  writePeopleFilters,
  type PeopleInvitationInput,
  type PeopleMembershipInput,
} from "./people";
import { useV2Chrome } from "./V2Shell";
import { V2LoadFailed, V2RecordEmpty } from "./V2EmptyState";
import { FilterCheck } from "./V2FilterCheck";
import { V2FilterSelect } from "./V2Select";
import { V2FormDialog } from "./V2FormDialog";
import { V2RowMenu, type V2RowMenuItem } from "./V2RowMenu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonRegister, V2PageSkeleton } from "./V2Skeleton";
import { V2PageHead } from "./V2PageHead";

type WorkspaceMembershipsResponse = { memberships: PeopleMembershipInput[] };
type BillingSubscription = { purchasedSeatCapacity?: number };
type InviteResult = { email: string; emailSent: boolean };

const ACCEPT_MOTION = motionForSurface("invitation-accept").enterExit;
const SEARCH_SETTLE_MS = 250;

function refreshPeople() {
  for (const key of PEOPLE_STALE_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
}

export function V2PeoplePage() {
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const filters = readPeopleFilters(search);
  const [filterQuery, setFilterQuery] = useState(filters.q);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteProblem, setInviteProblem] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<PeopleRow | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ workspaceRole: "MEMBER", canViewDailyUpdates: false });
  const [settingsProblem, setSettingsProblem] = useState<string | null>(null);
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const workspaceRole = current?.workspaceRole ?? "MEMBER";
  const readOnly = current?.condition === "Read-only";
  const canManage = workspaceRole === "OWNER" || workspaceRole === "ADMINISTRATOR";
  const includeArchived = canManage && filters.archived;

  function setFilters(next: { q: string; archived: boolean }) {
    setLocation(`/people${writePeopleFilters(search, next)}`, { replace: true });
  }

  // The search box answers each keystroke; the address follows once typing settles.
  useEffect(() => {
    if (filterQuery === filters.q) return;
    const timer = window.setTimeout(() => setFilters({ ...filters, q: filterQuery }), SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [filterQuery]);

  // Every visit re-reads, and the archived switch keeps the list on screen until the other arrives.
  const listUrl = workspaceMembershipsPath({ includeArchived });
  const { data, isLoading, isError, refetch } = useQuery<WorkspaceMembershipsResponse>({
    queryKey: ["/api/workspace/memberships", listUrl],
    placeholderData: keepPreviousData,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Memberships");
      return res.json();
    },
  });
  useRefreshFailure(isError && Boolean(data), "People could not be refreshed.", "v2-people-refresh-failed");
  // A Member is refused the Invitations and the seats, so neither is asked for.
  const invitationsQuery = useQuery<PeopleInvitationInput[]>({
    queryKey: [workspaceInvitationsPath()],
    enabled: canManage,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch(workspaceInvitationsPath(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Invitations");
      return res.json();
    },
  });
  const { data: subscription } = useQuery<BillingSubscription | null>({
    queryKey: ["/api/billing/subscription"],
    enabled: canManage,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/billing/subscription", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });
  const purchasedSeats = subscription?.purchasedSeatCapacity ?? null;
  const invitationsFailed = canManage && invitationsQuery.isError && !invitationsQuery.data;
  useRefreshFailure(
    canManage && invitationsQuery.isError && Boolean(invitationsQuery.data),
    "Invitations could not be refreshed.",
    "v2-invitations-refresh-failed",
  );

  const page = composePeople({
    currentUserId: user?.id ?? "",
    condition: current?.condition ?? null,
    includeArchived,
    purchasedSeats,
    memberships: data?.memberships ?? [],
    invitations: canManage && !invitationsFailed ? (invitationsQuery.data ?? []) : null,
    filterQuery,
    canInvite: !readOnly && canManage,
    canManage,
  });

  function fail(error: Error) {
    notify.error(peopleFailure(error.message, { purchasedSeats, canManage }));
  }

  const changeArchive = useMutation({
    mutationFn: (input: { row: PeopleRow; restore: boolean }) =>
      apiRequest("POST", (input.restore ? membershipRestorePath : membershipArchivePath)(input.row.membershipId)),
    onSuccess: (_result, { row, restore }) => {
      refreshPeople();
      if (restore) return notify.success(`${row.name} restored`);
      notify.success(`${row.name} archived`, {
        duration: ARCHIVE_UNDO_MS,
        action: { label: "Undo", onClick: () => changeArchive.mutate({ row, restore: true }) },
      });
    },
    onError: fail,
  });

  const invite = useMutation({
    mutationFn: () =>
      apiRequest("POST", workspaceInvitationsPath(), {
        email: inviteEmail.trim(),
        workspaceRole: inviteRole,
      }) as Promise<InviteResult>,
    onSuccess: (result) => {
      const email = inviteEmail.trim();
      setInviteEmail("");
      setInviting(false);
      refreshPeople();
      announceSent(email, result.emailSent !== false, false);
    },
    onError: (error: Error) =>
      setInviteProblem(errorMessage(peopleFailure(error.message, { purchasedSeats, canManage }))),
  });

  const resend = useMutation({
    mutationFn: (row: PeopleRow) => apiRequest("POST", invitationResendPath(row.invitationId!)) as Promise<InviteResult>,
    onSuccess: (result, row) => {
      refreshPeople();
      announceSent(row.email, result.emailSent !== false, true);
    },
    onError: fail,
  });

  const revoke = useMutation({
    mutationFn: (row: PeopleRow) => apiRequest("POST", invitationRevokePath(row.invitationId!)),
    onSuccess: () => {
      refreshPeople();
      notify.success("Invitation revoked");
    },
    onError: fail,
  });

  const profile = useMutation({
    mutationFn: (input: { membershipId: string; patch: object }) =>
      apiRequest("PATCH", membershipProfilePath(input.membershipId), input.patch),
    onSuccess: () => {
      setSettingsFor(null);
      refreshPeople();
      notify.success("Member settings saved");
    },
    onError: (error: Error) => setSettingsProblem(errorMessage(error)),
  });

  function announceSent(email: string, emailSent: boolean, again: boolean) {
    const notice = invitationSentNotice(email, emailSent, again);
    if (notice.kind === "success") notify.success(notice.message);
    else notify.info(notice.message);
  }

  function onInvite() {
    const problem = inviteEmailProblem(inviteEmail);
    if (problem) return setInviteProblem(problem);
    setInviteProblem(null);
    invite.mutate();
  }

  function onOpenSettings(row: PeopleRow) {
    setSettingsProblem(null);
    setSettingsDraft({ workspaceRole: row.roleValue, canViewDailyUpdates: row.canViewDailyUpdates === 1 });
    setSettingsFor(row);
  }

  const settingsPatch = settingsFor ? memberSettingsPatch(settingsFor, settingsDraft) : null;

  const busy = changeArchive.isPending || resend.isPending || revoke.isPending || profile.isPending;
  function rowMenuProps(row: PeopleRow) {
    return {
      row,
      busy,
      onArchive: (target: PeopleRow) => changeArchive.mutate({ row: target, restore: false }),
      onRestore: (target: PeopleRow) => changeArchive.mutate({ row: target, restore: true }),
      onResend: (target: PeopleRow) => resend.mutate(target),
      onRevoke: (target: PeopleRow) => revoke.mutate(target),
      onSettings: onOpenSettings,
    };
  }

  if (isLoading) {
    return (
      <V2PageSkeleton title="People" hasSubhead={false} testId="v2-people" status="Loading People for this Workspace.">
        <SkeletonRegister
          className="df-people-register"
          heads={["Member", "Workspace role", "Access", "Status"]}
        />
      </V2PageSkeleton>
    );
  }

  if (isError && !data) {
    return (
      <div className="df-page" data-testid="v2-people">
        <V2PageHead title="People" />
        <V2LoadFailed
          title="People could not be loaded"
          copy="Something went wrong while loading them. Try again."
          onRetry={() => refetch()}
          testId="v2-people-load-failed"
        />
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-people">
      <V2PageHead
        title="People"
        chip={page.chip}
        subhead={page.seatCopy}
        actions={
          <>
            <label className="df-filter-input">
              <Search width={14} height={14} strokeWidth={1.4} style={{ color: "var(--df-archive-slate)" }} />
              <input
                type="search"
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder="Search People"
                aria-label="Search People"
              />
            </label>
            {canManage ? (
              <FilterCheck
                id="v2-people-archived"
                checked={filters.archived}
                label="Show archived"
                onChange={(archived) => setFilters({ ...filters, archived })}
              />
            ) : null}
            {!readOnly && canManage ? (
              <Button
                variant="default"
                type="button"
                data-testid="v2-people-invite"
                onClick={() => {
                  setInviteEmail("");
                  setInviteRole("MEMBER");
                  setInviteProblem(null);
                  setInviting(true);
                }}
                className="df-btn"
              >
                <Plus strokeWidth={1.6} aria-hidden />
                Invite
              </Button>
            ) : null}
          </>
        }
      />

      <V2FormDialog
        open={inviting}
        onOpenChange={setInviting}
        title="Invite to Workspace"
        description={invitePreview(workspaceName, page.activeCount, purchasedSeats)}
        submitLabel="Send Invitation"
        pending={invite.isPending}
        canSubmit
        onSubmit={onInvite}
        testId="v2-people-invite-dialog"
      >
        <label className="df-daily-field">
          Email
          <input
            type="email"
            value={inviteEmail}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setInviteEmail(event.target.value);
              setInviteProblem(null);
            }}
            placeholder="name@company.com"
            aria-label="Invitation email"
            aria-invalid={inviteProblem ? true : undefined}
            aria-describedby={inviteProblem ? "df-invite-problem" : undefined}
          />
          {inviteProblem ? (
            <span id="df-invite-problem" className="df-field-problem" role="alert">
              {inviteProblem}
            </span>
          ) : null}
        </label>
        <label className="df-daily-field">
          Workspace role
          <V2FilterSelect
            label=""
            ariaLabel="Workspace role"
            value={inviteRole}
            options={PEOPLE_ROLE_CHOICES.map(({ value, label }) => ({ value, label }))}
            onChange={setInviteRole}
          />
        </label>
        <RoleLines />
      </V2FormDialog>

      <V2FormDialog
        open={settingsFor !== null}
        onOpenChange={(open) => {
          if (!open) setSettingsFor(null);
        }}
        title="Member settings"
        description={`Change the role and access of ${settingsFor?.name ?? "this Member"} in ${workspaceName}.`}
        submitLabel="Save settings"
        pending={profile.isPending}
        canSubmit={settingsPatch !== null}
        onSubmit={() => {
          if (!settingsFor || !settingsPatch) return;
          setSettingsProblem(null);
          profile.mutate({ membershipId: settingsFor.membershipId, patch: settingsPatch });
        }}
        refusal={settingsProblem}
        testId="v2-people-settings-dialog"
      >
        <label className="df-daily-field">
          Workspace role
          <V2FilterSelect
            label=""
            ariaLabel="Workspace role"
            value={settingsDraft.workspaceRole}
            options={PEOPLE_ROLE_CHOICES.map(({ value, label }) => ({ value, label }))}
            onChange={(next) => setSettingsDraft((draft) => ({ ...draft, workspaceRole: next }))}
          />
        </label>
        <RoleLines />
        {settingsDraft.workspaceRole === "MEMBER" ? (
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
        {page.emptyState ? (
          <V2RecordEmpty
            model={page.emptyState}
            icon="people"
            onClear={() => {
              setFilterQuery("");
              setFilters({ ...filters, q: "" });
            }}
            testIds={{ none: "v2-people-empty" }}
          />
        ) : layout.stackedRegister ? (
          page.rows.map((row) => (
            <div
              key={row.kind === "invitation" ? row.invitationId : row.membershipId}
              className="df-people-row-wrap"
              data-state={row.state}
              data-just-accepted={row.justAccepted ? "true" : "false"}
              data-motion={row.justAccepted ? ACCEPT_MOTION : "instant"}
            >
              <div className="df-register-row" data-testid={`v2-people-row-${row.userId}`}>
                <span className="df-project-mobile">
                  <span className="df-avatar" data-self={row.self ? "true" : "false"}>
                    {row.initials}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <MemberName row={row} />
                    <div className="df-mono df-meta">{subline(row)}</div>
                    <div className="df-mono df-meta">
                      {row.workspaceRole} · {row.status}
                      {row.access !== "-" ? ` · ${row.access}` : ""}
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
                <TableHead className="df-table-head" data-column="member">Member</TableHead>
                <TableHead className="df-table-head" data-column="role">Workspace role</TableHead>
                <TableHead className="df-table-head" data-column="access">Access</TableHead>
                <TableHead className="df-table-head" data-column="status">Status</TableHead>
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
                  data-state={row.state}
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
                        <MemberName row={row} />
                        <div className="df-mono df-meta">{subline(row)}</div>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="df-table-cell" data-column="role">
                    <span className="df-people-role">{row.workspaceRole}</span>
                  </TableCell>
                  <TableCell className="df-table-cell" data-column="access">
                    <span className="df-people-role">{row.access}</span>
                  </TableCell>
                  <TableCell className="df-table-cell" data-column="status">
                    <span className="df-people-role">{row.status}</span>
                  </TableCell>
                  <TableCell className="df-table-cell" data-column="actions">
                    <PeopleRowMenu {...rowMenuProps(row)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {invitationsFailed ? (
          <V2LoadFailed
            title="Invitations could not be loaded"
            copy="Something went wrong while loading them. Try again."
            onRetry={() => invitationsQuery.refetch()}
            testId="v2-people-invitations-failed"
          />
        ) : null}
      </section>
    </div>
  );
}

type PeopleRow = ReturnType<typeof composePeople>["rows"][number];

/** What sits under the name: a Member's address, or who sent the Invitation. */
function subline(row: PeopleRow): string {
  if (row.kind === "invitation") return row.invitedBy ? `Invited by ${row.invitedBy}` : "";
  return row.email;
}

function MemberName({ row }: { row: PeopleRow }) {
  return (
    <div className="df-row-title">
      {row.name}
      {row.self ? <span className="df-workday-you">You</span> : null}
    </div>
  );
}

/** One line for each role the choice offers, under the select. */
function RoleLines() {
  return (
    <div className="df-role-lines">
      {PEOPLE_ROLE_CHOICES.map(({ value, label, line }) => (
        <p key={value} className="df-note">
          <span className="df-role-name">{label}</span> {line}
        </p>
      ))}
    </div>
  );
}

/** Every row carries the same one control, so the columns line up and no row grows taller than another. */
function PeopleRowMenu({
  row,
  busy,
  onArchive,
  onRestore,
  onResend,
  onRevoke,
  onSettings,
}: {
  row: PeopleRow;
  busy: boolean;
  onArchive: (row: PeopleRow) => void;
  onRestore: (row: PeopleRow) => void;
  onResend: (row: PeopleRow) => void;
  onRevoke: (row: PeopleRow) => void;
  onSettings: (row: PeopleRow) => void;
}) {
  const items: V2RowMenuItem[] = row.actions.map((action) => {
    if (action === "settings") {
      return { label: "Member settings", testId: `v2-people-settings-${row.userId}`, onSelect: () => onSettings(row) };
    }
    if (action === "archive") {
      return { label: "Archive", testId: `v2-people-archive-${row.userId}`, onSelect: () => onArchive(row) };
    }
    if (action === "restore") {
      return { label: "Restore", testId: `v2-people-restore-${row.userId}`, onSelect: () => onRestore(row) };
    }
    if (action === "resend") {
      return { label: "Resend Invitation", testId: `v2-people-resend-${row.userId}`, onSelect: () => onResend(row) };
    }
    return { label: "Revoke Invitation", testId: `v2-people-revoke-${row.userId}`, onSelect: () => onRevoke(row) };
  });
  if (items.length === 0) return null;
  return (
    <span className="df-row-actions">
      <V2RowMenu
        ariaLabel={`Actions on ${row.name}`}
        testId={`v2-people-menu-${row.userId}`}
        items={items.map((item) => ({ ...item, disabled: busy }))}
      />
    </span>
  );
}
