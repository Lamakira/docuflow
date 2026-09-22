import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { SafeUser } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motionForSurface } from "./motion";
import {
  WORKSPACE_NAME_MAX,
  composeFirstWorkspace,
  suggestedWorkspaceName,
  workspacesPath,
  type FirstWorkspaceStatus,
} from "./lifecycle";
import "./tokens.css";
import { Button } from "@/components/ui/button";

const CREATED_MOTION = motionForSurface("first-workspace-created").enterExit;

/**
 * Flow 1, steps 3–4. One field, one action, a default the User can keep.
 * The Trial starts with the Workspace (Flow 5) — there is no card step to show
 * and no plan to pick. Clerk owns everything before this screen (ADR-0007).
 */
export function V2FirstWorkspace({ belongedBefore = false }: { belongedBefore?: boolean } = {}) {
  const [, setLocation] = useLocation();
  const { data: user } = useQuery<SafeUser | null>({ queryKey: ["/api/auth/user"] });
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<FirstWorkspaceStatus>("ready");
  const [message, setMessage] = useState<string | undefined>();

  // The default follows the identity, and stops following once it is edited.
  useEffect(() => {
    if (touched) return;
    setName(suggestedWorkspaceName(user));
  }, [user, touched]);

  const page = composeFirstWorkspace({ name, status, message, belongedBefore });

  async function create() {
    if (!page.canSubmit) return;
    setStatus("creating");
    setMessage(undefined);
    try {
      await apiRequest("POST", workspacesPath(), { name: name.trim() });
      setStatus("created");
      // The new Workspace is now the active one, so every Workspace-scoped read
      // in the shell is stale — the same sweep a Workspace switch does.
      await queryClient.invalidateQueries();
      setLocation("/");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : undefined);
    }
  }

  return (
    <div className="df-v2 df-first-workspace df-gate" data-testid="v2-first-workspace">
      <div
        className="df-first-workspace-card"
        data-motion={status === "created" ? CREATED_MOTION : "none"}
        data-testid="v2-first-workspace-card"
      >
        <div className="df-mono df-first-workspace-kicker">{page.kicker}</div>
        <h1 className="df-title df-title-follow">
          {page.title}
        </h1>
        <p className="df-subhead df-subhead-follow">
          {page.copy}
        </p>

        <form
          className="df-first-workspace-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="df-first-workspace-label" htmlFor="v2-workspace-name">
            {page.fieldLabel}
          </label>
          <input
            id="v2-workspace-name"
            name="workspaceName"
            value={name}
            autoComplete="off"
            maxLength={WORKSPACE_NAME_MAX}
            data-testid="v2-first-workspace-name"
            onChange={(event) => {
              setTouched(true);
              setName(event.target.value);
              if (status === "error") setStatus("ready");
            }}
          />
          {page.error ? (
            <p className="df-first-workspace-error" data-testid="v2-first-workspace-error">
              {page.error}
            </p>
          ) : null}
          <Button variant="default" type="submit" disabled={!page.canSubmit} data-testid="v2-first-workspace-submit" className="df-btn">
            {page.action}
          </Button>
        </form>

        <p className="df-first-workspace-trial" data-testid="v2-first-workspace-trial">
          {page.trialNote}
        </p>
        {/* Flow 2: a User whose every Membership was archived lands here too.
            The account is fine, and an Invitation is the other way back in. */}
        <p className="df-first-workspace-trial" data-testid="v2-first-workspace-invitation">
          {page.invitationNote}
        </p>
      </div>
    </div>
  );
}
