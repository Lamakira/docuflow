import { useMemo, useState, type KeyboardEvent } from "react";
import { Redirect } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Calendar,
  Circle,
  Clock,
  Mail,
  Search,
  Shield,
  ShieldOff,
  ShieldPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SafeUser } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { isStandingRefusal, notify } from "./notify";
import {
  composePlatformDirectory,
  isPlatformAdmin,
  legacyAdminDestination,
  platformUserArchivePath,
  platformUserPath,
  platformUserResetPath,
  platformUserRolePath,
  platformUsersPath,
  toPlatformUser,
  type PlatformAction,
} from "./platform";
import { Button } from "@/components/ui/button";
import { V2PreviewHead } from "./V2PreviewHead";
import { focusPreviewOpener, previewClosesOnKey, togglePreviewSelection } from "./previewPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SkeletonRows } from "./V2Skeleton";

const ICON = { width: 14, height: 14, strokeWidth: 1.4, "aria-hidden": true } as const;

/** v1's `/admin`, `/admin/create` and `/admin/user/:id` (#266). */
export function V2LegacyAdminRedirect() {
  const { user } = useAuth();
  return <Redirect to={legacyAdminDestination(isPlatformAdmin(user))} />;
}

/**
 * The platform console (#266). Outside the Workspace rail and above every
 * Workspace: the directory is `users`, which ADR-0025 keeps on the global role.
 */
export function V2PlatformPage() {
  const now = useMemo(() => new Date(), []);
  const { user, isLoading: userLoading } = useAuth();
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const allowed = isPlatformAdmin(user);

  const { data: users = [], isLoading } = useQuery<SafeUser[]>({
    queryKey: [platformUsersPath()],
    enabled: allowed,
    queryFn: () => apiRequest("GET", platformUsersPath()),
  });

  const listed = useMemo(
    () =>
      composePlatformDirectory({
        now,
        users: users.map(toPlatformUser),
        currentUserId: user?.id ?? "",
        filterQuery,
        selectedId,
      }),
    [now, users, user?.id, filterQuery, selectedId],
  );

  // The detail route refuses the SuperAdmin to every other platform admin; the
  // composer says so, and the page does not ask (#266).
  const { data: detailRecord } = useQuery<SafeUser>({
    queryKey: [platformUserPath(selectedId ?? "")],
    enabled: allowed && Boolean(selectedId) && listed.detail?.readable === true,
    queryFn: () => apiRequest("GET", platformUserPath(selectedId ?? "")),
  });

  // A fresher detail read replaces the listed row for the selected User.
  const directory = useMemo(
    () =>
      detailRecord
        ? composePlatformDirectory({
            now,
            users: users.map((row) => toPlatformUser(row.id === detailRecord.id ? detailRecord : row)),
            currentUserId: user?.id ?? "",
            filterQuery,
            selectedId,
          })
        : listed,
    [detailRecord, listed, now, users, user?.id, filterQuery, selectedId],
  );

  const act = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: PlatformAction }) => {
      if (action.kind === "role") return apiRequest("PATCH", platformUserRolePath(userId), action.body);
      if (action.kind === "reset") return apiRequest("POST", platformUserResetPath(userId));
      return apiRequest("PATCH", platformUserArchivePath(userId), action.body);
    },
    onSuccess: (_result, { userId, action }) => {
      queryClient.invalidateQueries({ queryKey: [platformUsersPath()] });
      queryClient.invalidateQueries({ queryKey: [platformUserPath(userId)] });
      // Dropping your own platform role closes this console on the next read.
      if (userId === user?.id) queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setRefusal(null);
      if (action.done) notify.success(action.done);
    },
    onError: (error: Error) => {
      if (!isStandingRefusal(error)) return notify.error(error);
      setRefusal(chromeRefusal({ kind: "generic", message: error.message }));
    },
  });

  if (userLoading) return null;
  if (!allowed) return <Redirect to="/" />;

  const detail = directory.detail;

  function closeDetail() {
    const opener = selectedId;
    setSelectedId(null);
    if (opener) focusPreviewOpener(`[data-testid="v2-platform-row-${opener}"]`);
  }

  // Action confirmations are portalled, so their Escape never reaches here.
  function onDirectoryKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const closes = previewClosesOnKey({
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      previewOpen: Boolean(detail),
      focusInPage: event.currentTarget.contains(event.target as Node),
      dialogOpen: false,
    });
    if (!closes) return;
    event.preventDefault();
    closeDetail();
  }

  return (
    <div className="df-library" data-testid="v2-platform" onKeyDown={onDirectoryKeyDown}>
      <div className="df-library-main">
        <header className="df-today-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="df-title">{directory.title}</h1>
            <p className="df-subhead">{directory.subhead}</p>
          </div>
        </header>

        <div className="df-filter-bar">
          <label className="df-filter-input">
            <Search width={14} height={14} strokeWidth={1.4} style={{ color: "var(--df-archive-slate)" }} />
            <input
              type="search"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder={directory.filterPlaceholder}
              aria-label="Filter Users"
            />
          </label>
        </div>
        {refusal ? <p className="df-refusal">{refusal}</p> : null}

        <section className="df-card df-platform-register" data-testid="v2-platform-register">
          <div className="df-register-head">
            {directory.columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          {isLoading ? (
            <SkeletonRows columns={3} rows={6} />
          ) : directory.empty ? (
            <p className="df-empty">{directory.emptyCopy}</p>
          ) : (
            directory.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="df-register-row"
                data-selected={row.selected ? "true" : "false"}
                data-archived={row.archived ? "true" : "false"}
                data-testid={`v2-platform-row-${row.id}`}
                onClick={() => {
                  setSelectedId((current) => togglePreviewSelection(current, row.id));
                  setRefusal(null);
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <div className="df-row-title">
                    {row.name}
                    {row.self ? <span className="df-mono df-meta"> · YOU</span> : null}
                  </div>
                  <div className="df-mono df-meta">{row.email}</div>
                </span>
                <span>
                  <span className="df-status">{row.role}</span>
                </span>
                <span className="df-mono df-meta">{row.status}</span>
              </button>
            ))
          )}
          <div className="df-library-foot">
            <span>{directory.countLabel}</span>
          </div>
        </section>
      </div>

      {detail ? (
        <aside className="df-panel df-folder-preview df-platform-detail" data-testid="v2-platform-detail">
          <V2PreviewHead kicker="USER" title={detail.name} meta={detail.email} onClose={closeDetail} />
          <div className="df-panel-scroll">
            <div className="df-kv">
              <span className="df-kv-label"><Shield {...ICON} /> ROLE</span>
              <span>{detail.role}</span>
            </div>
            <div className="df-kv">
              <span className="df-kv-label">{detail.archived ? <Archive {...ICON} /> : <Circle {...ICON} />} STATUS</span>
              <span>{detail.status}</span>
            </div>
            <div className="df-kv">
              <span className="df-kv-label"><Clock {...ICON} /> LAST SIGN-IN</span>
              <span>{detail.lastSignIn}</span>
            </div>
            <div className="df-kv">
              <span className="df-kv-label"><Calendar {...ICON} /> JOINED</span>
              <span>{detail.joined}</span>
            </div>
            {detail.note ? <p className="df-empty df-flush">{detail.note}</p> : null}
          </div>
          {detail.actions.length > 0 ? (
            <footer className="df-panel-foot df-platform-actions">
              {detail.actions.map((action) => (
                <PlatformActionControl
                  key={action.kind}
                  action={action}
                  pending={act.isPending}
                  onRun={() => act.mutate({ userId: detail.id, action })}
                />
              ))}
            </footer>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

function ActionIcon({ action }: { action: PlatformAction }) {
  const Icon: LucideIcon =
    action.kind === "reset"
      ? Mail
      : action.kind === "archive"
        ? Archive
        : action.kind === "restore"
          ? ArchiveRestore
          : action.destructive
            ? ShieldOff
            : ShieldPlus;
  return <Icon {...ICON} />;
}

function PlatformActionControl({
  action,
  pending,
  onRun,
}: {
  action: PlatformAction;
  pending: boolean;
  onRun: () => void;
}) {
  const { destructive } = action;
  if (!action.confirm) {
    return (
      <Button
        variant="outline"
        type="button"
        disabled={pending}
        onClick={onRun}
        className="df-btn df-platform-action"
        data-testid={`v2-platform-${action.kind}`}
      >
        <ActionIcon action={action} />
        {action.label}
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={destructive ? "destructiveOutline" : "outline"}
          type="button"
          disabled={pending}
          className="df-btn df-platform-action"
          data-testid={`v2-platform-${action.kind}`}
        >
          <ActionIcon action={action} />
          {action.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="df-v2 df-alert">
        <AlertDialogHeader>
          <AlertDialogTitle>{action.title}</AlertDialogTitle>
          <AlertDialogDescription>{action.consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="df-btn" autoFocus>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={
              destructive
                ? "df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "df-btn"
            }
            data-testid={`v2-platform-${action.kind}-confirm`}
            disabled={pending}
            onClick={onRun}
          >
            {pending ? "Working…" : action.label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
