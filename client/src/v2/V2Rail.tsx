import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { signOutOfIdentityProvider } from "@/lib/identitySession";
import { queryClient } from "@/lib/queryClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

  useEffect(() => {
    if (theme === "dark") setTheme("light");
  }, [theme, setTheme]);
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
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceRole = current?.workspaceRole ?? "";
  const role = current ? workspaceRoleLabel(current.workspaceRole) : "";

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
        <div className="df-rail-brand">
          {!collapsed ? <span className="df-brand">DocuFlow</span> : null}
          <button
            type="button"
            className="df-rail-collapse"
            title={drawer ? "Close navigation" : collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={onToggleCollapse}
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
            className="df-rail-section"
            data-separated={section.separated ? "true" : "false"}
          >
            {!collapsed && section.label ? (
              <div className="df-group-label">{section.label}</div>
            ) : null}
            {section.items.filter((item) => item.reach?.(workspaceRole) !== false).map((item) => {
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
                  <span className="df-rail-label">
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
            >
              <span className="df-rail-label">
                <RailIcon id={item.id} color={active ? "#0F1524" : "#59657A"} />
                {!collapsed ? <span>{item.label}</span> : null}
              </span>
            </Link>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="df-user-card"
              title={displayName}
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
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className={`df-v2 df-menu${collapsed ? "" : " df-menu-match-trigger"}`}
            data-testid="v2-account-menu"
          >
            {account.structure.map((part) => {
              if (part === "theme") {
                return (
                  <DropdownMenuRadioGroup
                    key={part}
                    value={account.themeOptions.find((option) => option.selected)?.id ?? "light"}
                    onValueChange={(value) => setTheme(value === "system" ? "system" : "light")}
                  >
                    {account.themeOptions.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.id}
                        value={option.id}
                        className="df-menu-item"
                        data-testid={`v2-theme-${option.id}`}
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                );
              }
              if (part === "separator") {
                return <DropdownMenuSeparator key={part} className="df-menu-separator" />;
              }
              if (part === "account") {
                return (
                  <DropdownMenuItem key={part} asChild className="df-menu-item">
                    <Link href="/account" data-testid="v2-account-link">
                      {account.accountLabel}
                    </Link>
                  </DropdownMenuItem>
                );
              }
              return (
                <DropdownMenuItem
                  key={part}
                  className="df-menu-item"
                  data-testid="v2-sign-out"
                  onSelect={() => void handleSignOut()}
                >
                  {account.signOutLabel}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="df-ws" data-testid="v2-workspace-selector">
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
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="df-v2 df-menu df-menu-match-trigger" data-testid="v2-workspace-menu">
        {switcher.others.map((row) => (
          <WorkspaceRow
            key={row.workspaceId}
            row={row}
            onSwitch={onSwitchWorkspace}
          />
        ))}
        {/* Flow 4: a secondary action, under the Workspaces it belongs beside. */}
        <DropdownMenuSeparator className="df-menu-separator" />
        <DropdownMenuItem asChild className="df-menu-item">
          <Link href="/workspaces/new" data-testid="v2-new-workspace">
            Create a Workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <DropdownMenuItem
      className="df-menu-item"
      disabled={!onSwitch}
      onSelect={() => onSwitch?.(row.workspaceId)}
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
      {row.timer ? (
        <span className="df-mono" style={{ fontSize: 9, color: "#E9A23B" }}>
          TIMER
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
