import { DocH3, DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";

export function FaqTroubleshootingDoc() {
  return (
    <div className="space-y-2">
      <DocSection title="Timer will not start">
        <DocList>
          <DocLi>Confirm you selected a valid CRM project (some tenants require a task as well).</DocLi>
          <DocLi>Check network connectivity; the start command must reach the API.</DocLi>
          <DocLi>Reload the web app after a deployment; stale bundles occasionally hold old client state.</DocLi>
          <DocLi>If only the desktop agent fails, verify you are logged in on the device and not rate-limited.</DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Desktop app appears disconnected">
        <DocP>
          Open the agent settings and confirm API connectivity. VPN split-tunnel rules and corporate proxies often block
          the agent while the browser still works. Re-login if the device token was rotated.
        </DocP>
      </DocSection>

      <DocSection title="Screenshots missing">
        <DocH3>Policy disabled</DocH3>
        <DocP>Your organisation may have screenshots turned off — check with an admin before assuming a bug.</DocP>
        <DocH3>Agent not running</DocH3>
        <DocP>Screenshots are captured by the desktop agent. If the agent exits, no new captures are queued.</DocP>
        <DocH3>Permissions</DocH3>
        <DocP>On macOS, missing screen-recording permission prevents capture — grant access and restart the agent.</DocP>
      </DocSection>

      <DocSection title="Worked Today vs this session disagree">
        <DocP>
          Worked Today sums completed segments for the calendar day; the live session timer only covers the current open
          block. Idle exclusions and retroactive stops can shift totals after sync. Wait one heartbeat cycle, then
          refresh.
        </DocP>
      </DocSection>

      <DocSection title="Timezone and displayed time">
        <DocP>
          Organisation or user timezone preferences affect how midnight boundaries are drawn for “today”. If end-of-day
          totals look shifted, verify your profile timezone and compare with a colleague in another region — this is
          often expected, not a defect.
        </DocP>
      </DocSection>

      <DocSection title="Sync delays">
        <DocList>
          <DocLi>Desktop agent syncs on an interval — allow up to one minute for UI parity.</DocLi>
          <DocLi>Large backlogs after offline work may process sequentially; keep the agent online until the queue drains.</DocLi>
        </DocList>
      </DocSection>
    </div>
  );
}
