import { useQuery } from "@tanstack/react-query";
import { CloseIcon } from "./icons";
import type { NotificationWithDetails } from "@shared/schema";
import type { V2CommandPanel } from "./presentation";
import { EMPTY_TIMESHEET_APPROVALS } from "./today";

export function V2ContextPanel({
  panel,
  onClose,
}: {
  panel: V2CommandPanel;
  onClose: () => void;
}) {
  const title =
    panel === "ask" ? "Ask DocuFlow" : panel === "approvals" ? EMPTY_TIMESHEET_APPROVALS.title : "Notifications";
  const kicker =
    panel === "ask" ? "ASK" : panel === "approvals" ? EMPTY_TIMESHEET_APPROVALS.kicker : "INBOX";

  const { data: notifications = [] } = useQuery<NotificationWithDetails[]>({
    queryKey: ["/api/notifications"],
    enabled: panel === "notifications",
  });

  return (
    <aside className="df-panel" data-testid={`v2-panel-${panel}`}>
      <header
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #D8DEE6",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="df-mono" style={{ fontSize: 10, color: "#59657A", letterSpacing: "0.08em" }}>
            {kicker}
          </div>
          <div style={{ fontFamily: "var(--df-font-display)", fontWeight: 700, fontSize: 18 }}>{title}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close panel" style={{ background: "transparent", border: 0, cursor: "pointer", padding: 4 }}>
          <CloseIcon />
        </button>
      </header>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {panel === "approvals" ? (
          <p style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "62ch", color: "#59657A" }}>
            {EMPTY_TIMESHEET_APPROVALS.copy}
          </p>
        ) : panel === "ask" ? (
          <p style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "62ch", color: "#59657A" }}>
            Ask about records in this Workspace. Answers stay on this panel and honor Document Access.
          </p>
        ) : notifications.length === 0 ? (
          <p style={{ fontSize: 14, lineHeight: 1.55, color: "#59657A" }}>No notifications yet.</p>
        ) : (
          notifications.map((notification) => (
            <div
              key={notification.id}
              style={{
                display: "grid",
                gridTemplateColumns: "74px 1fr auto",
                gap: 12,
                padding: "13px 0",
                borderBottom: "1px solid #EAEDF1",
              }}
            >
              <span className="df-mono" style={{ fontSize: 10, color: "#59657A", textTransform: "uppercase" }}>
                {notification.type}
              </span>
              <span style={{ fontWeight: 500, fontSize: 13.5 }}>
                {notification.message || "Notification"}
              </span>
              <span className="df-mono" style={{ fontSize: 10, color: "#59657A" }}>
                {notification.createdAt
                  ? new Date(notification.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
