import { useLocation } from "wouter";
import { SignIn } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, ArrowLeft } from "lucide-react";
import { useWebAuthConfig } from "@/lib/webAuthConfig";

/**
 * Sign-in (#110, ADR-0007). Clerk renders the form: DocuFlow no longer holds a
 * password field, because it no longer verifies passwords for the web. What is
 * still DocuFlow's is everything after the session — the Membership decides what
 * this User may do, and Clerk cannot grant Workspace authority.
 *
 * Replit OIDC stays until #111 removes it, so the button below still works for
 * anyone whose account has not been moved yet.
 */
export default function AuthPage() {
  const [, setLocation] = useLocation();
  const webAuth = useWebAuthConfig();

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

        {webAuth?.enabled ? (
          <div className="flex justify-center" data-testid="clerk-sign-in">
            {/* No sign-up link: self-service registration closed with #110, and
                a Clerk account nobody linked reaches no Workspace. An
                Administrator creates the User and the import links it. The
                Clerk instance should also have sign-up disabled (#107). */}
            <SignIn
              routing="hash"
              appearance={{ elements: { footerAction: { display: "none" } } }}
            />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Sign In</CardTitle>
              <CardDescription>
                {webAuth === null
                  ? "Loading sign-in…"
                  : "Sign-in is not configured for this deployment. Ask an administrator to check the identity provider settings."}
              </CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        )}

        <div className="mt-6 space-y-2">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => (window.location.href = "/api/login")}
            data-testid="button-replit-auth"
          >
            Continue with Replit
          </Button>
          <Button
            variant="ghost"
            onClick={() => setLocation("/")}
            className="text-muted-foreground w-full"
            data-testid="button-back-home"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to home
          </Button>
        </div>
      </div>
    </div>
  );
}
