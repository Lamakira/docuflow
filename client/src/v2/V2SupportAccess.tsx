import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { TaskSetupMFA, useSession } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { composeSessionTask, SESSION_TASK_COMPLETE_PATH } from "@/lib/sessionTask";
import { notify } from "./notify";
import { useRefreshFailure } from "./useRefreshFailure";
import { DestructiveConfirm } from "./V2DestructiveConfirm";
import { V2EmptyState, V2LoadFailed } from "./V2EmptyState";
import { SkeletonLines } from "./V2Skeleton";
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
  requireSecondFactorConsequence,
  type PlatformStaffOption,
  type SupportGrantView,
  type WorkspaceAssurance,
} from "./supportAccess";
import { V2PageHead } from "./V2PageHead";

export function V2SupportAccess({ workspaceRole }: { workspaceRole: string }) {
  const grantsRead = useQuery<SupportGrantView[]>({ queryKey: [SUPPORT_GRANTS_PATH] });
  const staffRead = useQuery<PlatformStaffOption[]>({ queryKey: [PLATFORM_STAFF_PATH] });
  const assuranceRead = useQuery<WorkspaceAssurance>({ queryKey: [TWO_FACTOR_PATH] });
  const { data: members } = useQuery<{ memberships: unknown[] }>({ queryKey: ["/api/workspace/memberships"] });
  const grants = grantsRead.data ?? [];
  const staff = staffRead.data ?? [];
  const assurance = assuranceRead.data;
  useRefreshFailure(grantsRead.isError && grantsRead.data !== undefined, "Support access could not be refreshed.", "v2-support-access-refresh-failed");
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
    mutationFn: (required: boolean) => apiRequest("PATCH", TWO_FACTOR_REQUIRE_PATH, { required }),
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
              A grant lets DocuFlow support read this Workspace. It expires on its own. Nothing they do here can change it.
            </p>
          </div>
        </div>
        {grantsRead.isLoading ? (
          <SkeletonLines count={2} />
        ) : grantsRead.isError && grantsRead.data === undefined ? (
          // Someone may have access: a failed read is never drawn as none (F107).
          <V2LoadFailed
            title="Support access could not be loaded"
            onRetry={() => void grantsRead.refetch()}
            testId="v2-support-access-failed"
          />
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
                  {row.email ?? "DocuFlow support"}
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
                  <Ban strokeWidth={1.6} aria-hidden />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        {staffRead.isError ? (
          <V2LoadFailed
            title="DocuFlow support could not be loaded"
            onRetry={() => void staffRead.refetch()}
            testId="v2-support-access-staff-failed"
          />
        ) : (
          <div className="df-form-actions">
            <V2FilterSelect
              label=""
              ariaLabel="DocuFlow support"
              value={staffId}
              disabled={staffRead.isLoading}
              testId="v2-support-access-staff"
              options={[
                { value: V2_SELECT_NONE, label: "Choose someone from DocuFlow support" },
                ...staff.map((row) => ({ value: row.id, label: row.label })),
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
        )}
      </section>

      <section className="df-card" data-testid="v2-administration-two-factor">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Second factor</h2>
            {assurance ? <p className="df-card-sub">{setting.note}</p> : null}
          </div>
          {/* The button shows once the requirement in force is read, never from a guess. */}
          {assurance && setting.canChange ? (
            setting.required ? (
              <Button
                type="button"
                variant="outline"
                className="df-btn"
                disabled={requireFactor.isPending}
                onClick={() => requireFactor.mutate(false)}
                data-testid="v2-two-factor-toggle"
              >
                {setting.action}
              </Button>
            ) : (
              <DestructiveConfirm
                tone="neutral"
                label={requireFactor.isPending ? "Requiring…" : setting.action}
                title="Require a second factor"
                consequence={requireSecondFactorConsequence(members?.memberships.length ?? null)}
                confirmLabel="Require a second factor"
                keepLabel="Keep it optional"
                pending={requireFactor.isPending}
                disabled={setting.blocked !== null}
                testId="v2-two-factor-toggle"
                onConfirm={() => requireFactor.mutate(true)}
              />
            )
          ) : null}
        </div>
        {assuranceRead.isLoading ? (
          <SkeletonLines count={1} />
        ) : assuranceRead.isError && !assurance ? (
          <V2LoadFailed
            title="The second-factor setting could not be loaded"
            onRetry={() => void assuranceRead.refetch()}
            testId="v2-two-factor-failed"
          />
        ) : setting.canChange ? (
          setting.blocked ? (
            <p className="df-support-note" data-testid="v2-two-factor-blocked">
              {setting.blocked}
            </p>
          ) : null
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
      <V2PageHead title={page.title} subhead={page.note} />
      <p className="df-support-note">This Workspace requires a second factor before you can use it. Add an authenticator app from your account, then continue.</p>
      {pending ? <TaskSetupMFA redirectUrlComplete={SESSION_TASK_COMPLETE_PATH} /> : null}
      <div className="df-form-actions">
        <Button asChild variant="outline" className="df-btn">
          <Link href="/account" data-testid="v2-workspace-second-factor-account">Set up in your account</Link>
        </Button>
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
