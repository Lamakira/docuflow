import { useAuth } from "@/hooks/useAuth";
import { DocH3, DocLeadSummary, DocLi, DocList, DocP, DocSection, DocCalloutAdmin } from "@/components/help-center/DocBlocks";
import { HelpScreenshot } from "@/components/help-center/HelpScreenshot";

export function AdministrationDoc() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-8">
      {!isAdmin ? (
        <DocLeadSummary title="Admin access" variant="neutral">
          <p>
            The <strong className="text-foreground">Administration</strong> sidebar entry is only shown for accounts with
            the <code className="text-xs bg-muted px-1 py-0.5 rounded">admin</code> role. The sections below describe what
            administrators configure so you know why desktop behaviour or screenshots change organisation-wide.
          </p>
        </DocLeadSummary>
      ) : (
        <DocCalloutAdmin>
          <DocP className="m-0 text-muted-foreground">
            Signed in as admin: empty Help Center screenshot slots show an upload control here; other users never see
            those placeholders.
          </DocP>
        </DocCalloutAdmin>
      )}

      <DocSection title="Organisation policy and the desktop agent" sectionId="section-org-policy">
        <DocP>
          Several settings are stored as organisation configuration and applied to users through the web app and, for
          desktop-specific behaviour, through the agent after sync. Saving a policy in the web admin UI updates the
          server immediately; connected desktop agents typically receive the updated policy on their{" "}
          <strong className="text-foreground">next heartbeat</strong> (heartbeat runs on a fixed interval on the order of{" "}
          <strong className="text-foreground">one minute</strong>), so allow up to about one minute before assuming a
          change failed. This is current application behaviour.
        </DocP>
      </DocSection>

      <DocSection title="Screenshot capture policy (stable fields)" sectionId="section-screenshot-policy">
        <DocP>
          Administrators edit screenshot-related settings under <strong className="text-foreground">Administration</strong>{" "}
          in the web app. The stored policy includes the fields below (names reflect the product schema). Actual capture
          still requires the desktop agent to be running and permitted by OS settings.
        </DocP>
        <DocList>
          <DocLi>
            <strong className="text-foreground">screenshotsEnabled</strong> — master switch for periodic capture when the
            agent implements capture.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">captureIntervalMinMin / captureIntervalMaxMin</strong> — bounds (in
            minutes) between which the agent picks capture timing; minimum is constrained (for example at least a few
            minutes), maximum capped (for example up to a quarter hour) per the admin form validation.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">activeHoursEnabled</strong> with{" "}
            <strong className="text-foreground">activeHoursStart</strong> and{" "}
            <strong className="text-foreground">activeHoursEnd</strong> — when enabled, restricts capture to a daily time
            window using 24-hour <code className="text-xs bg-muted px-1 py-0.5 rounded">HH:mm</code> values.
          </DocLi>
        </DocList>
        <HelpScreenshot
          slotId="admin-screenshot-capture-card"
          caption="Administration: screenshot capture policy card."
          expectedLabel="Admin web — Screenshot capture card with enable switch and min/max interval fields."
        />
      </DocSection>

      <DocSection title="Idle behaviour policy (stable fields)" sectionId="section-idle-policy">
        <DocP>
          These settings control whether and how the desktop agent prompts after inactivity while the timer is running.
          They are part of the same saved policy object as screenshot capture.
        </DocP>
        <DocList>
          <DocLi>
            <strong className="text-foreground">idlePromptEnabled</strong> — whether the idle overlay can appear.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">idleTimeoutMinutes</strong> — minutes without qualifying activity before a
            prompt (allowed range in the admin form: 1–60).
          </DocLi>
          <DocLi>
            <strong className="text-foreground">idleCountdownSeconds</strong> — countdown length before automatic stop when
            the flow uses it (allowed range in the admin form: 15–120 seconds).
          </DocLi>
        </DocList>
        <HelpScreenshot
          slotId="admin-idle-behaviour-card"
          caption="Administration: idle behaviour policy card."
          expectedLabel="Admin web — Idle behaviour card with enable switch, timeout, and countdown fields."
        />
        <DocP>
          Saving uses <code className="text-xs bg-muted px-1 py-0.5 rounded">PATCH /api/admin/org-settings</code> with
          the <code className="text-xs bg-muted px-1 py-0.5 rounded">screenshotPolicy</code> payload. The UI states that
          policy is pushed to connected agents on the next heartbeat — plan communication to users accordingly.
        </DocP>
      </DocSection>

      <DocSection title="What admin settings affect for end users" sectionId="section-user-impact">
        <DocList>
          <DocLi>Whether screenshots can be taken and how often (within configured bounds and hours).</DocLi>
          <DocLi>Whether idle prompts appear and how aggressive the timeout and countdown are.</DocLi>
          <DocLi>
            Other Administration pages (users, CRM modules, analytics) change who can log in, what metadata is required
            on CRM objects, and what admins see in dashboards — outside the narrow timer policy above, refer to your
            internal admin runbooks until those areas have dedicated Help Center depth.
          </DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Screencasts timezone list (optional admin control)" sectionId="section-screencasts-tz">
        <DocP>
          Separately from screenshot policy, administrators may maintain a list of allowed IANA timezones for the
          Screencasts experience. Current application behaviour is described in the admin form: this affects which
          timezone labels users can pick when that selector is shown. If your organisation leaves this unset or empty,
          follow the on-screen admin hint for how the selector behaves.
        </DocP>
      </DocSection>

      <DocSection
        title={isAdmin ? "User management (overview)" : "If you need an admin change"}
        sectionId="section-admin-followup"
      >
        {isAdmin ? (
          <>
            <DocH3>Roles</DocH3>
            <DocP>
              Admins invite or manage users and assign the{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">admin</code> role where appropriate. Detailed invite
              flows stay in the Administration UI; this Help Center article does not replace your organisation&apos;s
              access policy.
            </DocP>
          </>
        ) : (
          <DocP>
            Ask an organisation administrator for policy updates, role changes, or CRM configuration. Non-admin accounts
            cannot save organisation-wide screenshot or idle policy.
          </DocP>
        )}
      </DocSection>
    </div>
  );
}
