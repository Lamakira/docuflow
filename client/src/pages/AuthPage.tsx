import { Redirect } from "wouter";
import { SignIn, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWebAuthConfig } from "@/lib/webAuthConfig";
import { LoadingScreen } from "@/components/LoadingScreen";
import { signOutOfIdentityProvider } from "@/lib/identitySession";

/**
 * Sign-in (#110, ADR-0007). Clerk renders the form: DocuFlow no longer holds a
 * password field, because it no longer verifies passwords for the web. What is
 * still DocuFlow's is everything after the session — the Membership decides what
 * this User may do, and Clerk cannot grant Workspace authority.
 */
export default function AuthPage() {
  const webAuth = useWebAuthConfig();
  if (!webAuth) return <LoadingScreen />;
  if (!webAuth.publishableKey) {
    return <AuthShell unconfigured />;
  }
  return <ClerkAuthPage />;
}

function ClerkAuthPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { isAuthenticated, isLoading } = useAuth();

  if (!isLoaded || (isSignedIn && isLoading)) {
    return <AuthShell />;
  }

  if (isAuthenticated) {
    return <Redirect to="/" />;
  }

  if (isLoaded && isSignedIn && !isLoading) {
    return (
      <AuthShell>
        <Card>
          <CardHeader>
            <CardTitle>Session Clerk active</CardTitle>
            <CardDescription>
              Clerk knows you, but DocuFlow has no matching User. Sign out and
              try again, or ask an Administrator to link this email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              onClick={() => void signOutOfIdentityProvider()}
              data-testid="button-sign-out-unlinked"
            >
              Sign out
            </Button>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex justify-center" data-testid="clerk-sign-in">
        {/* No sign-up link: self-service registration closed with #110, and
            a Clerk account nobody linked reaches no Workspace. An
            Administrator creates the User and the import links it. The
            Clerk instance should also have sign-up disabled (#107). */}
        <SignIn
          routing="hash"
          forceRedirectUrl="/auth"
          fallbackRedirectUrl="/auth"
          appearance={{ elements: { footerAction: { display: "none" } } }}
        />
      </div>
    </AuthShell>
  );
}

function AuthShell({
  children,
  unconfigured = false,
}: {
  children?: React.ReactNode;
  unconfigured?: boolean;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-primary">
              <FileText className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold">DocuFlow</span>
          </div>
          <p className="text-muted-foreground text-center">Welcome back</p>
        </div>

        {unconfigured ? (
          <Card>
            <CardHeader>
              <CardTitle>Sign In</CardTitle>
              <CardDescription>
                Sign-in is not configured for this deployment. Ask an administrator to check the identity provider settings.
              </CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
