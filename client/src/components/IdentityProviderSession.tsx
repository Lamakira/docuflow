import { useEffect, useRef } from "react";
import { ClerkProvider, useAuth as useClerkAuth, useOrganization } from "@clerk/clerk-react";
import { queryClient } from "@/lib/queryClient";
import { LoadingScreen } from "@/components/LoadingScreen";
import { setIdentitySignOut, setIdentityTokenProvider } from "@/lib/identitySession";
import { useWebAuthConfig } from "@/lib/webAuthConfig";

/**
 * Mounts the IdentityProvider for the whole SPA (#110, ADR-0007).
 *
 * Clerk owns the credential, the sign-in flow, MFA and session rotation; this
 * component only makes the resulting session token reachable by the `/api/*`
 * calls the rest of the app already makes, and tells react-query to re-ask who
 * the User is whenever that session appears or goes away.
 *
 * Nothing renders until both the deployment's key and Clerk itself have loaded.
 * Rendering earlier would send the first `/api/auth/user` without a token, and
 * the app would paint the signed-out shell for every returning User.
 */

/** Wires the token into `/api/*` and keeps `useAuth()` in step with Clerk. */
function BridgeToApi({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const { organization } = useOrganization();

  // Set during render rather than in an effect, and the `isLoaded` guard below
  // does not make that unnecessary: children first render in the same commit as
  // `isLoaded` turning true, and React runs a child's effects before its
  // parent's — so an effect here would still be too late for the app's very
  // first `/api/auth/user`, which would then paint the signed-out shell for a
  // User who is signed in. Both calls are idempotent module-level assignments,
  // with no React state behind them.
  setIdentityTokenProvider(async () => {
    try {
      return await getToken();
    } catch {
      // A session Clerk will not vouch for is no session; the API answers as it
      // does for anyone signed out rather than the page breaking.
      return null;
    }
  });
  setIdentitySignOut(async () => {
    await signOut();
  });

  // Signing in or out changes who `/api/auth/user` answers for, and every
  // Workspace-scoped query behind it. Clerk Organization selection is a session
  // task that finishes after the first `/api/auth/user` may already have run
  // without a token; that query is cached as null (and window-focus refetch is
  // off), so a later active session would otherwise keep painting Landing.
  const lastSignedIn = useRef<boolean | null>(null);
  const lastOrgId = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoaded) return;
    const signedIn = Boolean(isSignedIn);
    const orgId = organization?.id ?? null;
    const wasSignedIn = lastSignedIn.current;
    const wasOrgId = lastOrgId.current;
    lastSignedIn.current = signedIn;
    lastOrgId.current = orgId;

    if (wasSignedIn === true && signedIn === false) {
      queryClient.clear();
      return;
    }
    if (signedIn && (wasSignedIn !== true || wasOrgId !== orgId)) {
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    }
  }, [isLoaded, isSignedIn, organization?.id]);

  if (!isLoaded) return <LoadingScreen />;
  return <>{children}</>;
}

export function IdentityProviderSession({ children }: { children: React.ReactNode }) {
  const webAuth = useWebAuthConfig();

  if (!webAuth) return <LoadingScreen />;

  // No key to mount against: the app still runs, and `AuthPage` explains why
  // nobody can sign in. Mounting `ClerkProvider` without a key throws.
  if (!webAuth.publishableKey) return <>{children}</>;

  return (
    <ClerkProvider
      publishableKey={webAuth.publishableKey}
      afterSignOutUrl="/"
      signInForceRedirectUrl="/auth"
      signInFallbackRedirectUrl="/auth"
      taskUrls={{ "choose-organization": "/auth" }}
    >
      <BridgeToApi>{children}</BridgeToApi>
    </ClerkProvider>
  );
}
