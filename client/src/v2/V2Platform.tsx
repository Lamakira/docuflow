import { useMemo, useState } from "react";
import { Redirect } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
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
  platformUserResetPath,
  platformUserRolePath,
  platformUsersPath,
  toPlatformUser,
  type PlatformAction,
} from "./platform";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SkeletonRows } from "./V2Skeleton";
import { V2RowMenu } from "./V2RowMenu";

/** v1's `/admin`, `/admin/create` and `/admin/user/:id` (#266). */
export function V2LegacyAdminRedirect() {
  const { user } = useAuth();
  return <Redirect to={legacyAdminDestination(isPlatformAdmin(user))} />;
}

/**
 * The platform console (#266). Outside the Workspace rail and above every
 * Workspace: the directory is `users`, which ADR-0025 keeps on the global role.
 * Each row carries its own actions. There is no side panel.
 */
export function V2PlatformPage() {
  const now = useMemo(() => new Date(), []);
  const { user, isLoading: userLoading } = useAuth();
  const [filterQuery, setFilterQuery] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ userId: string; action: PlatformAction } | null>(null);
  const allowed = isPlatformAdmin(user);

  const { data: users = [], isLoading } = useQuery<SafeUser[]>({
    queryKey: [platformUsersPath()],
    enabled: allowed,
    queryFn: () => apiRequest("GET", platformUsersPath()),
  });

  const directory = useMemo(
    () =>
      composePlatformDirectory({
        now,
        users: users.map(toPlatformUser),
        currentUserId: user?.id ?? "",
        filterQuery,
      }),
    [now, users, user?.id, filterQuery],
  );

  const act = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: PlatformAction }) => {
      if (action.kind === "role") return apiRequest("PATCH", platformUserRolePath(userId), action.body);
      if (action.kind === "reset") return apiRequest("POST", platformUserResetPath(userId));
      return apiRequest("PATCH", platformUserArchivePath(userId), action.body);
    },
    onSuccess: (_result, { userId, action }) => {
      queryClient.invalidateQueries({ queryKey: [platformUsersPath()] });
      // Dropping your own platform role closes this console on the next read.
      if (userId === user?.id) queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setRefusal(null);
      setConfirming(null);
      if (action.done) notify.success(action.done);
    },
    onError: (error: Error) => {
      if (!isStandingRefusal(error)) return notify.error(error);
      setRefusal(chromeRefusal({ kind: "generic", message: error.message }));
    },
  });

  const pending = act.isPending;

  function run(userId: string, action: PlatformAction) {
    if (action.confirm) {
      setConfirming({ userId, action });
      return;
    }
    act.mutate({ userId, action });
  }

  if (userLoading) return null;
  if (!allowed) return <Redirect to="/" />;

  return (
    <div className="df-library" data-testid="v2-platform">
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
            <span />
          </div>
          {isLoading ? (
            <SkeletonRows columns={6} rows={6} />
          ) : directory.empty ? (
            <p className="df-empty">{directory.emptyCopy}</p>
          ) : (
            directory.rows.map((row) => (
              <div
                key={row.id}
                className="df-register-row"
                data-archived={row.archived ? "true" : "false"}
                data-testid={`v2-platform-row-${row.id}`}
                title={row.note ?? undefined}
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
                <span className="df-mono df-meta">{row.lastSignIn}</span>
                <span className="df-mono df-meta">{row.joined}</span>
                <span className="df-row-actions">
                  <V2RowMenu
                    ariaLabel={`Actions on ${row.name}`}
                    testId={`v2-platform-menu-${row.id}`}
                    items={row.actions.map((action) => ({
                      label: action.label,
                      danger: action.destructive,
                      disabled: pending,
                      testId: `v2-platform-${row.id}-${action.kind}`,
                      onSelect: () => run(row.id, action),
                    }))}
                  />
                </span>
              </div>
            ))
          )}
          <div className="df-library-foot">
            <span>{directory.countLabel}</span>
          </div>
        </section>
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent className="df-v2 df-alert">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.action.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirming?.action.consequence}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="df-btn" autoFocus>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={
                confirming?.action.destructive
                  ? "df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "df-btn"
              }
              data-testid={`v2-platform-${confirming?.action.kind}-confirm`}
              disabled={pending}
              onClick={() => {
                if (confirming) act.mutate(confirming);
              }}
            >
              {pending ? "Working…" : confirming?.action.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
