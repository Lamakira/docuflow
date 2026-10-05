import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TaskSetupMFA, useSession } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { composeSessionTask, SESSION_TASK_COMPLETE_PATH } from "@/lib/sessionTask";
import { notify } from "./notify";
import { V2EmptyState } from "./V2EmptyState";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";
import {
  composeTwoFactorSetting,
  grantExpiryLabel,
  grantHours,
  PLATFORM_STAFF_PATH,
  SUPPORT_GRANT_CREATE_PATH,
  SUPPORT_GRANTS_PATH,
  supportGrantRevokePath,
  TWO_FACTOR_PATH,
  TWO_FACTOR_REQUIRE_PATH,
  type PlatformStaffOption,
  type SupportGrantView,
  type WorkspaceAssurance,
} from "./supportAccess";

export function V2SupportAccess({ workspaceRole }: { workspaceRole: string }) {
  const { data: grants = [], isLoading: grantsLoading } = useQuery<SupportGrantView[]>({
    queryKey: [SUPPORT_GRANTS_PATH],
  });
  const { data: staff = [] } = useQuery<PlatformStaffOption[]>({
    queryKey: [PLATFORM_STAFF_PATH],
  });
  const { data: assurance } = useQuery<WorkspaceAssurance>({
    queryKey: [TWO_FACTOR_PATH],
  });
  const [staffId, setStaffId] = useState(V2_SELECT_NONE);
  const [span, setSpan] = useState<"24" | "168">("24");
  const setting = composeTwoFactorSetting({
    required: assurance?.required === true,
    workspaceRole,
    secondFactorVerified: assurance?.secondFactorVerified === true,
  });

  const grant = useMutation({
    mutationFn: () =>
      apiRequest("POST", SUPPORT_GRANT_CREATE_PATH, {
        platformStaffId: staffId,
        hours: grantHours(span),
      }),
    onSuccess: async () => {
      setStaffId(V2_SELECT_NONE);
      await queryClient.invalidateQueries({ queryKey: [SUPPORT_GRANTS_PATH] });
      notify.success("Support access granted");
    },
    onError: (error) => notify.error(error, { fallback: "Support access could not be granted." }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest("POST", supportGrantRevokePath(id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [SUPPORT_GRANTS_PATH] });
      notify.success("Support access revoked");
    },
    onError: (error) => notify.error(error, { fallback: "Support access could not be revoked." }),
  });

  const requireFactor = useMutation({
    mutationFn: () => apiRequest("PATCH", TWO_FACTOR_REQUIRE_PATH, { required: !setting.required }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [TWO_FACTOR_PATH] });
    },
    onError: (error) => notify.error(error, { fallback: "The second-factor requirement could not be changed." }),
  });

  return (
    <>
      <section className="df-card" data-testid="v2-administration-support-access">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Support access</h2>
            <p className="df-card-sub">
              A grant lets Platform Staff read this Workspace. It expires on its own. Nothing they do here can change it.
            </p>
          </div>
        </div>
        {grantsLoading ? (
          <p className="df-support-note">Reading active grants…</p>
        ) : grants.length === 0 ? (
          <V2EmptyState
            icon="access"
            title="No active Support Access Grant"
            copy="When DocuFlow support needs to look into a problem, grant read-only access below. It ends on its own."
            testId="v2-support-access-empty"
          />
        ) : (
          <ul className="df-support-grants" data-testid="v2-support-access-grants">
            {grants.map((row) => (
              <li key={row.id}>
                <span>
                  {row.email ?? "Platform Staff"}
                  {grantExpiryLabel(row.expiresAt) ? ` until ${grantExpiryLabel(row.expiresAt)}` : ""}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="df-btn"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(row.id)}
                  data-testid={`v2-support-access-revoke-${row.id}`}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="df-form-actions">
          <V2FilterSelect
            label=""
            ariaLabel="Platform Staff"
            value={staffId}
            testId="v2-support-access-staff"
            options={[
              { value: V2_SELECT_NONE, label: "Choose Platform Staff" },
              ...staff.map((row) => ({ value: row.id, label: row.email ?? row.id })),
            ]}
            onChange={setStaffId}
          />
          <V2FilterSelect
            label=""
            ariaLabel="How long the grant lasts"
            value={span}
            testId="v2-support-access-hours"
            options={[
              { value: "24", label: "24 hours" },
              { value: "168", label: "7 days" },
            ]}
            onChange={(value) => setSpan(value === "168" ? "168" : "24")}
          />
          <Button
            type="button"
            className="df-btn"
            disabled={staffId === V2_SELECT_NONE || grant.isPending}
            onClick={() => grant.mutate()}
            data-testid="v2-support-access-grant"
          >
            {grant.isPending ? "Granting…" : "Grant read-only access"}
          </Button>
        </div>
      </section>

      <section className="df-card" data-testid="v2-administration-two-factor">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Second factor</h2>
            <p className="df-card-sub">{setting.note}</p>
          </div>
        </div>
        {setting.canChange ? (
          <>
            {setting.blocked ? (
              <p className="df-support-note" data-testid="v2-two-factor-blocked">
                {setting.blocked}
              </p>
            ) : null}
            <div className="df-form-actions">
              <Button
                type="button"
                variant={setting.required ? "outline" : "default"}
                className="df-btn"
                disabled={requireFactor.isPending || setting.blocked !== null}
                onClick={() => requireFactor.mutate()}
                data-testid="v2-two-factor-toggle"
              >
                {setting.action}
              </Button>
            </div>
          </>
        ) : (
          <p className="df-support-note">Only the Owner can change this.</p>
        )}
      </section>
    </>
  );
}

/** Shown instead of the Workspace when the Owner requires a second factor this session lacks. */
export function WorkspaceSecondFactor() {
  const { session } = useSession();
  const page = composeSessionTask({ key: "setup-mfa" });
  const pending = session?.currentTask?.key === "setup-mfa";

  return (
    <div className="df-page" data-testid="v2-workspace-second-factor">
      <header className="df-today-head">
        <div>
          <h1 className="df-title">{page.title}</h1>
          <p className="df-subhead">{page.note}</p>
        </div>
      </header>
      <p className="df-support-note">This Workspace requires a second factor before you can use it.</p>
      {pending ? <TaskSetupMFA redirectUrlComplete={SESSION_TASK_COMPLETE_PATH} /> : null}
      <div className="df-form-actions">
        <Button
          type="button"
          className="df-btn"
          onClick={() => void queryClient.invalidateQueries({ queryKey: [TWO_FACTOR_PATH] })}
          data-testid="v2-workspace-second-factor-continue"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
