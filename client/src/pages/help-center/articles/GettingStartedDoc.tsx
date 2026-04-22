import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DocH3, DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";

export function GettingStartedDoc() {
  return (
    <div className="space-y-2">
      <Alert className="mb-6 border-primary/30 bg-primary/5">
        <AlertTitle className="text-sm">First-time setup</AlertTitle>
        <AlertDescription className="text-xs sm:text-sm text-muted-foreground">
          DocuFlow combines documentation, CRM-style project management, and time tracking. You can use only the
          modules you need; everything in this guide applies once you are signed in.
        </AlertDescription>
      </Alert>

      <DocSection title="Create an account and sign in">
        <DocP>
          Open the DocuFlow sign-in page from your organisation link. Use email and password, or the sign-in option your
          administrator enabled (for example SSO). After authentication, you land on the home workspace with the main
          sidebar visible.
        </DocP>
        <DocH3>Session security</DocH3>
        <DocList>
          <DocLi>Stay signed in on trusted devices; sign out from shared computers from the user menu in the sidebar.</DocLi>
          <DocLi>If you are unexpectedly logged out, sign in again — your data remains on the server.</DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Navigate the web app">
        <DocP>The left sidebar is the primary navigation for authenticated users:</DocP>
        <DocList>
          <DocLi>
            <strong className="text-foreground">Company Documents</strong> — organisation-wide files and editors.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Project Management</strong> — CRM pipeline: clients, projects, and tasks.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Documentation</strong> — personal or team documentation spaces tied to documentable projects.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Time Tracking</strong> — timer, entries, dashboard, devices, screencasts, and desktop download.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Administration</strong> — visible only if your role is <code className="text-xs bg-muted px-1 py-0.5 rounded">admin</code>.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Help Center</strong> — this documentation hub (you are here).
          </DocLi>
        </DocList>
        <DocP>
          On smaller screens, open the sidebar with the menu control in the header. The timer control may also appear in
          the mobile header for quick access.
        </DocP>
      </DocSection>

      <DocSection title="Understand the main areas">
        <DocH3>Home</DocH3>
        <DocP>
          The home route is your entry dashboard after login. Use it as a launch point; deep work usually happens in
          Project Management, Documentation, or Time Tracking.
        </DocP>
        <DocH3>Documentation vs Company Documents</DocH3>
        <DocP>
          <strong className="text-foreground">Documentation</strong> is organised around documentable projects (folders and rich-text documents).
          <strong className="text-foreground"> Company Documents</strong> covers organisation-level files and workflows. Choose the area that matches
          where your team stores the file.
        </DocP>
        <DocH3>Time Tracking tabs</DocH3>
        <DocP>
          Inside Time Tracking, secondary tabs separate <strong className="text-foreground">Dashboard</strong>,{" "}
          <strong className="text-foreground">Entries</strong>, <strong className="text-foreground">Projects &amp; Tasks</strong>,{" "}
          <strong className="text-foreground">Screencasts</strong> (if enabled), <strong className="text-foreground">Devices</strong>, and{" "}
          <strong className="text-foreground">Download</strong> for the desktop agent.
        </DocP>
      </DocSection>
    </div>
  );
}
