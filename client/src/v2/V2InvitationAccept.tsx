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
    <div className="df-v2" data-testid="v2-invitation-accept" style={{ height: "100vh", display: "flex" }}>
      <div
        style={{
          margin: "auto",
          width: "min(420px, calc(100% - 32px))",
          background: "#fff",
          border: "1px solid #D8DEE6",
          borderRadius: 10,
          padding: 22,
        }}
      >
        <div className="df-mono" style={{ fontSize: 10, color: "#59657A", letterSpacing: "0.08em" }}>
          INVITATION
        </div>
        <h1 className="df-title" style={{ fontSize: 26, margin: "6px 0 12px" }}>
          {page.title}
        </h1>
        <p className="df-subhead" style={{ marginBottom: 16 }}>
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
          <button
            type="button"
            className="df-ink-btn"
            disabled={accept.isPending || !token}
            data-testid="v2-invitation-accept-submit"
            onClick={() => accept.mutate()}
          >
            Accept Invitation
          </button>
        ) : null}
        {page.action === "today" ? (
          <button type="button" className="df-ink-btn" onClick={() => setLocation("/")}>
            Continue to Today
          </button>
        ) : null}
      </div>
    </div>
  );
}
