import { useMemo, useState } from "react";
import { Redirect } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { SafeUser } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function stamp(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate().toString().padStart(2, "0")} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

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
  const { user, isLoading: userLoading } = useAuth();
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const allowed = isPlatformAdmin(user);

  const { data: users = [], isLoading } = useQuery<SafeUser[]>({
    queryKey: [platformUsersPath(true)],
    enabled: allowed,
    queryFn: () => apiRequest("GET", platformUsersPath(true)),
  });
  const { data: detailRecord } = useQuery<SafeUser>({
    queryKey: [platformUserPath(selectedId ?? "")],
    enabled: allowed && Boolean(selectedId),
    queryFn: () => apiRequest("GET", platformUserPath(selectedId ?? "")),
  });

  const directory = useMemo(
    () =>
      composePlatformDirectory({
        users: users.map(toPlatformUser),
        currentUserId: user?.id ?? "",
        filterQuery,
        selectedId,
      }),
    [users, user?.id, filterQuery, selectedId],
  );

  const act = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: PlatformAction }) => {
      if (action.kind === "role") return apiRequest("PATCH", platformUserRolePath(userId), action.body);
      if (action.kind === "reset") return apiRequest("POST", platformUserResetPath(userId));
      return apiRequest("PATCH", platformUserArchivePath(userId), action.body);
    },
    onSuccess: (_result, { userId, action }) => {
      queryClient.invalidateQueries({ queryKey: [platformUsersPath(true)] });
      queryClient.invalidateQueries({ queryKey: [platformUserPath(userId)] });
      // Dropping your own platform role closes this console on the next read.
      if (userId === user?.id) queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setRefusal(null);
      setNotice(action.done);
    },
    onError: (error: Error) => {
      setNotice(null);
      setRefusal(chromeRefusal({ kind: "generic", message: error.message }));
    },
  });

  if (userLoading) return null;
  if (!allowed) return <Redirect to="/" />;

  const detail = directory.detail;

  return (
    <div className="df-library" data-testid="v2-platform">
      <div className="df-library-main">
        <header className="df-today-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="df-title">Platform console</h1>
            <p className="df-subhead">{directory.subhead}</p>
          </div>
        </header>

        <div className="df-filter-bar">
          <label className="df-filter-input">
            <Search width={14} height={14} strokeWidth={1.4} color="#59657A" />
            <input
              type="search"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Filter by name or email"
              aria-label="Filter Users"
            />
          </label>
        </div>
        {refusal ? <p className="df-refusal">{refusal}</p> : null}

        <section className="df-card df-platform-register" data-testid="v2-platform-register">
          <div className="df-register-head">
            <span>USER</span>
            <span>ROLE</span>
            <span>STATUS</span>
          </div>
          {isLoading ? (
            <div className="df-card" style={{ minHeight: 240, border: 0 }} />
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
                  setSelectedId(row.id);
                  setRefusal(null);
                  setNotice(null);
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
                  <span className="df-status">{row.superAdmin ? "SUPERADMIN" : row.role}</span>
                </span>
                <span className="df-mono df-meta">{row.archived ? "ARCHIVED" : "ACTIVE"}</span>
              </button>
            ))
          )}
          <div className="df-library-foot">
            <span>
              {directory.count} {directory.count === 1 ? "USER" : "USERS"}
            </span>
          </div>
        </section>
      </div>

      {detail ? (
        <aside className="df-panel df-folder-preview" data-testid="v2-platform-detail">
          <header className="df-panel-head">
            <div className="df-mono df-meta">USER</div>
            <div style={{ fontFamily: "var(--df-font-display)", fontWeight: 700, fontSize: 18 }}>{detail.name}</div>
            <div className="df-mono df-meta df-meta-follow">{detail.email}</div>
          </header>
          <div className="df-panel-scroll">
            <div className="df-kv">
              <span>ROLE</span>
              <span>{detail.superAdmin ? "SUPERADMIN" : detail.role}</span>
            </div>
            <div className="df-kv">
              <span>STATUS</span>
              <span>{detail.archived ? "ARCHIVED" : "ACTIVE"}</span>
            </div>
            <div className="df-kv">
              <span>LAST SIGN-IN</span>
              <span>{stamp(detailRecord?.lastLoginAt)}</span>
            </div>
            <div className="df-kv">
              <span>JOINED</span>
              <span>{stamp(detailRecord?.createdAt)}</span>
            </div>
            {detail.note ? <p className="df-empty df-flush">{detail.note}</p> : null}
            {notice ? <p className="df-prose df-prose-follow">{notice}</p> : null}
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

function PlatformActionControl({
  action,
  pending,
  onRun,
}: {
  action: PlatformAction;
  pending: boolean;
  onRun: () => void;
}) {
  const destructive = action.kind === "archive" || action.label === "Remove platform admin";
  if (!action.confirm) {
    return (
      <Button
        variant="outline"
        type="button"
        disabled={pending}
        onClick={onRun}
        className="df-btn"
        data-testid={`v2-platform-${action.kind}`}
      >
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
          className="df-btn"
          data-testid={`v2-platform-${action.kind}`}
        >
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
            onClick={onRun}
          >
            {action.label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
