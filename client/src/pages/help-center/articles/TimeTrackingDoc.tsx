import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DocH3, DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";

export function TimeTrackingDoc() {
  return (
    <div className="space-y-2">
      <Alert className="mb-6 border-amber-500/40 bg-amber-500/5">
        <AlertTitle className="text-sm">Accuracy matters</AlertTitle>
        <AlertDescription className="text-xs sm:text-sm text-muted-foreground">
          Time entries power billing and reporting. Start the timer when you begin real work, and stop or switch tasks
          when you context-switch for more than a short break.
        </AlertDescription>
      </Alert>

      <DocSection title="Start, stop, and resume the timer">
        <DocP>
          Use the timer control in the sidebar (desktop) or header (mobile). Pick a CRM project and optional task, add
          a short description if your process requires it, then start tracking.
        </DocP>
        <DocList>
          <DocLi>
            <strong className="text-foreground">Start</strong> — creates or continues a running session for the selected project/task.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Stop / Pause</strong> — behaviour depends on product configuration; paused time may still appear in
            entries until you fully stop or the server finalises the session.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Resume</strong> — select the same or another task and start again; new sessions appear as separate
            entries unless your workflow merges them server-side.
          </DocLi>
        </DocList>
        <DocP>
          The desktop agent syncs timer state with the server on a schedule. If two clients show different states, wait
          for sync or refresh the page after a few seconds.
        </DocP>
      </DocSection>

      <DocSection title="Current session vs Worked Today">
        <DocH3>This session</DocH3>
        <DocP>
          Shows elapsed time for the <em>active</em> timer only — the block of time since you last started without a
          full stop that closes the session in reporting terms.
        </DocP>
        <DocH3>Worked Today</DocH3>
        <DocP>
          Aggregates approved working time for the current calendar day in your profile or organisation timezone (as
          configured). It can include multiple sessions across projects. Idle periods excluded by policy do not count
          toward Worked Today.
        </DocP>
        <DocP>
          If numbers disagree briefly after idle or desktop reconnect, allow the next heartbeat or page refresh — the
          server is the source of truth for stored duration.
        </DocP>
      </DocSection>

      <DocSection title="Idle behaviour">
        <DocP>
          After extended inactivity, DocuFlow may prompt you (in the desktop agent and/or web) to confirm you are still
          working. Choosing that you are <em>not</em> working typically stops or pauses tracking back to the idle start
          time so passive time is not billed.
        </DocP>
        <DocList>
          <DocLi>Respond promptly to idle prompts to avoid retroactive adjustments you did not intend.</DocLi>
          <DocLi>Mouse movement alone may not count as “active” — intentional input and app focus matter.</DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Screenshots and activity">
        <DocP>
          When enabled by your administrator, the desktop agent can capture periodic screenshots and derive an activity
          signal (keyboard/mouse intensity) for the dashboard. These features support transparency — they are not a
          replacement for judgement on what counts as productive work.
        </DocP>
        <DocH3>Activity bar</DocH3>
        <DocP>
          The activity visualisation summarises recent input levels. Low bars during claimed work time may warrant a
          quick check that the agent is running and that you are on the correct task.
        </DocP>
      </DocSection>

      <DocSection title="Desktop agent and web timer">
        <DocP>
          The desktop agent is optional but recommended for accurate idle detection and screenshot capture. The web app
          can still control the timer when you are online; use one primary surface at a time to avoid conflicting edits.
        </DocP>
      </DocSection>
    </div>
  );
}
