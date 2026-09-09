import { useQuery } from "@tanstack/react-query";
import { CloseIcon } from "./icons";
import type { NotificationWithDetails } from "@shared/schema";
import type { V2ChromeLayout, V2CommandPanel } from "./presentation";
import { EMPTY_TIMESHEET_APPROVALS } from "./today";

export function V2ContextPanel({
  panel,
  onClose,
  surface = "side-panel",
}: {
  panel: V2CommandPanel;
  onClose: () => void;
  surface?: V2ChromeLayout["context"];
}) {
  const title =
    panel === "ask" ? "Ask DocuFlow" : panel === "approvals" ? EMPTY_TIMESHEET_APPROVALS.title : "Notifications";
  const kicker =
    panel === "ask" ? "ASK" : panel === "approvals" ? EMPTY_TIMESHEET_APPROVALS.kicker : "INBOX";
  const sheet = surface === "sheet";

  const { data: notifications = [] } = useQuery<NotificationWithDetails[]>({
    queryKey: ["/api/notifications"],
    enabled: panel === "notifications",
  });

  return (
    <aside
      className={sheet ? "df-sheet" : "df-panel"}
      data-testid={sheet ? `v2-sheet-${panel}` : `v2-panel-${panel}`}
      aria-label={title}
    >
      {sheet ? (
        <button type="button" className="df-sheet-handle" aria-label="Close" onClick={onClose} />
      ) : null}
      <header
        style={{
          padding: sheet ? "12px 16px 13px" : "14px 16px",
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
          <div
            style={{
              fontFamily: "var(--df-font-display)",
              fontWeight: 700,
              fontSize: sheet ? 19 : 18,
            }}
          >
            {title}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          style={{ background: "transparent", border: 0, cursor: "pointer", padding: 4 }}
        >
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
      {sheet ? (
        <div className="df-sheet-foot">
          <button type="button" className="df-ghost-btn df-sheet-btn" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
    </aside>
  );
}
