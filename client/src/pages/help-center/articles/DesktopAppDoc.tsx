import { DocH3, DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";

export function DesktopAppDoc() {
  return (
    <div className="space-y-2">
      <DocSection title="Download and install">
        <DocP>
          Go to <strong className="text-foreground">Time Tracking → Download</strong> in the web app. Choose the installer for your operating
          system (Windows is fully supported; other platforms follow the same packaging where available). Run the
          installer with permissions that allow background execution if your IT policy permits it.
        </DocP>
      </DocSection>

      <DocSection title="Sign in on the desktop">
        <DocP>
          The agent uses a device-based login separate from the browser session. Enter the same organisational
          credentials you use on the web unless your administrator issued a dedicated device flow. After login, the agent
          stores a long-lived device token locally — protect the machine disk encryption accordingly.
        </DocP>
      </DocSection>

      <DocSection title="Background behaviour">
        <DocList>
          <DocLi>The agent runs in the background and syncs timer and heartbeat data to DocuFlow servers.</DocLi>
          <DocLi>It may start with your session so tracking resumes quickly — check autostart settings if you prefer manual launch.</DocLi>
          <DocLi>Corporate VPNs or firewalls can delay sync; the agent retries with backoff.</DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Idle detection">
        <DocP>
          Idle detection uses OS-level idle timers and, where available, global input hooks for precise activity metrics.
          When a long idle threshold is crossed while the timer is running, you may see a confirmation modal — answer
          honestly so Worked Today reflects real work.
        </DocP>
      </DocSection>

      <DocSection title="Activity bar">
        <DocP>
          The activity bar summarises keyboard and pointer intensity over a sliding window. It complements screenshots;
          it does not record keystroke content.
        </DocP>
      </DocSection>

      <DocSection title="Known limitations">
        <DocH3>Permissions</DocH3>
        <DocP>
          macOS may require accessibility permissions for global hooks; without them, the agent falls back to a less
          granular activity signal.
        </DocP>
        <DocH3>Multiple monitors</DocH3>
        <DocP>Screenshot capture follows the product implementation for your build — verify with admins if compliance requires full multi-monitor coverage.</DocP>
      </DocSection>
    </div>
  );
}
