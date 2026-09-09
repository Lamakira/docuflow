import { workspaceInitials } from "./presentation";
import type { MembershipOption } from "./workspace";

export function V2WorkspaceChooser({
  rows,
  onChoose,
}: {
  rows: MembershipOption[];
  onChoose: (workspaceId: string) => void;
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
        </div>
      </div>
    </div>
  );
}
