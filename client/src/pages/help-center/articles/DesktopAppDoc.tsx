import { DocH3, DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";
import { HelpScreenshot } from "@/components/help-center/HelpScreenshot";

export function DesktopAppDoc() {
  return (
    <div className="space-y-2">
      <DocSection title="Download and install" sectionId="section-download">
        <DocP>
          In the web app, go to <strong className="text-foreground">Time Tracking → Download</strong> (
          <code className="text-xs bg-muted px-1 py-0.5 rounded">/time-tracking/download</code>) and use the installer for
          your platform. The agent needs permission to run in the background if you expect continuous sync and idle
          detection while you work in other apps.
        </DocP>
      </DocSection>

      <DocSection title="Sign in (device session)" sectionId="section-sign-in-agent">
        <DocP>
          The agent authenticates with the DocuFlow server using your organisational credentials and registers this
          device. A long-lived device token is stored locally on the machine (under the application&apos;s user data
          path). This session is separate from an open browser tab: signing out in the browser does not automatically
          sign out the agent until you disconnect or unpair from the agent itself.
        </DocP>
        <HelpScreenshot
          slotId="desktop-login"
          caption="Desktop agent sign-in window."
          expectedLabel="Desktop agent login window with email/password fields."
        />
      </DocSection>

      <DocSection title="Main window: project and task picker" sectionId="section-picker">
        <DocP>
          After login, the main window lists CRM projects and, once a project is selected, tasks for that project.
          Starting the timer is done by choosing a task row (the flow is task-centric from the picker). If the project
          has no tasks, create tasks from the web app under{" "}
          <strong className="text-foreground">Time Tracking → Projects &amp; Tasks</strong> first.
        </DocP>
        <HelpScreenshot
          slotId="desktop-picker-two-columns"
          caption="Desktop picker: projects column and tasks column."
          expectedLabel="Desktop two-column project and task picker with a task row visible."
        />
      </DocSection>

      <DocSection title="Persistent header and timer display" sectionId="section-header">
        <DocP>
          The agent keeps a compact header area with timer status, elapsed display for the current task context, project
          and task names when known, and metrics such as <strong className="text-foreground">Worked Today</strong> and{" "}
          <strong className="text-foreground">This session</strong> (see the Time Tracking article for what those labels
          mean in current behaviour).
        </DocP>
        <DocP>
          When the timer is <strong className="text-foreground">running</strong>, you can pause from the header; when{" "}
          <strong className="text-foreground">paused</strong>, resume uses the same server entry as before pause (via
          the agent&apos;s sync queue). When <strong className="text-foreground">stopped</strong>, the header reflects
          that no active entry is running on this client until you start again or sync picks up an entry started
          elsewhere.
        </DocP>
        <HelpScreenshot
          slotId="desktop-header-running"
          caption="Desktop header with running timer and pause control."
          expectedLabel="Desktop running header with elapsed time and pause button."
        />
      </DocSection>

      <DocSection title="Idle warning (running timer)" sectionId="section-idle">
        <DocP>
          When your organisation&apos;s admin enables the idle prompt and you remain inactive beyond the configured
          threshold while the timer runs, the agent shows an overlay: a countdown, and actions to indicate you are still
          working or taking a break. Keyboard or mouse activity outside the modal card may be treated as confirmation
          you are still working, depending on current application behaviour — read the buttons on your build.
        </DocP>
        <HelpScreenshot
          slotId="desktop-idle-warning-countdown"
          caption="Idle warning overlay with countdown."
          expectedLabel="Desktop idle warning modal with countdown ring and action buttons."
        />
      </DocSection>

      <DocSection title="After idle stops tracking (post-stop modal)" sectionId="section-post-stop">
        <DocP>
          If tracking is stopped from the idle flow, a follow-up state can show that tracking has stopped and offer a
          way to start again using your most recent project/task context when a task id is available. If no recent task
          is available, the resume shortcut may not appear — start again from the picker.
        </DocP>
        <HelpScreenshot
          slotId="desktop-post-stop-modal"
          caption="Post–idle-stop modal with optional resume."
          expectedLabel="Desktop modal after idle stop: stopped state and resume when recent task exists."
        />
      </DocSection>

      <DocSection title="Activity bar and optional widget" sectionId="section-activity-widget">
        <DocP>
          The activity bar shows a short-window intensity signal derived from input activity (not the content of
          keystrokes). A small on-screen widget may also mirror timer state; visibility can depend on whether the session
          was dismissed or the timer is stopped, per current product behaviour.
        </DocP>
      </DocSection>

      <DocSection title="What the desktop app is responsible for" sectionId="section-responsibilities">
        <DocList>
          <DocLi>Local-first timer commands (start / pause / resume / stop) queued to the server when online.</DocLi>
          <DocLi>
            Heartbeat to the server (on the order of once per minute when paired) carrying device identity and policy
            refresh.
          </DocLi>
          <DocLi>Idle detection and modals when enabled by organisation policy.</DocLi>
          <DocLi>Screenshot capture pipeline when enabled by policy and build settings.</DocLi>
          <DocLi>Worked-today style totals that combine server fetches with local session attribution for the UI.</DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Interaction with the server and the web app" sectionId="section-server-web">
        <DocP>
          The server stores canonical time entries. The web app reads the same entries through the web session. The agent
          reads and writes through authenticated agent APIs. If you change timer state in one client, the other client
          updates after its next sync or refetch — expect a short delay (roughly up to about a minute for agent-driven
          updates, shorter for many web refreshes).
        </DocP>
        <DocP>
          Organisation policy (screenshots, idle timing) is delivered to the agent on heartbeat after an admin saves
          changes in the web Administration area — not necessarily instant the moment Save is clicked.
        </DocP>
      </DocSection>
    </div>
  );
}
