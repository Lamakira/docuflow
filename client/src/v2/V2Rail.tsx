import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { signOutOfIdentityProvider } from "@/lib/identitySession";
import { queryClient } from "@/lib/queryClient";
import { composeAccountMenu } from "./chrome";
import {
  CloseIcon,
  CollapseIcon,
  KebabIcon,
  RailIcon,
  SwapIcon,
} from "./icons";
import {
  V2_FOOTER_NAV,
  V2_NAV,
  memberCountLabel,
  navIdForPath,
  workspaceInitials,
  workspaceRoleLabel,
} from "./presentation";
import { workspaceSwitcher, type MembershipOption, type MembershipsResponse } from "./workspace";

type V2RailProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  workspaceName: string;
  memberCount: number;
  projectCount: number;
  drawer?: boolean;
  memberships?: MembershipsResponse;
  timerWorkspaceId?: string | null;
  onSwitchWorkspace?: (workspaceId: string) => void;
};

export function V2Rail({
  collapsed,
  onToggleCollapse,
  workspaceName,
  memberCount,
  projectCount,
  drawer = false,
  memberships,
  timerWorkspaceId = null,
  onSwitchWorkspace,
}: V2RailProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const account = composeAccountMenu({ theme });
  const activeId = navIdForPath(location);
  const initials = workspaceInitials(workspaceName);
  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email || "User";
  const userInitials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
      : (user?.email?.[0] ?? "U").toUpperCase();
  const role = user
    ? workspaceRoleLabel({ role: user.role, owner: user.isMainAdmin === 1 })
    : "MEMBER";

  async function handleSignOut() {
    try {
      queryClient.cancelQueries();
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] !== "/api/auth/user",
      });
      await signOutOfIdentityProvider();
      window.location.href = "/auth";
    } catch {
      window.location.href = "/auth";
    }
  }

  return (
    <aside
      className="df-rail"
      data-collapsed={collapsed ? "true" : "false"}
      data-drawer={drawer ? "true" : "false"}
      data-testid="v2-rail"
    >
      <div className="df-rail-head">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
          }}
        >
          {!collapsed ? <span className="df-brand">DocuFlow</span> : null}
          <button
            type="button"
            title={drawer ? "Close navigation" : collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={onToggleCollapse}
            style={{ display: "flex", padding: 3, borderRadius: 5, background: "transparent", border: 0, cursor: "pointer" }}
            data-testid="v2-rail-collapse"
          >
            {drawer ? <CloseIcon /> : <CollapseIcon />}
          </button>
        </div>

        {collapsed ? (
          <div
            title={workspaceName}
            className="df-tile"
            style={{ width: 32, height: 32, borderRadius: 6, fontSize: 11, alignSelf: "center" }}
          >
            {initials}
          </div>
        ) : (
          <WorkspaceSelector
            name={workspaceName}
            initials={initials}
            memberCount={memberCount}
            memberships={memberships}
            timerWorkspaceId={timerWorkspaceId}
            onSwitchWorkspace={onSwitchWorkspace}
          />
        )}
      </div>

      <nav className="df-rail-body" aria-label="Workspace">
        {V2_NAV.map((section, index) => (
          <div
            key={section.label ?? `section-${index}`}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              borderTop: section.separated ? "1px solid #D8DEE6" : undefined,
              paddingTop: section.separated ? 10 : undefined,
            }}
          >
            {!collapsed && section.label ? (
              <div className="df-group-label">{section.label}</div>
            ) : null}
            {section.items.map((item) => {
              const active = activeId === item.id;
              const count =
                item.countKey === "projects"
                  ? projectCount
                  : item.countKey === "people"
                    ? memberCount
                    : undefined;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="df-rail-item df-nav"
                  data-active={active ? "true" : "false"}
                  title={item.label}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: collapsed ? "center" : undefined,
                      gap: collapsed ? 0 : 10,
                      minWidth: 0,
                    }}
                  >
                    <RailIcon id={item.id} color={active ? "#0F1524" : "#59657A"} />
                    {!collapsed ? (
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.label}
                      </span>
                    ) : null}
                  </span>
                  {!collapsed && count != null ? (
                    <span className="df-mono" style={{ fontSize: 10, color: "#59657A" }}>
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="df-rail-foot">
        {V2_FOOTER_NAV.map((item) => {
          const active = activeId === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              className="df-rail-item df-nav"
              data-active={active ? "true" : "false"}
              title={item.label}
              style={collapsed ? undefined : { padding: "6px 9px", fontSize: 13, fontWeight: 500 }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: collapsed ? 0 : 10 }}>
                <RailIcon id={item.id} color={active ? "#0F1524" : "#59657A"} />
                {!collapsed ? <span>{item.label}</span> : null}
              </span>
            </Link>
          );
        })}

        <details>
          <summary
            className="df-user-card"
            title={displayName}
            style={{ listStyle: "none" }}
          >
            <span
              className="df-tile"
              style={{ width: 26, height: 26, borderRadius: "50%", fontSize: 10, fontWeight: 500 }}
            >
              {userInitials}
            </span>
            {!collapsed ? (
              <>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {displayName}
                  </span>
                  <span className="df-mono" style={{ fontSize: 9.5, color: "#59657A" }}>
                    {role}
                  </span>
                </span>
                <KebabIcon />
              </>
            ) : null}
          </summary>
          <div className="df-menu" style={{ marginTop: 6 }} data-testid="v2-account-menu">
            {account.themeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTheme(option.id)}
                data-selected={option.selected ? "true" : "false"}
                data-testid={`v2-theme-${option.id}`}
              >
                {option.label}
              </button>
            ))}
            <button type="button" onClick={handleSignOut} data-testid="v2-sign-out">
              {account.signOutLabel}
            </button>
          </div>
        </details>
      </div>
    </aside>
  );
}

function WorkspaceSelector({
  name,
  initials,
  memberCount,
  memberships,
  timerWorkspaceId,
  onSwitchWorkspace,
}: {
  name: string;
  initials: string;
  memberCount: number;
  memberships?: MembershipsResponse;
  timerWorkspaceId: string | null;
  onSwitchWorkspace?: (workspaceId: string) => void;
}) {
  const switcher = workspaceSwitcher({
    memberships: memberships?.memberships ?? [
      { workspaceId: "active", workspaceName: name, workspaceRole: "MEMBER", condition: null },
    ],
    activeWorkspaceId: memberships?.activeWorkspaceId ?? "active",
    timerWorkspaceId,
  });

  return (
    <details>
      <summary className="df-ws" style={{ listStyle: "none" }} data-testid="v2-workspace-selector">
        <span className="df-tile" style={{ width: 22, height: 22, borderRadius: 4, fontSize: 10 }}>
          {initials}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {name}
          </span>
          <span className="df-mono" style={{ fontSize: 9.5, color: "#59657A" }}>
            {memberCountLabel(memberCount)}
          </span>
        </span>
        <SwapIcon />
      </summary>
      <div className="df-menu df-ws-menu" style={{ marginTop: 6 }} data-testid="v2-workspace-menu">
        {switcher.rows.map((row) => (
          <WorkspaceRow
            key={row.workspaceId}
            row={row}
            onSwitch={row.active ? undefined : onSwitchWorkspace}
          />
        ))}
      </div>
    </details>
  );
}

function WorkspaceRow({
  row,
  onSwitch,
}: {
  row: MembershipOption & { active: boolean; timer: boolean };
  onSwitch?: (workspaceId: string) => void;
}) {
  const initials = workspaceInitials(row.workspaceName);
  return (
    <button
      type="button"
      disabled={row.active || !onSwitch}
      onClick={() => onSwitch?.(row.workspaceId)}
      data-testid={`v2-workspace-${row.workspaceId}`}
    >
      <span className="df-tile" style={{ width: 18, height: 18, borderRadius: 4, fontSize: 8 }}>
        {initials}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", textAlign: "left" }}>
        <span>{row.workspaceName}</span>
        <span className="df-mono" style={{ fontSize: 9, color: "#59657A" }}>
          {row.workspaceRole}
          {row.condition ? ` · ${row.condition}` : ""}
        </span>
      </span>
      {row.active ? (
        <span className="df-mono" style={{ fontSize: 9, color: "#1F9D6B" }}>
          Active
        </span>
      ) : row.timer ? (
        <span className="df-mono" style={{ fontSize: 9, color: "#E9A23B" }}>
          TIMER
        </span>
      ) : null}
    </button>
  );
}
