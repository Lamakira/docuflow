import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import type { SafeUser } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { V2AppBar } from "./V2AppBar";
import { V2CommandBar } from "./V2CommandBar";
import { V2ContextPanel } from "./V2ContextPanel";
import { V2Rail } from "./V2Rail";
import { V2TimerChip } from "./V2TimerChip";
import { V2ToastHost, type V2Toast } from "./V2Toast";
import { V2WorkspaceChooser } from "./V2WorkspaceChooser";
import { selectCommandPanel } from "./chrome";
import {
  chromeLayoutForViewport,
  contextSurface,
  readRailCollapsed,
  writeRailCollapsed,
  type V2ChromeLayout,
  type V2CommandPanel,
} from "./presentation";
import { motionForSurface } from "./motion";
import { invitationAcceptPath, myInvitationsPath } from "./people";
import { chooserInvitationRows, workspaceEntry, type MembershipsResponse, type PendingInvitationOption } from "./workspace";
import "./tokens.css";

const RAIL_DESTINATION_MOTION = motionForSurface("rail-destination").enterExit;
const WORKSPACE_SWITCH_MOTION = motionForSurface("workspace-switch").enterExit;

const FONTSHARE_HREF =
  "https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=switzer@400,500,600,700&display=swap";

const DESKTOP_LAYOUT = chromeLayoutForViewport(1280);

const V2ChromeContext = createContext<{
  openPanel: (panel: V2CommandPanel) => void;
  layout: V2ChromeLayout;
  memberships: MembershipsResponse | undefined;
  switchWorkspace: (workspaceId: string) => Promise<void>;
}>({
  openPanel: () => {},
  layout: DESKTOP_LAYOUT,
  memberships: undefined,
  switchWorkspace: async () => {},
});

export function useV2Chrome() {
  return useContext(V2ChromeContext);
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const sync = () => setWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  return width;
}

async function switchWorkspace(workspaceId: string): Promise<void> {
  await apiRequest("PUT", "/api/memberships/active", { workspaceId });
  await queryClient.invalidateQueries();
}

async function acceptPendingInvitation(token: string): Promise<void> {
  await apiRequest("POST", invitationAcceptPath(), { token });
  await queryClient.invalidateQueries();
}

export function V2Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(() =>
    typeof window === "undefined" ? false : readRailCollapsed(window.localStorage),
  );
  const [panel, setPanel] = useState<V2CommandPanel | null>(null);
  const [toast, setToast] = useState<V2Toast | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const width = useViewportWidth();
  const layout = chromeLayoutForViewport(width);
  const mobile = layout.mode === "mobile";
  const surface = contextSurface(panel, layout, location);
  const { isRunning, activeEntry } = useTimeTracker();
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: projectsResponse } = useQuery<{ total?: number }>({
    queryKey: ["/api/crm/projects", "v2-count"],
    queryFn: () => fetch("/api/crm/projects?pageSize=1").then((res) => res.json()),
  });
  const { data: memberships } = useQuery<MembershipsResponse>({
    queryKey: ["/api/memberships"],
  });
  const { data: invitations = [] } = useQuery<PendingInvitationOption[]>({
    queryKey: [myInvitationsPath()],
    enabled: Boolean(memberships),
  });

  useEffect(() => {
    setPanel(null);
    setNavOpen(false);
  }, [location]);

  useEffect(() => {
    if (!mobile) setNavOpen(false);
  }, [mobile]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPanel(null);
      setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (document.querySelector(`link[data-df-v2-fonts="true"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTSHARE_HREF;
    link.setAttribute("data-df-v2-fonts", "true");
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, []);

  const chrome = useMemo(
    () => ({
      openPanel: (next: V2CommandPanel) => {
        setNavOpen(false);
        setPanel((current) => selectCommandPanel(current, next));
      },
      layout,
      memberships,
      switchWorkspace,
    }),
    [layout, memberships],
  );
  const timerWorkspaceLabel =
    memberships?.memberships.find((row) => row.workspaceId === activeEntry?.workspaceId)?.workspaceName ??
    null;
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "Workspace";
  const memberCount = users.length;
  const projectCount = projectsResponse?.total ?? 0;
  const showRail = layout.rail === "fixed" || navOpen;
  const sheetOpen = surface.kind === "sheet";
  const entry = workspaceEntry({
    memberships: memberships?.memberships ?? [],
    lastActiveWorkspaceId: memberships?.preferredWorkspaceId ?? null,
    invitations,
  });
  const onInvitation = location.startsWith("/invitations/");

  function showToast(message: string, undo?: () => void) {
    setToast({ id: Date.now(), message, undo, state: "in" });
  }

  function dismissToast() {
    setToast((current) => (current ? { ...current, state: "leaving" } : null));
  }

  function selectPanel(next: V2CommandPanel | null) {
    setNavOpen(false);
    setPanel(next);
  }

  function toggleRail() {
    setCollapsed((currentCollapsed) => {
      const next = !currentCollapsed;
      writeRailCollapsed(window.localStorage, next);
      return next;
    });
  }

  if (onInvitation) {
    return <V2ChromeContext.Provider value={chrome}>{children}</V2ChromeContext.Provider>;
  }

  if (memberships && entry.kind === "chooser") {
    return (
      <V2ChromeContext.Provider value={chrome}>
        <V2WorkspaceChooser
          rows={entry.rows}
          invitations={chooserInvitationRows(invitations)}
          onChoose={(id) => void switchWorkspace(id)}
          onAccept={(token) => void acceptPendingInvitation(token)}
        />
      </V2ChromeContext.Provider>
    );
  }

  return (
    <V2ChromeContext.Provider value={chrome}>
      <div
        className="df-v2"
        data-testid="v2-shell"
        data-chrome={layout.mode}
        data-page-primary="case-ink"
        data-timer-running={isRunning ? "true" : "false"}
        data-sheet-open={sheetOpen ? "true" : "false"}
        style={{ height: "100vh", display: "flex", overflow: "hidden" }}
      >
        {mobile && navOpen ? (
          <button
            type="button"
            className="df-nav-scrim"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
        ) : null}
        {showRail ? (
          <V2Rail
            collapsed={layout.rail === "drawer" ? false : collapsed}
            onToggleCollapse={layout.rail === "drawer" ? () => setNavOpen(false) : toggleRail}
            workspaceName={workspaceName}
            memberCount={memberCount}
            projectCount={projectCount}
            drawer={layout.rail === "drawer"}
            memberships={memberships}
            timerWorkspaceId={activeEntry?.workspaceId ?? null}
            onSwitchWorkspace={(id) => void switchWorkspace(id)}
          />
        ) : null}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: mobile ? "hidden" : "auto",
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: layout.contentMinWidth ?? 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {layout.chrome === "app-bar" ? (
              <V2AppBar
                workspaceName={workspaceName}
                panel={panel}
                onPanel={selectPanel}
                onMenu={() => setNavOpen(true)}
              />
            ) : (
              <V2CommandBar
                workspaceName={workspaceName}
                panel={panel}
                onPanel={selectPanel}
                timerWorkspaceLabel={timerWorkspaceLabel}
                onToast={showToast}
              />
            )}
            <div className="df-chrome-body">
              <div className="df-stage">
                {layout.timer === "strip" ? (
                  <V2TimerChip variant="strip" workspaceLabel={timerWorkspaceLabel} onToast={showToast} />
                ) : null}
                <main className="df-main" data-motion={RAIL_DESTINATION_MOTION}>
                  <div
                    key={memberships?.activeWorkspaceId ?? "workspace"}
                    className="df-workspace-content"
                    data-motion={WORKSPACE_SWITCH_MOTION}
                    data-testid="v2-workspace-content"
                  >
                    {children}
                  </div>
                </main>
              </div>
              {panel && surface.kind !== "none" ? (
                <V2ContextPanel panel={panel} onClose={() => setPanel(null)} surface={surface.kind} />
              ) : null}
            </div>
          </div>
        </div>
        <V2ToastHost toast={toast} onDismiss={dismissToast} onGone={() => setToast(null)} />
      </div>
    </V2ChromeContext.Provider>
  );
}
