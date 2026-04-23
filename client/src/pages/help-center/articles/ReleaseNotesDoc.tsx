import { DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";

export function ReleaseNotesDoc() {
  return (
    <div className="space-y-8">
      <DocSection title="How we publish updates">
        <DocP>
          DocuFlow ships the web app and desktop agent on independent cadences. Web changes appear after your browser
          loads the new bundle; desktop updates require installing the newer build from the Download page.
        </DocP>
      </DocSection>

      <DocSection title="Recent themes (v1 summary)">
        <DocP>
          This section will track notable user-facing changes. Until a formal changelog feed is wired here, rely on
          your team’s release announcements and GitHub release tags if your organisation links them.
        </DocP>
        <DocList>
          <DocLi>
            <strong className="text-foreground">Time tracking &amp; idle</strong> — ongoing refinements to idle prompts, Worked Today accuracy, and
            desktop/web parity.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">Desktop agent</strong> — packaging, signing, and activity capture improvements per platform.
          </DocLi>
          <DocLi>
            <strong className="text-foreground">CRM &amp; documentation</strong> — incremental UX polish and module field controls for admins.
          </DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Staying informed">
        <DocP>
          Subscribe to internal comms from your administrators. For developers, the repository commit history remains the
          exhaustive source of truth between formal release notes.
        </DocP>
      </DocSection>
    </div>
  );
}
