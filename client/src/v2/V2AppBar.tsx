import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellIcon, MenuIcon, SearchIcon } from "./icons";
import { SearchOverlay } from "./V2CommandBar";
import { selectCommandPanel } from "./chrome";
import { workspaceInitials, type V2CommandPanel } from "./presentation";

type V2AppBarProps = {
  workspaceName: string;
  panel: V2CommandPanel | null;
  onPanel: (panel: V2CommandPanel | null) => void;
  onMenu: () => void;
};

export function V2AppBar({ workspaceName, panel, onPanel, onMenu }: V2AppBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const initials = workspaceInitials(workspaceName);
  const { data: unread } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
  });
  const unreadCount = unread?.count ?? 0;

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

  return (
    <>
      <header className="df-app-bar" data-testid="v2-app-bar">
        <button type="button" className="df-app-icon" onClick={onMenu} aria-label="Open navigation" data-testid="v2-menu">
          <MenuIcon />
        </button>
        <span className="df-tile" style={{ width: 22, height: 22, borderRadius: 4, fontSize: 9.5 }}>
          {initials}
        </span>
        <span className="df-app-ws">{workspaceName}</span>
        <button
          type="button"
          className="df-app-icon"
          onClick={() => setSearchOpen(true)}
          aria-label={`Search ${workspaceName}`}
          data-testid="v2-search"
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className="df-app-icon"
          data-testid="v2-notifications"
          aria-label="Notifications"
          onClick={() => onPanel(selectCommandPanel(panel, "notifications"))}
        >
          <BellIcon />
          {unreadCount > 0 ? <span className="df-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
        </button>
      </header>
      {searchOpen ? <SearchOverlay workspaceName={workspaceName} onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}
