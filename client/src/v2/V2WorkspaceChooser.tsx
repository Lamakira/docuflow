import { Link } from "wouter";
import { workspaceInitials } from "./presentation";
import type { ChooserInvitationRow, MembershipOption } from "./workspace";

export function V2WorkspaceChooser({
  rows,
  invitations = [],
  newWorkspaceHref,
  onChoose,
  onAccept,
}: {
  rows: MembershipOption[];
  invitations?: ChooserInvitationRow[];
  /** Flow 4: creating another Workspace is secondary here, never the default. */
  newWorkspaceHref?: string;
  onChoose: (workspaceId: string) => void;
  onAccept?: (token: string) => void;
}) {
  return (
    <div className="df-v2 df-chooser" data-testid="v2-workspace-chooser" style={{ height: "100vh", display: "flex" }}>
      <div
        style={{
          margin: "auto",
          width: "min(420px, calc(100% - 32px))",
          background: "#fff",
          border: "1px solid #D8DEE6",
          borderRadius: 10,
          padding: 22,
        }}
      >
        <div className="df-mono" style={{ fontSize: 10, color: "#59657A", letterSpacing: "0.08em" }}>
          WORKSPACE
        </div>
        <h1 className="df-title" style={{ fontSize: 26, margin: "6px 0 16px" }}>
          Choose a Workspace
        </h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((row) => (
            <button
              key={row.workspaceId}
              type="button"
              className="df-ws"
              data-testid={`v2-chooser-${row.workspaceId}`}
              onClick={() => onChoose(row.workspaceId)}
              style={{ width: "100%", textAlign: "left" }}
            >
              <span className="df-tile" style={{ width: 22, height: 22, borderRadius: 4, fontSize: 10 }}>
                {workspaceInitials(row.workspaceName)}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{row.workspaceName}</span>
                <span className="df-mono" style={{ fontSize: 9.5, color: "#59657A" }}>
                  {row.workspaceRole}
                  {row.condition ? ` · ${row.condition}` : ""}
                </span>
              </span>
            </button>
          ))}
          {invitations.map((row) => (
            <button
              key={row.id}
              type="button"
              className="df-ws"
              data-testid={`v2-chooser-invitation-${row.id}`}
              onClick={() => onAccept?.(row.token)}
              style={{ width: "100%", textAlign: "left" }}
            >
              <span className="df-tile" style={{ width: 22, height: 22, borderRadius: 4, fontSize: 10 }}>
                {workspaceInitials(row.workspaceName)}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{row.workspaceName}</span>
                <span className="df-mono" style={{ fontSize: 9.5, color: "#59657A" }}>
                  Invitation · {row.workspaceRole}
                </span>
              </span>
              <span className="df-ghost-link">Accept</span>
            </button>
          ))}
        </div>
        {newWorkspaceHref ? (
          <Link
            href={newWorkspaceHref}
            className="df-ghost-link df-chooser-new"
            data-testid="v2-chooser-new-workspace"
          >
            Create a Workspace
          </Link>
        ) : null}
      </div>
    </div>
  );
}
