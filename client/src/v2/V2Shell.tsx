import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import type { SafeUser } from "@shared/schema";
import { V2CommandBar } from "./V2CommandBar";
import { V2ContextPanel } from "./V2ContextPanel";
import { V2Rail } from "./V2Rail";
import { type V2CommandPanel, readRailCollapsed, writeRailCollapsed } from "./presentation";
import "./tokens.css";

const FONTSHARE_HREF =
  "https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=switzer@400,500,600,700&display=swap";

const V2ChromeContext = createContext<{ openPanel: (panel: V2CommandPanel) => void }>({
  openPanel: () => {},
});

export function useV2Chrome() {
  return useContext(V2ChromeContext);
}

export function V2Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(() =>
    typeof window === "undefined" ? false : readRailCollapsed(window.localStorage),
  );
  const [panel, setPanel] = useState<V2CommandPanel | null>(null);
  const { isRunning } = useTimeTracker();
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: projectsResponse } = useQuery<{ total?: number }>({
    queryKey: ["/api/crm/projects", "v2-count"],
    queryFn: () => fetch("/api/crm/projects?pageSize=1").then((res) => res.json()),
  });

  useEffect(() => {
    setPanel(null);
  }, [location]);

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

  const chrome = useMemo(() => ({ openPanel: (next: V2CommandPanel) => setPanel(next) }), []);
  const workspaceName = "Workspace";
  const memberCount = users.length;
  const projectCount = projectsResponse?.total ?? 0;

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
        data-page-primary="case-ink"
        data-timer-running={isRunning ? "true" : "false"}
        style={{ height: "100vh", display: "flex", overflow: "hidden" }}
      >
        <V2Rail
          collapsed={collapsed}
          onToggleCollapse={toggleRail}
          workspaceName={workspaceName}
          memberCount={memberCount}
          projectCount={projectCount}
        />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          <div style={{ flex: 1, minWidth: 1060, display: "flex", flexDirection: "column" }}>
            <V2CommandBar workspaceName={workspaceName} panel={panel} onPanel={setPanel} />
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <main style={{ flex: 1, minWidth: 0, overflowY: "auto", background: "var(--df-cold-stock)" }}>
                {children}
              </main>
              {panel ? <V2ContextPanel panel={panel} onClose={() => setPanel(null)} /> : null}
            </div>
          </div>
        </div>
      </div>
    </V2ChromeContext.Provider>
  );
}
