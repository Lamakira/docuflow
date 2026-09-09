import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BellIcon, CloseIcon, SearchIcon, SparkleIcon } from "./icons";
import { V2TimerChip } from "./V2TimerChip";
import { motionForSurface } from "./motion";
import { type V2CommandPanel, breadcrumbFor } from "./presentation";

const SEARCH_MOTION = motionForSurface("search-overlay").enterExit;

type Panel = V2CommandPanel | null;

type V2CommandBarProps = {
  workspaceName: string;
  panel: Panel;
  onPanel: (panel: Panel) => void;
};

export function V2CommandBar({ workspaceName, panel, onPanel }: V2CommandBarProps) {
  const [location] = useLocation();
  const crumbs = breadcrumbFor(location, workspaceName);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: unread } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
  });
  const unreadCount = unread?.count ?? 0;

  return (
    <>
      <header className="df-command" data-testid="v2-command-bar">
        <nav className="df-crumb" style={{ display: "flex", alignItems: "center", gap: 7, color: "#59657A", whiteSpace: "nowrap" }}>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {index > 0 ? <span style={{ color: "#C3CAD4" }}>/</span> : null}
              {crumb.href ? (
                <Link href={crumb.href} style={{ color: "#59657A" }}>
                  {crumb.label}
                </Link>
              ) : (
                <span style={{ color: "#0F1524" }}>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        <button type="button" className="df-search" onClick={() => setSearchOpen(true)} data-testid="v2-search">
          <SearchIcon />
          <span style={{ flex: 1, textAlign: "left" }}>Search {workspaceName}</span>
          <span className="df-keycap">/</span>
        </button>

        <div style={{ flex: 1 }} />

        <V2TimerChip />

        <button
          type="button"
          className="df-ghost-btn"
          data-testid="v2-ask"
          onClick={() => onPanel(panel === "ask" ? null : "ask")}
        >
          <SparkleIcon />
          Ask DocuFlow
        </button>

        <button
          type="button"
          className="df-icon-btn"
          data-testid="v2-notifications"
          onClick={() => onPanel(panel === "notifications" ? null : "notifications")}
          aria-label="Notifications"
        >
          <BellIcon />
          {unreadCount > 0 ? <span className="df-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
        </button>
      </header>

      {searchOpen ? <SearchOverlay workspaceName={workspaceName} onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

export function SearchOverlay({ workspaceName, onClose }: { workspaceName: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: results = [] } = useQuery<Array<{ type: string; id: string; title: string; projectName?: string }>>({
    queryKey: ["/api/search", query],
    queryFn: () =>
      query.trim()
        ? fetch(`/api/search?q=${encodeURIComponent(query.trim())}`).then((res) => res.json())
        : Promise.resolve([]),
    enabled: query.trim().length > 0,
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <>
      <div className="df-overlay-scrim" data-motion={SEARCH_MOTION} onClick={onClose} />
      <div
        className="df-overlay"
        role="dialog"
        aria-label={`Search ${workspaceName}`}
        data-testid="v2-search-overlay"
        data-motion={SEARCH_MOTION}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid #D8DEE6" }}>
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${workspaceName}`}
            style={{
              flex: 1,
              border: 0,
              outline: "none",
              fontSize: 14,
              background: "transparent",
            }}
          />
          <button type="button" onClick={onClose} className="df-icon-btn" style={{ width: 28, height: 28 }} aria-label="Close search">
            <CloseIcon />
          </button>
        </div>
        <div>
          {results.map((result) => (
            <div
              key={`${result.type}-${result.id}`}
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 14px",
                borderBottom: "1px solid #EAEDF1",
              }}
            >
              <span className="df-mono" style={{ width: 74, fontSize: 10, color: "#59657A", textTransform: "uppercase" }}>
                {result.type}
              </span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{result.title}</div>
                {result.projectName ? (
                  <div className="df-mono" style={{ fontSize: 10, color: "#59657A", textTransform: "uppercase" }}>
                    {result.projectName}
                  </div>
                ) : null}
              </span>
            </div>
          ))}
        </div>
        <div className="df-mono" style={{ padding: "10px 14px", fontSize: 10, color: "#59657A", background: "#F3F5F7" }}>
          RESULTS FILTERED BY YOUR ACCESS
        </div>
      </div>
    </>
  );
}
