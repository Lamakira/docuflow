import { useEffect, useRef, useState } from "react";
import { Redirect } from "wouter";
import { SignIn, SignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWebAuthConfig } from "@/lib/webAuthConfig";
import { LoadingScreen } from "@/components/LoadingScreen";
import { signOutOfIdentityProvider } from "@/lib/identitySession";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  composeRegistration,
  registrationPath,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  type RegistrationStatus,
} from "@/lib/registration";

/**
 * Sign-in and sign-up (#110, #230, ADR-0007). Clerk renders both forms:
 * DocuFlow no longer holds a password field, because it no longer verifies
 * passwords for the web. What is still DocuFlow's is everything after the
 * session — the Membership decides what this User may do, and Clerk cannot
 * grant Workspace authority.
 */
export default function AuthPage() {
  return <ClerkFrame surface="sign-in" />;
}

/**
 * Flow 1, step 1 (#230). A visitor with no account and no Invitation starts
 * here. Self-service registration was closed by #110 because an account created
 * at Clerk's sign-up "would be a dead end"; #217 built what was behind the door,
 * and `POST /api/auth/user` is the step between.
 */
export function SignUpPage() {
  return <ClerkFrame surface="sign-up" />;
}

type Surface = "sign-in" | "sign-up";

function ClerkFrame({ surface }: { surface: Surface }) {
  const webAuth = useWebAuthConfig();
  if (!webAuth) return <LoadingScreen />;
  if (!webAuth.publishableKey) {
    return <AuthShell surface={surface} unconfigured />;
  }
  return <ClerkAuthPage surface={surface} />;
}

function ClerkAuthPage({ surface }: { surface: Surface }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { isAuthenticated, isLoading } = useAuth();

  if (!isLoaded || (isSignedIn && isLoading)) {
    return <AuthShell surface={surface} />;
  }

  if (isAuthenticated) {
    return <Redirect to="/" />;
  }

  if (isLoaded && isSignedIn && !isLoading) {
    return (
      <AuthShell surface={surface}>
        <RegisterIdentity />
      </AuthShell>
    );
  }

  return (
    <AuthShell surface={surface}>
      {surface === "sign-up" ? (
        <div className="flex justify-center" data-testid="clerk-sign-up">
          <SignUp
            routing="hash"
            signInUrl={SIGN_IN_PATH}
            forceRedirectUrl="/"
            fallbackRedirectUrl="/"
          />
        </div>
      ) : (
        <div className="flex justify-center" data-testid="clerk-sign-in">
          {/* The sign-up link is back (#230). It was hidden by #110 because an
              account created there reached no Workspace; #217 gave a User with
              no Membership one to name, and the Clerk instance has sign-up
              enabled again to match (#107). */}
          <SignIn
            routing="hash"
            signUpUrl={SIGN_UP_PATH}
            forceRedirectUrl={SIGN_IN_PATH}
            fallbackRedirectUrl={SIGN_IN_PATH}
          />
        </div>
      )}
    </AuthShell>
  );
}

/**
 * Flow 1, step 2. Clerk has vouched for this person and DocuFlow has no `User`
 * for them yet, so it makes one — once, on arrival, with no question to answer.
 * Before #230 this state was the dead end itself, and all it could offer was a
 * sign-out button.
 */
function RegisterIdentity() {
  const [status, setStatus] = useState<RegistrationStatus>("registering");
  const [message, setMessage] = useState<string | undefined>();
  // Strict Mode mounts twice in development, and the route is idempotent, but a
  // second POST would still race the first one's answer.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const user = await apiRequest("POST", registrationPath(), {});
        // The answer is seeded rather than invalidated on purpose. An
        // invalidate unmounts this component the moment the refetch starts, and
        // if that refetch were to come back null the router would mount it
        // again and it would POST again — a loop around an endpoint that
        // answers the same thing every time. The route returns the `SafeUser`
        // `GET /api/auth/user` would, so there is nothing to go and ask for.
        queryClient.setQueryData(["/api/auth/user"], user);
      } catch (error) {
        setStatus("failed");
        setMessage(error instanceof Error ? error.message : undefined);
      }
    })();
  }, []);

  const page = composeRegistration({ status, message });

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="registration-title">{page.title}</CardTitle>
        <CardDescription data-testid="registration-copy">{page.copy}</CardDescription>
      </CardHeader>
      <CardContent>
        {page.action === "sign-out" ? (
          <Button
            type="button"
            onClick={() => void signOutOfIdentityProvider()}
            data-testid="button-sign-out-unlinked"
          >
            Sign out
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AuthShell({
  children,
  surface,
  unconfigured = false,
}: {
  children?: React.ReactNode;
  surface: Surface;
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
          <p className="text-muted-foreground text-center">
            {surface === "sign-up" ? "Start your Workspace" : "Welcome back"}
          </p>
        </div>

        {unconfigured ? (
          <Card>
            <CardHeader>
              <CardTitle>{surface === "sign-up" ? "Sign Up" : "Sign In"}</CardTitle>
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
