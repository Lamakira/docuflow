import { DocH3, DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";

export function DevicesEntriesDoc() {
  return (
    <div className="space-y-2">
      <DocSection title="Entries (Time Tracking → Entries)">
        <DocP>
          Entries are the chronological log of time sessions — start time, end time, project, task, and optional notes.
          Use filters to isolate a user, project, or date range. Export or copy values when reconciling with invoices.
        </DocP>
        <DocList>
          <DocLi>Open an entry row to inspect adjustments or idle exclusions applied by policy.</DocLi>
          <DocLi>Overlapping entries usually indicate two devices or a race; resolve by stopping duplicate timers.</DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Devices">
        <DocP>
          The Devices page lists registered desktop agents and their last-seen metadata. Treat a device as trusted only
          if you recognise the hostname. Revoke or ask an admin to revoke stale devices after hardware refresh.
        </DocP>
        <DocH3>Interpreting status</DocH3>
        <DocList>
          <DocLi><strong className="text-foreground">Online / recent heartbeat</strong> — agent is syncing normally.</DocLi>
          <DocLi><strong className="text-foreground">Stale</strong> — user may be offline or the agent is not running.</DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Screencasts">
        <DocP>
          When the screencasts feature flag is enabled, this area surfaces captured segments tied to tracked time. Use it
          for coaching or dispute resolution — always follow privacy rules defined by your organisation.
        </DocP>
      </DocSection>

      <DocSection title="Dashboard">
        <DocP>
          The dashboard aggregates trends: distribution of time across projects, activity signals, and high-level KPIs.
          Pair dashboard review with raw entries when investigating anomalies.
        </DocP>
      </DocSection>
    </div>
  );
}
