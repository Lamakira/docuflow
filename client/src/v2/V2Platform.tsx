import { useMemo, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { SafeUser } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { isStandingRefusal, notify } from "./notify";
import {
  PLATFORM_CONSOLE_LABEL,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "wouter";
import {
  BACK_OFFICE_HOME,
  backOfficeTabs,
  composeUserWorkspaces,
  parseBackOfficePath,
  platformUserWorkspacesPath,
  type PlatformUserWorkspace,
} from "./backOffice";
import { V2BackOfficeAccess } from "./V2BackOfficeAccess";
import { V2BackOfficeDisputes, V2BackOfficeSupportRequest } from "./V2BackOfficeDisputes";
import { V2BackOfficeStats } from "./V2BackOfficeStats";
import { V2BackOfficeSubscriptions, V2BackOfficeWorkspaces } from "./V2BackOfficeWorkspaces";
import { V2BackOfficeWorkspace } from "./V2BackOfficeWorkspace";
import { SkeletonRows } from "./V2Skeleton";
import { V2RowMenu } from "./V2RowMenu";

/** v1's `/admin`, `/admin/create` and `/admin/user/:id` (#266). */
export function V2LegacyAdminRedirect() {
  const { user } = useAuth();
  return <Redirect to={legacyAdminDestination(isPlatformAdmin(user))} />;
}

/**
 * The platform console (#266) and its back office (#314). Outside the Workspace
 * rail and above every Workspace. The tab and the page live in the path, so
 * every Workspace and Support Request is deep-linkable.
 */
export function V2PlatformPage() {
  const { user, isLoading: userLoading } = useAuth();
  const [location, navigate] = useLocation();
  const allowed = isPlatformAdmin(user);
  const parsed = parseBackOfficePath(location);

  if (userLoading) return null;
  if (!allowed) return <Redirect to="/" />;
  if (!parsed) return <Redirect to={BACK_OFFICE_HOME} />;
  if (location.replace(/\/+$/, "") === "/platform") return <Redirect to={BACK_OFFICE_HOME} />;

  const tabs = backOfficeTabs(parsed.tab);

  return (
    <div className="df-page" data-testid="v2-platform">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">{PLATFORM_CONSOLE_LABEL}</h1>
          <p className="df-subhead">
            Workspaces, billing, Support Requests and Users across the platform. Only Platform Staff see this console.
          </p>
        </div>
      </header>
      {/* Manual activation: arrowing across the tabs moves focus, not history. */}
      <Tabs
        value={parsed.tab}
        onValueChange={(next) => {
          const target = tabs.find((item) => item.id === next);
          if (target) navigate(target.href);
        }}
        activationMode="manual"
        className="df-admin-tabs"
      >
        <TabsList className="df-tabs" aria-label="Platform console">
          {tabs.map((item) => (
            <TabsTrigger key={item.id} value={item.id} className="df-tab" data-testid={`v2-platform-tab-${item.id}`}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="workspaces" className="df-admin-panel">
          {parsed.kind === "workspace" ? (
            <V2BackOfficeWorkspace key={parsed.workspaceId} workspaceId={parsed.workspaceId} />
          ) : (
            <V2BackOfficeWorkspaces />
          )}
        </TabsContent>
        <TabsContent value="users" className="df-admin-panel">
          <V2PlatformUsers />
        </TabsContent>
        <TabsContent value="subscriptions" className="df-admin-panel">
          <V2BackOfficeSubscriptions />
        </TabsContent>
        <TabsContent value="disputes" className="df-admin-panel">
          {parsed.kind === "support-request" ? (
            <V2BackOfficeSupportRequest key={parsed.requestId} requestId={parsed.requestId} />
          ) : (
            <V2BackOfficeDisputes />
          )}
        </TabsContent>
        <TabsContent value="stats" className="df-admin-panel">
          <V2BackOfficeStats />
        </TabsContent>
        <TabsContent value="access" className="df-admin-panel">
          <V2BackOfficeAccess />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** The User directory (#266), now the Users tab. Each row carries its own actions. */
function V2PlatformUsers() {
  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  const [filterQuery, setFilterQuery] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [showingWorkspaces, setShowingWorkspaces] = useState<{ id: string; name: string } | null>(null);
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

  return (
    <div data-testid="v2-platform-users">
      <div>
        <p className="df-subhead">{directory.subhead}</p>
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
                    items={[
                      {
                        label: "Show Workspaces",
                        testId: `v2-platform-${row.id}-workspaces`,
                        onSelect: () => setShowingWorkspaces({ id: row.id, name: row.name }),
                      },
                      ...row.actions.map((action) => ({
                        label: action.label,
                        danger: action.destructive,
                        disabled: pending,
                        testId: `v2-platform-${row.id}-${action.kind}`,
                        onSelect: () => run(row.id, action),
                      })),
                    ]}
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

      <UserWorkspacesSheet user={showingWorkspaces} onClose={() => setShowingWorkspaces(null)} />
    </div>
  );
}

/** The Workspaces one User belongs to, with the Workspace Role in each. */
function UserWorkspacesSheet({ user, onClose }: { user: { id: string; name: string } | null; onClose: () => void }) {
  const path = platformUserWorkspacesPath(user?.id ?? "");
  const { data: rows = [], isLoading } = useQuery<PlatformUserWorkspace[]>({
    queryKey: [path],
    enabled: user !== null,
    queryFn: () => apiRequest("GET", path),
  });
  const list = composeUserWorkspaces(rows);
  return (
    <Sheet open={user !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="df-v2" data-testid="v2-platform-user-workspaces">
        <SheetHeader>
          <SheetTitle>Workspaces of {user?.name}</SheetTitle>
          <SheetDescription>Each Workspace the User belongs to, and their Workspace Role in it.</SheetDescription>
        </SheetHeader>
        <div className="df-backoffice-lines">
          {isLoading ? <p className="df-empty df-flush">Loading Workspaces…</p> : null}
          {!isLoading && list.empty ? <p className="df-empty df-flush">{list.emptyCopy}</p> : null}
          {list.rows.map((row) => (
            <div key={row.id} className="df-backoffice-line">
              <Link href={row.href} className="df-row-title" onClick={onClose}>
                {row.name}
              </Link>
              <span className="df-mono df-meta">{row.archived ? `${row.role} · archived` : row.role}</span>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
