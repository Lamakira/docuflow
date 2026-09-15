import {
  DocArticle,
  DocSection,
  DocH3,
  DocList,
  DocLi,
  DocP,
  DocStrong,
  DocCode,
  DocLeadSummary,
  DocCalloutNext,
} from "@/components/help-center/DocBlocks";
import { HelpScreenshot } from "@/components/help-center/HelpScreenshot";

export function GettingStartedDoc() {
  return (
    <DocArticle>
      <DocLeadSummary title="What DocuFlow is" variant="intro">
        <DocP>
          DocuFlow is a web application for your organisation: rich-text documentation, CRM-style projects and clients,
          optional company-wide files, and time tracking that ties work to CRM projects (and, when enabled for your
          database, tasks). The optional desktop agent adds idle handling, activity signals, and screenshot capture
          according to admin policy.
        </DocP>
      </DocLeadSummary>

      <DocCalloutNext>
        <DocP>
          Use the <DocStrong>On this page</DocStrong> links at the top to jump to a section. Open{" "}
          <DocStrong>Time Tracking</DocStrong> when you are ready to track work.
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
            Use <DocStrong>Sign out</DocStrong> from the user menu on shared computers.
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
            <DocStrong>Company Documents</DocStrong> — organisation-level files and viewers.
          </DocLi>
          <DocLi>
            <DocStrong>Project Management</DocStrong> — CRM: clients, projects, pipeline.
          </DocLi>
          <DocLi>
            <DocStrong>Documentation</DocStrong> — documents attached to documentable projects.
          </DocLi>
          <DocLi>
            <DocStrong>Time Tracking</DocStrong> — entries, dashboard, projects &amp; tasks,
            devices, desktop download, and (if enabled) screencasts.
          </DocLi>
          <DocLi>
            <DocStrong>Administration</DocStrong> — visible only when your account role is{" "}
            <DocCode>admin</DocCode>.
          </DocLi>
          <DocLi>
            <DocStrong>Help Center</DocStrong> — this documentation (
            <DocCode>/help-center</DocCode>).
          </DocLi>
        </DocList>
        <DocP>
          Routes such as <DocCode>/time-tracking</DocCode>,{" "}
          <DocCode>/crm</DocCode>, and{" "}
          <DocCode>/admin</DocCode> are protected: unauthenticated visitors are
          redirected to sign-in.
        </DocP>
      </DocSection>

      <DocSection title="Where the timer is" sectionId="section-where-timer">
        <DocP>
          The time tracker control lives in the <DocStrong>sidebar</DocStrong> as a clock button
          next to your user block (desktop layout). On smaller viewports it also appears in the{" "}
          <DocStrong>top header</DocStrong> so you can open the same popover without the sidebar
          expanded.
        </DocP>
        <DocP>
          Click the control to open the popover: depending on your organisation&apos;s configuration you may start a
          timer from the web (project + task when tasks are required) or see instructions to use the desktop agent — see{" "}
          <DocStrong>Time Tracking</DocStrong> in this Help Center.
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
          Read <DocStrong>Time Tracking</DocStrong>, install the agent from{" "}
          <DocStrong>Time Tracking → Download</DocStrong> if your workflow uses the desktop app,
          and create tasks under <DocStrong>Time Tracking → Projects &amp; Tasks</DocStrong> when
          your workspace requires a task to start.
        </DocP>
        <DocH3>I use the desktop agent</DocH3>
        <DocP>
          Read <DocStrong>Desktop App Guides</DocStrong> for login, picker, idle modals, and sync
          expectations.
        </DocP>
        <DocH3>I administer the organisation</DocH3>
        <DocP>
          Open <DocStrong>Administration</DocStrong> for user management and for the screenshot /
          idle policy that applies to desktop agents (propagation delay applies).
        </DocP>
        <DocH3>Something does not match what I expect</DocH3>
        <DocP>
          Start with <DocStrong>FAQ &amp; Troubleshooting</DocStrong> for timer start, desktop
          messaging, numbers after sync, and admin delay questions.
        </DocP>
      </DocSection>
    </DocArticle>
  );
}
