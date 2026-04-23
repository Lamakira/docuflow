import {
  DocH3,
  DocLeadSummary,
  DocLi,
  DocList,
  DocP,
  DocSection,
  DocCalloutNext,
} from "@/components/help-center/DocBlocks";
import { HelpScreenshot } from "@/components/help-center/HelpScreenshot";

export function GettingStartedDoc() {
  return (
    <div className="space-y-8">
      <DocLeadSummary title="What DocuFlow is" variant="intro">
        <p>
          DocuFlow is a web application for your organisation: rich-text documentation, CRM-style projects and clients,
          optional company-wide files, and time tracking that ties work to CRM projects (and, when enabled for your
          database, tasks). The optional desktop agent adds idle handling, activity signals, and screenshot capture
          according to admin policy.
        </p>
      </DocLeadSummary>

      <DocCalloutNext>
        <DocP className="text-muted-foreground m-0">
          Use the <strong className="text-foreground">On this page</strong> links at the top to jump to a section. Open{" "}
          <strong className="text-foreground">Time Tracking</strong> when you are ready to track work.
        </DocP>
      </DocCalloutNext>

      <DocSection title="Sign in" sectionId="section-sign-in">
        <DocP>
          Open your organisation&apos;s DocuFlow URL. Sign in with email and password, or with whatever sign-in method
          your administrator configured (for example SSO). After a successful sign-in, you remain in a browser session
          until you sign out or the session expires per server rules.
        </DocP>
        <DocList>
          <DocLi>
            Use <strong className="text-foreground">Sign out</strong> from the user menu on shared computers.
          </DocLi>
          <DocLi>
            If you are logged out unexpectedly, sign in again; persisted data lives on the server, not only in the tab.
          </DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Navigate the web app" sectionId="section-navigate">
        <DocP>The primary navigation is the left sidebar (on narrow screens, open it from the header menu).</DocP>
        <DocList>
          <DocLi>
            <strong className="text-foreground">Company Documents</strong> — organisation-level files and viewers.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Project Management</strong> — CRM: clients, projects, pipeline.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Documentation</strong> — documents attached to documentable projects.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Time Tracking</strong> — entries, dashboard, projects &amp; tasks,
            devices, desktop download, and (if enabled) screencasts.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Administration</strong> — visible only when your account role is{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">admin</code>.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Help Center</strong> — this documentation (
            <code className="text-xs bg-muted px-1 py-0.5 rounded">/help-center</code>).
          </DocLi>
        </DocList>
        <DocP>
          Routes such as <code className="text-xs bg-muted px-1 py-0.5 rounded">/time-tracking</code>,{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">/crm</code>, and{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">/admin</code> are protected: unauthenticated visitors are
          redirected to sign-in.
        </DocP>
      </DocSection>

      <DocSection title="Where the timer is" sectionId="section-where-timer">
        <DocP>
          The time tracker control lives in the <strong className="text-foreground">sidebar</strong> as a clock button
          next to your user block (desktop layout). On smaller viewports it also appears in the{" "}
          <strong className="text-foreground">top header</strong> so you can open the same popover without the sidebar
          expanded.
        </DocP>
        <DocP>
          Click the control to open the popover: depending on your organisation&apos;s configuration you may start a
          timer from the web (project + task when tasks are required) or see instructions to use the desktop agent — see{" "}
          <strong className="text-foreground">Time Tracking</strong> in this Help Center.
        </DocP>
        <HelpScreenshot
          slotId="getting-started-timer-popover"
          caption="Web timer popover: project and task selected, Start available when your workspace requires tasks."
          expectedLabel="Web timer popover with selected CRM project and task, Start enabled."
        />
      </DocSection>

      <DocSection title="Where to go next" sectionId="section-next">
        <DocH3>I need to track my time</DocH3>
        <DocP>
          Read <strong className="text-foreground">Time Tracking</strong>, install the agent from{" "}
          <strong className="text-foreground">Time Tracking → Download</strong> if your workflow uses the desktop app,
          and create tasks under <strong className="text-foreground">Time Tracking → Projects &amp; Tasks</strong> when
          your workspace requires a task to start.
        </DocP>
        <DocH3>I use the desktop agent</DocH3>
        <DocP>
          Read <strong className="text-foreground">Desktop App Guides</strong> for login, picker, idle modals, and sync
          expectations.
        </DocP>
        <DocH3>I administer the organisation</DocH3>
        <DocP>
          Open <strong className="text-foreground">Administration</strong> for user management and for the screenshot /
          idle policy that applies to desktop agents (propagation delay applies).
        </DocP>
        <DocH3>Something does not match what I expect</DocH3>
        <DocP>
          Start with <strong className="text-foreground">FAQ &amp; Troubleshooting</strong> for timer start, desktop
          messaging, numbers after sync, and admin delay questions.
        </DocP>
      </DocSection>
    </div>
  );
}
