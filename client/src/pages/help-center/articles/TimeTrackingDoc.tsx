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
  DocCalloutNote,
} from "@/components/help-center/DocBlocks";
import { HelpScreenshot } from "@/components/help-center/HelpScreenshot";

export function TimeTrackingDoc() {
  return (
    <DocArticle>
      <DocLeadSummary title="Records and accuracy" variant="caution">
        <DocP>
          Time entries are stored on the server. Start when you begin the work you intend to record, and pause or stop
          when you stop that work. Depending on your organisation&apos;s configuration, a task may be mandatory before
          Start is allowed.
        </DocP>
      </DocLeadSummary>

      <DocSection title="Where you start and control the timer" sectionId="section-entry-points">
        <DocH3>Entry points (web)</DocH3>
        <DocList>
          <DocLi>
            <DocStrong>Sidebar</DocStrong> — clock control opens the timer popover (wide layout).
          </DocLi>
          <DocLi>
            <DocStrong>Mobile header</DocStrong> — same popover from the header clock control.
          </DocLi>
          <DocLi>
            <DocStrong>Time Tracking → Entries</DocStrong> (
            <DocCode>/time-tracking</DocCode>) uses the same underlying timer
            state as the sidebar; it is the place to review and filter historical entries and screenshots, not a second
            independent clock.
          </DocLi>
        </DocList>
        <HelpScreenshot
          slotId="time-tracking-web-popover-task"
          caption="Timer popover with CRM project and task selected (when tasks are required)."
          expectedLabel="Web timer popover: project + task selected, Start enabled."
        />
        <HelpScreenshot
          slotId="time-tracking-web-popover-disabled"
          caption="Timer popover when Start is disabled (e.g. missing task or no tasks on project)."
          expectedLabel="Web timer popover: Start disabled with helper text for missing task or empty task list."
        />

        <DocH3>Project and task selection</DocH3>
        <DocP>
          Depending on your organisation&apos;s configuration, the server exposes{" "}
          <DocStrong>task-required</DocStrong> time tracking. When that is active, the web popover
          requires a CRM project and a non-archived task before <DocStrong>Start</DocStrong> is
          enabled; if the project has no tasks, the UI directs you to{" "}
          <DocStrong>Time Tracking → Projects &amp; Tasks</DocStrong> to create one first.
        </DocP>
        <DocP>
          When task-required mode is <em>not</em> active for your workspace, the current web popover does not offer a full
          web-only start flow and instead tells you to use the <DocStrong>desktop agent</DocStrong>{" "}
          to start tracking — this is current application behaviour, not a connectivity error.
        </DocP>
      </DocSection>

      <DocSection title="Start, pause, resume, and stop (web popover)" sectionId="section-controls">
        <DocList>
          <DocLi>
            <DocStrong>Start</DocStrong> — sends{" "}
            <DocCode>POST /api/time-tracking/start</DocCode> with the selected
            project (and task when required). The server stops any other active entry for your user before creating the
            new running entry. On success, the client refreshes active entry and related queries.
          </DocLi>
          <DocLi>
            <DocStrong>Pause</DocStrong> — sends pause for the current entry id; the server moves
            the entry to <DocCode>paused</DocCode> and folds elapsed time
            since the last activity timestamp into <DocCode>duration</DocCode>.
          </DocLi>
          <DocLi>
            <DocStrong>Resume</DocStrong> — sends resume for the <em>same</em> paused entry (current
            application behaviour: the web client resumes without discarding idle interval into work duration in that
            call). This is different from starting a brand-new entry.
          </DocLi>
          <DocLi>
            <DocStrong>Stop</DocStrong> — finalises the entry (
            <DocCode>stopped</DocCode>, end time, duration) and clears the web
            client&apos;s local capture scheduling tied to that session.
          </DocLi>
        </DocList>

        <DocH3>Immediately vs after sync</DocH3>
        <DocP>
          <DocStrong>Immediately after your click:</DocStrong> the browser sends the API request;
          on success, TanStack Query invalidates the active entry and list queries, so the popover updates as soon as the
          new JSON arrives.
        </DocP>
        <DocP>
          <DocStrong>Ongoing while running:</DocStrong> the web app refetches the active entry on an
          interval (on the order of tens of seconds). While the timer is running, one browser tab may act as leader and
          send periodic <DocStrong>activity</DocStrong> heartbeats to keep server-side activity
          timestamps fresh — another tab then follows the same server state when it refetches.
        </DocP>
        <DocP>
          <DocStrong>Desktop agent:</DocStrong> if you also use the agent, its display catches up
          with the server on its own heartbeat and timer resync cycle (on the order of up to about a minute for policy and
          heartbeat-driven updates). The server remains the source of truth for stored entries.
        </DocP>
      </DocSection>

      <DocSection title="Worked Today and This session (labels in the desktop agent)" sectionId="section-metrics-desktop">
        <DocP>
          In the <DocStrong>desktop agent</DocStrong> header bar you see{" "}
          <DocStrong>Worked Today</DocStrong> and <DocStrong>This session</DocStrong>.
          These labels are not duplicated in the small web popover the same way; they matter when you run the agent.
        </DocP>
        <DocH3>Worked Today (desktop)</DocH3>
        <DocP>
          Current application behaviour: the value combines server-backed totals for stopped work on the current
          calendar day (fetched for your local midnight window from the agent) with time attributed to your active
          sessions for that day in the agent. It can tick and adjust after sync or heartbeat — treat small transient
          differences versus the web list as normal until both sides have refreshed.
        </DocP>
        <DocH3>This session (desktop)</DocH3>
        <DocP>
          Current application behaviour: this is <em>not</em> simply &quot;length of the current timer entry&quot;. It
          sums tracked time from local session records that began after this run of the desktop application started.
          Restarting the agent application resets the anchor for that label.
        </DocP>
        <HelpScreenshot
          slotId="time-tracking-desktop-header-metrics"
          caption="Desktop agent header: Worked Today and This session with timer controls."
          expectedLabel="Desktop running header showing Worked Today, This session, and pause/resume affordance."
        />
      </DocSection>

      <DocSection title="Idle and activity (expectations)" sectionId="section-idle-activity">
        <DocP>
          <DocStrong>Desktop agent:</DocStrong> when your administrator enables the idle prompt,
          long inactivity while the timer runs can trigger a warning modal with a countdown, then optional break / resume
          actions. Exact retroactive adjustment on the time entry follows the agent&apos;s implementation when you
          confirm — if you need second-by-second accounting text for compliance, confirm with your administrator.
        </DocP>
        <HelpScreenshot
          slotId="time-tracking-idle-modal"
          caption="Desktop idle warning: countdown and actions while the timer is running."
          expectedLabel="Desktop idle warning modal with visible countdown ring."
        />
        <DocCalloutNote>
          <DocP>
            <DocStrong>Web browser:</DocStrong> the web client does not replicate the full desktop
            idle overlay. It relies on server state and, when you are the multi-tab leader, periodic activity posts while
            the timer is running.
          </DocP>
        </DocCalloutNote>
      </DocSection>

      <DocSection title="Screenshots and activity signals" sectionId="section-screenshots">
        <DocP>
          Periodic screenshots and the activity bar are tied to the <DocStrong>desktop agent</DocStrong>{" "}
          when your administrator enables capture. The web Entries / Screenshots views show what the server has stored
          after upload. A separate optional web screen-capture path may exist when tracking from the browser; treat
          desktop and web capture as potentially different mechanisms depending on your organisation&apos;s configuration.
        </DocP>
      </DocSection>

      <DocSection title="Web vs desktop — who does what" sectionId="section-web-desktop">
        <DocList>
          <DocLi>
            <DocStrong>Server</DocStrong> — stores authoritative time entries and enforces start
            rules (for example task id validation when tasks are enabled).
          </DocLi>
          <DocLi>
            <DocStrong>Web</DocStrong> — reads and updates the same entries through the web API;
            may start/pause/resume/stop when the UI allows; refetches on a timer and when the tab becomes visible again.
          </DocLi>
          <DocLi>
            <DocStrong>Desktop</DocStrong> — optimistically updates local timer UI, queues
            commands to the server, receives organisation policy on heartbeat, and runs idle and screenshot workers when
            enabled.
          </DocLi>
        </DocList>
        <DocP>
          Avoid operating two surfaces at once in conflicting ways; if numbers disagree briefly, wait for the next sync
          cycle or refresh the web app before assuming an error.
        </DocP>
      </DocSection>
    </DocArticle>
  );
}
