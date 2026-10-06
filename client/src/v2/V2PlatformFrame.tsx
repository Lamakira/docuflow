import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { signOutOfIdentityProvider } from "@/lib/identitySession";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { composeAccountMenu, type AccountTheme } from "./chrome";
import { composePlatformFrame } from "./backOffice";
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

/**
 * The platform console's own frame (ADR-0015): a header and a body, with no
 * rail, Workspace switcher, timer, plan banner or command bar.
 */
export function V2PlatformFrame({ children }: { children: React.ReactNode }) {
  useV2Fonts();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
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

  return (
    <div className="df-v2 df-platform-frame" data-testid="v2-platform-frame" data-page-primary="case-ink">
      <header className="df-platform-header">
        <div className="df-platform-brand">
          <span className="df-brand">{frame.brand}</span>
          <span className="df-platform-title">{frame.title}</span>
        </div>
        <div className="df-platform-account">
          <span className="df-mono df-platform-email" data-testid="v2-platform-email">
            {frame.email}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="df-btn" data-testid="v2-platform-account-menu">
                Account
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="df-v2 df-menu" data-testid="v2-account-menu">
              <DropdownMenuRadioGroup
                value={account.themeOptions.find((option) => option.selected)?.id ?? "light"}
                onValueChange={(value) => setTheme(value as AccountTheme)}
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
        </div>
      </header>
      <main className="df-platform-body">{children}</main>
    </div>
  );
}
