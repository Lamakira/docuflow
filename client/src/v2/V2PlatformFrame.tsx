import { useState } from "react";
import { Link } from "wouter";
import {
  Building2,
  BarChart3,
  ChevronsUpDown,
  CreditCard,
  KeyRound,
  LifeBuoy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { signOutOfIdentityProvider } from "@/lib/identitySession";
import { queryClient } from "@/lib/queryClient";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { composeAccountMenu } from "./chrome";
import { V2ThemeToggle } from "./V2ThemeToggle";
import { backOfficeTabs, composePlatformFrame, type BackOfficeTabId } from "./backOffice";
import { PLATFORM_CONSOLE_LABEL } from "./platform";
import { readRailCollapsed, writeRailCollapsed } from "./presentation";
import { useV2Fonts } from "./useV2Fonts";
import type { MembershipsResponse } from "./workspace";
import "./tokens.css";

async function signOut() {
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

const TAB_ICON: Record<BackOfficeTabId, LucideIcon> = {
  workspaces: Building2,
  users: Users,
  subscriptions: CreditCard,
  disputes: LifeBuoy,
  stats: BarChart3,
  access: KeyRound,
};

/** The collapsed state survives a reload, like the Workspace rail's; storage may be blocked. */
function readCollapsed(): boolean {
  try {
    return readRailCollapsed(window.localStorage);
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    writeRailCollapsed(window.localStorage, collapsed);
  } catch {
    // Storage is blocked: the rail still collapses, it just forgets.
  }
}

/**
 * The platform console's own frame (ADR-0015): a vertical rail and a body, with
 * no Workspace switcher, timer, plan banner or command bar. The rail is the
 * shadcn Sidebar, dressed like the Workspace rail.
 */
export function V2PlatformFrame({ activeTab, children }: { activeTab: BackOfficeTabId; children: React.ReactNode }) {
  useV2Fonts();
  const [open, setOpen] = useState(() => !readCollapsed());

  return (
    <SidebarProvider
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        writeCollapsed(!next);
      }}
      className="df-v2 df-platform-frame"
      data-testid="v2-platform-frame"
      data-page-primary="case-ink"
    >
      <PlatformRail activeTab={activeTab} />
      <div className="df-platform-column">
        <header className="df-platform-topbar" data-testid="v2-platform-topbar">
          <SidebarTrigger className="df-platform-rail-trigger" data-testid="v2-platform-rail-open" />
          <span className="df-brand">DocuFlow</span>
        </header>
        <SidebarInset className="df-platform-body">{children}</SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function PlatformRail({ activeTab }: { activeTab: BackOfficeTabId }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  // Read the way V2Shell does; an error or an empty list hides "Open DocuFlow".
  const { data: memberships } = useQuery<MembershipsResponse>({
    queryKey: ["/api/memberships"],
    retry: 3,
    retryDelay: (attempt) => 500 * 2 ** attempt,
  });
  const frame = composePlatformFrame({
    email: user?.email,
    hasMembership: (memberships?.memberships?.length ?? 0) > 0,
  });
  const account = composeAccountMenu({ theme, platformAdmin: false });
  const tabs = backOfficeTabs(activeTab);

  return (
    <Sidebar collapsible="icon" className="df-v2 df-platform-rail" data-testid="v2-platform-rail">
      <SidebarHeader className="df-platform-rail-head" data-collapsed={collapsed ? "true" : "false"}>
        {collapsed ? (
          <span className="df-brand" aria-label={frame.brand}>
            D
          </span>
        ) : (
          <div className="df-platform-brand">
            <span className="df-brand">{frame.brand}</span>
            <span className="df-platform-title">{frame.title}</span>
          </div>
        )}
        {isMobile ? null : <SidebarTrigger className="df-platform-rail-trigger" data-testid="v2-platform-rail-collapse" />}
      </SidebarHeader>

      <SidebarContent className="df-platform-rail-body">
        <nav aria-label={PLATFORM_CONSOLE_LABEL}>
          <SidebarMenu>
            {tabs.map((item) => {
              const Icon = TAB_ICON[item.id];
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={item.current}
                    tooltip={{ children: item.label, className: "df-v2" }}
                    className="df-platform-nav-item"
                  >
                    <Link
                      href={item.href}
                      aria-current={item.current ? "page" : undefined}
                      data-testid={`v2-platform-tab-${item.id}`}
                    >
                      <Icon strokeWidth={1.5} aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarContent>

      <SidebarFooter className="df-platform-rail-foot">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="df-platform-account"
                  title={frame.email}
                  aria-label={`Account, ${frame.email}`}
                  data-testid="v2-platform-account-menu"
                >
                  <span className="df-platform-avatar" aria-hidden="true">
                    {(frame.email[0] ?? "S").toUpperCase()}
                  </span>
                  {collapsed ? null : (
                    <>
                      <span className="df-mono df-platform-email" data-testid="v2-platform-email">
                        {frame.email}
                      </span>
                      <ChevronsUpDown width={14} height={14} strokeWidth={1.5} aria-hidden="true" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "top" : "right"}
                align="end"
                className="df-v2 df-menu"
                data-testid="v2-account-menu"
              >
                <V2ThemeToggle />
                <DropdownMenuSeparator className="df-menu-separator" />
                {frame.showOpenDocuFlow ? (
                  <DropdownMenuItem asChild className="df-menu-item">
                    <Link href={frame.openDocuFlowHref} data-testid="v2-platform-open-docuflow">
                      {frame.openDocuFlowLabel}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="df-menu-item" data-testid="v2-sign-out" onSelect={() => void signOut()}>
                  {account.signOutLabel}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
