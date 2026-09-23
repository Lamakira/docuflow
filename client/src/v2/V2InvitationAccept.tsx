import { useState } from "react";
import { SignIn, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  composeInvitationAccept,
  invitationAcceptPath,
  invitationPagePath,
  type InvitationAcceptStatus,
} from "./people";
import "./tokens.css";
import { Button } from "@/components/ui/button";

function tokenFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "invitations") return "";
  return decodeURIComponent(parts[1] ?? "");
}

function statusFromMessage(message: string): InvitationAcceptStatus {
  const lower = message.toLowerCase();
  if (lower.includes("revoked")) return "revoked";
  if (lower.includes("expired")) return "expired";
  if (lower.includes("already accepted")) return "already";
  if (lower.includes("different email")) return "mismatch";
  if (lower.includes("unauthorized")) return "unauthorized";
  return "error";
}

export function V2InvitationAcceptPage() {
  const [location, setLocation] = useLocation();
  const token = tokenFromPath(location);
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [status, setStatus] = useState<InvitationAcceptStatus>("ready");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const accept = useMutation({
    mutationFn: () => apiRequest("POST", invitationAcceptPath(), { token }),
    onSuccess: async () => {
      setStatus("accepted");
      await queryClient.invalidateQueries();
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: Error) => {
      setStatus(statusFromMessage(error.message));
      setErrorMessage(error.message);
    },
  });

  const page = composeInvitationAccept({
    signedIn: Boolean(isSignedIn),
    status,
    message: errorMessage,
  });

  return (
    <div className="df-v2 df-gate" data-testid="v2-invitation-accept">
      <div className="df-gate-card">
        <div className="df-mono" style={{ fontSize: 10, color: "var(--df-archive-slate)", letterSpacing: "0.08em" }}>
          INVITATION
        </div>
        <h1 className="df-title df-title-follow">
          {page.title}
        </h1>
        <p className="df-subhead df-subhead-follow">
          {page.copy}
        </p>
        {!isLoaded ? <p className="df-empty">Loading…</p> : null}
        {isLoaded && page.action === "sign-in" ? (
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
          <Button variant="default" type="button" disabled={accept.isPending || !token} data-testid="v2-invitation-accept-submit" onClick={() => accept.mutate()} className="df-btn">
            Accept Invitation
          </Button>
        ) : null}
        {page.action === "today" ? (
          <Button variant="default" type="button" onClick={() => setLocation("/")} className="df-btn">
            Continue to Today
          </Button>
        ) : null}
      </div>
    </div>
  );
}
