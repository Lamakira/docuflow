import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DocH3, DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";

export function AdministrationDoc() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-2">
      {!isAdmin ? (
        <Alert className="mb-6 border-muted">
          <AlertTitle className="text-sm">Admin access</AlertTitle>
          <AlertDescription className="text-xs sm:text-sm text-muted-foreground">
            The <strong className="text-foreground">Administration</strong> area of the sidebar is only visible to users with the{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">admin</code> role. The overview below explains what
            admins manage so everyone understands how policies affect day-to-day tracking.
          </AlertDescription>
        </Alert>
      ) : null}

      <DocSection title="What administrators control">
        <DocP>
          Organisation administrators configure who can track time, how screenshots behave, and which CRM modules or
          custom fields appear. Changes apply tenant-wide after save.
        </DocP>
      </DocSection>

      <DocSection title="Screenshot policy">
        {isAdmin ? (
          <>
            <DocP>
              From Administration, review screenshot capture intervals, retention, and whether blur or redaction is
              required. Communicate policy changes to the team before toggling aggressive settings.
            </DocP>
            <DocList>
              <DocLi>Balance transparency with legal obligations in your jurisdiction.</DocLi>
              <DocLi>Test on a pilot group when changing capture frequency.</DocLi>
            </DocList>
          </>
        ) : (
          <DocP>
            Screenshot cadence and retention are set by your admin team. If you are unsure what is collected, ask them
            for the internal privacy summary — the Help Center cannot override tenant configuration.
          </DocP>
        )}
      </DocSection>

      <DocSection title="User management">
        {isAdmin ? (
          <>
            <DocH3>Invites and roles</DocH3>
            <DocP>
              Invite users from the admin user list, assign <code className="text-xs bg-muted px-1 py-0.5 rounded">admin</code>{" "}
              sparingly, and deactivate accounts for leavers instead of deleting audit history where the product allows
              soft-disable.
            </DocP>
            <DocH3>Support handoffs</DocH3>
            <DocP>Export or copy user identifiers when opening tickets with DocuFlow support to speed lookup.</DocP>
          </>
        ) : (
          <DocP>
            Admins invite colleagues, reset access when needed, and map SSO identities. Contact an administrator if you
            need a role change or a deactivated account restored.
          </DocP>
        )}
      </DocSection>

      <DocSection title="Settings and CRM modules">
        {isAdmin ? (
          <>
            <DocP>
              Module and custom-field configuration defines required data at project creation and task tracking. Keep
              field names stable; renaming after go-live confuses historical imports.
            </DocP>
            <DocList>
              <DocLi>Document mandatory fields in your internal wiki alongside this Help Center.</DocLi>
              <DocLi>Use analytics pages to confirm adoption after major configuration changes.</DocLi>
            </DocList>
          </>
        ) : (
          <DocP>
            Visible CRM fields and required metadata are defined by admins. If a field blocks you from saving a project,
            note the exact error text when asking for a schema change.
          </DocP>
        )}
      </DocSection>
    </div>
  );
}
