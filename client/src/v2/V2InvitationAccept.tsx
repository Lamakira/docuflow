import { useEffect, useState } from "react";
import { SignIn, useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { signOutOfIdentityProvider } from "@/lib/identitySession";
import {
  composeInvitationPage,
  invitationAcceptPath,
  invitationAcceptRefusal,
  invitationLookupPath,
  invitationPagePath,
  type InvitationLookup,
} from "./people";
import { notify } from "./notify";
import { APP_NAME } from "./presentation";
import { V2LoadFailed } from "./V2EmptyState";
import "./tokens.css";
import { Button } from "@/components/ui/button";

function tokenFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "invitations") return "";
  return decodeURIComponent(parts[1] ?? "");
}

export function V2InvitationAcceptPage() {
  const [location, setLocation] = useLocation();
  const token = tokenFromPath(location);
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user: identity } = useUser();
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Invitation - ${APP_NAME}`;
    return () => {
      document.title = APP_NAME;
    };
  }, []);

  // No session is needed to read an Invitation; a 404 is an answer, any other failure is not.
  const lookup = useQuery<InvitationLookup | null>({
    queryKey: [invitationLookupPath(), token],
    enabled: Boolean(token),
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch(invitationLookupPath(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to read the Invitation");
      return res.json();
    },
  });

  const accept = useMutation({
    mutationFn: () => apiRequest("POST", invitationAcceptPath(), { token }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      notify.success("Invitation accepted");
      setLocation("/");
    },
    onError: (error: Error) => setRefusal(invitationAcceptRefusal(error.message, lookup.data?.invitedBy ?? null)),
  });

  async function switchAccount() {
    await signOutOfIdentityProvider();
    window.location.assign(invitationPagePath(token));
  }

  const waiting = !isLoaded || (Boolean(token) && lookup.isLoading);
  const failed = Boolean(token) && lookup.isError;
  const page = composeInvitationPage({
    lookup: lookup.data ?? null,
    signedIn: Boolean(isSignedIn),
    signedInEmail: identity?.primaryEmailAddress?.emailAddress ?? null,
  });

  return (
    <div className="df-v2 df-gate" data-testid="v2-invitation-accept">
      <div className="df-gate-card">
        <div className="df-mono" style={{ fontSize: 10, color: "var(--df-archive-slate)" }}>
          Invitation
        </div>
        {waiting ? (
          <p className="df-note" role="status">
            Loading…
          </p>
        ) : failed ? (
          <V2LoadFailed
            title="The Invitation could not be loaded"
            copy="Something went wrong while loading it. Try again."
            onRetry={() => lookup.refetch()}
            testId="v2-invitation-load-failed"
          />
        ) : (
          <>
            <h1 className="df-title df-title-follow">{page.title}</h1>
            <p className="df-subhead df-subhead-follow">{page.copy}</p>
            {page.detail ? <p className="df-note">{page.detail}</p> : null}
            {refusal ? (
              <p className="df-refusal" role="alert" data-testid="v2-invitation-refusal">
                {refusal}
              </p>
            ) : null}
            {page.action === "sign-in" ? (
              <div data-testid="v2-invitation-sign-in">
                <SignIn
                  routing="hash"
                  forceRedirectUrl={invitationPagePath(token)}
                  fallbackRedirectUrl={invitationPagePath(token)}
                  signUpForceRedirectUrl={invitationPagePath(token)}
                  signUpFallbackRedirectUrl={invitationPagePath(token)}
                />
              </div>
            ) : null}
            {page.action === "accept" ? (
              <Button
                variant="default"
                type="button"
                disabled={accept.isPending}
                data-testid="v2-invitation-accept-submit"
                onClick={() => {
                  setRefusal(null);
                  accept.mutate();
                }}
                className="df-btn"
              >
                {page.actionLabel}
              </Button>
            ) : null}
            {page.action === "switch" ? (
              <span className="df-cluster">
                <Button variant="default" type="button" data-testid="v2-invitation-switch" onClick={() => void switchAccount()} className="df-btn">
                  {page.actionLabel}
                </Button>
                <Button variant="outline" type="button" onClick={() => setLocation("/")} className="df-btn">
                  Go to DocuFlow
                </Button>
              </span>
            ) : null}
            {page.action === "go" || page.action === "open" ? (
              <Button variant="default" type="button" onClick={() => setLocation("/")} className="df-btn">
                {page.actionLabel}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
