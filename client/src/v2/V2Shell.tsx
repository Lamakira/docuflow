import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import type { SafeUser } from "@shared/schema";
import { V2AppBar } from "./V2AppBar";
import { V2CommandBar } from "./V2CommandBar";
import { V2ContextPanel } from "./V2ContextPanel";
import { V2Rail } from "./V2Rail";
import { V2TimerChip } from "./V2TimerChip";
import {
  chromeLayoutForViewport,
  contextSurface,
  readRailCollapsed,
  writeRailCollapsed,
  type V2ChromeLayout,
  type V2CommandPanel,
} from "./presentation";
import { motionForSurface } from "./motion";
import "./tokens.css";

const RAIL_DESTINATION_MOTION = motionForSurface("rail-destination").enterExit;

const FONTSHARE_HREF =
  "https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=switzer@400,500,600,700&display=swap";

const DESKTOP_LAYOUT = chromeLayoutForViewport(1280);

const V2ChromeContext = createContext<{
  openPanel: (panel: V2CommandPanel) => void;
  layout: V2ChromeLayout;
}>({
  openPanel: () => {},
  layout: DESKTOP_LAYOUT,
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

export function V2Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(() =>
    typeof window === "undefined" ? false : readRailCollapsed(window.localStorage),
  );
  const [panel, setPanel] = useState<V2CommandPanel | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const width = useViewportWidth();
  const layout = chromeLayoutForViewport(width);
  const mobile = layout.mode === "mobile";
  const surface = contextSurface(panel, layout, location);
  const { isRunning } = useTimeTracker();
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: projectsResponse } = useQuery<{ total?: number }>({
    queryKey: ["/api/crm/projects", "v2-count"],
    queryFn: () => fetch("/api/crm/projects?pageSize=1").then((res) => res.json()),
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
        setPanel(next);
      },
      layout,
    }),
    [layout],
  );
  const workspaceName = "Workspace";
  const memberCount = users.length;
  const projectCount = projectsResponse?.total ?? 0;
  const showRail = layout.rail === "fixed" || navOpen;
  const sheetOpen = surface.kind === "sheet";

  function selectPanel(next: V2CommandPanel | null) {
    setNavOpen(false);
    setPanel(next);
  }

  function toggleRail() {
    setCollapsed((current) => {
      const next = !current;
      writeRailCollapsed(window.localStorage, next);
      return next;
    });
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
              <V2CommandBar workspaceName={workspaceName} panel={panel} onPanel={selectPanel} />
            )}
            <div className="df-chrome-body">
              <div className="df-stage">
                {layout.timer === "strip" ? <V2TimerChip variant="strip" /> : null}
                <main className="df-main" data-motion={RAIL_DESTINATION_MOTION}>
                  {children}
                </main>
              </div>
              {panel && surface.kind !== "none" ? (
                <V2ContextPanel panel={panel} onClose={() => setPanel(null)} surface={surface.kind} />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </V2ChromeContext.Provider>
  );
}
