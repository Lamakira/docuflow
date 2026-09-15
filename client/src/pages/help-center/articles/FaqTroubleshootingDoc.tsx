import {
  DocArticle,
  DocSection,
  DocH3,
  DocList,
  DocLi,
  DocP,
  DocStrong,
} from "@/components/help-center/DocBlocks";
import { HelpScreenshot } from "@/components/help-center/HelpScreenshot";

export function FaqTroubleshootingDoc() {
  return (
    <DocArticle>
      <DocSection title="Why can&apos;t I start tracking?" sectionId="section-cannot-start">
        <DocH3>Web popover</DocH3>
        <DocList>
          <DocLi>
            <DocStrong>No project or task selected</DocStrong> — when your workspace requires
            tasks for time entries, Start stays disabled until you pick a CRM project and a task. If the project has no
            tasks, create one under <DocStrong>Time Tracking → Projects &amp; Tasks</DocStrong>.
          </DocLi>
          <DocLi>
            <DocStrong>Archived task</DocStrong> — the server rejects starting on an archived task;
            pick an active task.
          </DocLi>
          <DocLi>
            <DocStrong>Network or session</DocStrong> — starting calls the authenticated API; a
            failed request shows an error toast with the server message. Sign in again if your session expired.
          </DocLi>
        </DocList>
        <DocH3>Desktop agent</DocH3>
        <DocList>
          <DocLi>
            <DocStrong>Not signed in</DocStrong> — complete device login in the agent window.
          </DocLi>
          <DocLi>
            <DocStrong>Workspace requires a task</DocStrong> — the agent must start with a task id
            when the server reports that tasks are required; use the task list, not project-only shortcuts.
          </DocLi>
          <DocLi>
            <DocStrong>IPC rejection</DocStrong> — if start still fails, capture the error text from
            the agent; the queue may surface server validation errors after sync.
          </DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Why does the app tell me to use the desktop agent?" sectionId="section-desktop-message">
        <DocP>
          Current application behaviour: when your organisation&apos;s server{" "}
          <DocStrong>does not</DocStrong> require per-task tracking (tasks feature not active for
          that database), the web timer popover does not expose a full web-only start flow and instead instructs you to
          start from the DocuFlow Desktop Agent after selecting project and task there. That message is intentional for
          that configuration — it does not by itself mean the web app is broken.
        </DocP>
        <DocP>
          When tasks <em>are</em> required, the web popover shows project and task selectors and Start when the selection
          is valid.
        </DocP>
        <HelpScreenshot
          slotId="faq-web-popover-desktop-message"
          caption="Web timer popover when the product directs you to the desktop agent."
          expectedLabel="Web timer popover showing desktop-oriented instruction (no web-only start in that configuration)."
        />
      </DocSection>

      <DocSection title="Why don&apos;t numbers match immediately between web and desktop?" sectionId="section-numbers">
        <DocP>
          The server stores authoritative time entries. The web app refetches active state on an interval (tens of
          seconds) and when you return to the tab. The desktop agent applies local timer UI first, then synchronises on a
          heartbeat and timer resync cycle on the order of{" "}
          <DocStrong>up to about one minute</DocStrong> for many policy and totals updates. Worked
          Today in the agent also combines server-backed stopped time with local session attribution, so small differences
          right after start, stop, or idle can appear until both sides refresh.
        </DocP>
        <DocP>
          Wait for the next heartbeat or manually refresh the web page before opening a support ticket for transient
          mismatch.
        </DocP>
      </DocSection>

      <DocSection title="Why are admin policy changes not visible instantly on my desktop?" sectionId="section-admin-delay">
        <DocP>
          After an administrator saves screenshot or idle policy in the web Administration area, the server stores the
          new values immediately, but each connected desktop agent typically receives the updated policy on its{" "}
          <DocStrong>next heartbeat</DocStrong> (interval on the order of one minute). Allow up to
          roughly one minute, or restart the agent if your internal procedures require an immediate pick-up.
        </DocP>
      </DocSection>

      <DocSection title="Why are screenshots missing?" sectionId="section-screenshots-missing">
        <DocH3>Policy disabled</DocH3>
        <DocP>
          Your organisation may have <DocStrong>screenshotsEnabled</DocStrong> turned off in admin
          policy — no new captures should be expected.
        </DocP>
        <DocH3>Agent not running or not signed in</DocH3>
        <DocP>
          Screenshots are produced by the desktop agent pipeline. If the agent is closed, sleeping without permission, or
          logged out, captures are not queued.
        </DocP>
        <DocH3>Active hours window</DocH3>
        <DocP>
          When <DocStrong>activeHoursEnabled</DocStrong> is on, captures only occur inside the
          configured daily window — outside that window, gaps are expected.
        </DocP>
        <DocH3>OS permissions</DocH3>
        <DocP>
          On macOS, missing screen-recording permission prevents capture until granted and the agent is restarted.
        </DocP>
        <DocH3>Build-level disable</DocH3>
        <DocP>
          Depending on build or environment configuration, screenshots may be disabled independently of org policy —
          confirm with your administrator if captures never appear despite policy being on.
        </DocP>
        <HelpScreenshot
          slotId="faq-admin-screenshot-master-switch"
          caption="Admin screenshot policy: master enable switch (reference for missing captures)."
          expectedLabel="Admin screenshot policy card showing screenshotsEnabled / master switch."
        />
      </DocSection>

      <DocSection title="Desktop app appears disconnected or sync stalls" sectionId="section-disconnected">
        <DocP>
          Verify network path to the DocuFlow API (VPN, proxy, firewall). Re-login in the agent if the device token was
          invalidated. Keep the agent online until pending timer commands in the local queue finish uploading after
          offline periods.
        </DocP>
      </DocSection>

      <DocSection title="Worked Today vs This session still look wrong after waiting" sectionId="section-worked-today">
        <DocP>
          Remember that <DocStrong>This session</DocStrong> in the agent is anchored to this run of
          the desktop application, not to &quot;since my timer started&quot;. Worked Today merges server totals with
          local attribution and can move after idle handling. If values remain wrong after a full refresh cycle, collect
          timestamps and entry ids from <DocStrong>Time Tracking → Entries</DocStrong> for support.
        </DocP>
      </DocSection>

      <DocSection title="Timezone and &quot;today&quot; boundaries" sectionId="section-timezone">
        <DocP>
          Calendar-day totals depend on how &quot;today&quot; is computed for each surface (browser vs agent local
          midnight fetch vs organisation settings). Small boundary shifts near midnight are often expected rather than
          defects.
        </DocP>
      </DocSection>
    </DocArticle>
  );
}
