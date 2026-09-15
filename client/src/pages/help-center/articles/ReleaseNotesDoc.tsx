import { DocArticle, DocSection, DocList, DocLi, DocP, DocStrong } from "@/components/help-center/DocBlocks";

export function ReleaseNotesDoc() {
  return (
    <DocArticle>
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
            <DocStrong>Time tracking &amp; idle</DocStrong> — ongoing refinements to idle prompts, Worked Today accuracy, and
            desktop/web parity.
          </DocLi>
          <DocLi>
            <DocStrong>Desktop agent</DocStrong> — packaging, signing, and activity capture improvements per platform.
          </DocLi>
          <DocLi>
            <DocStrong>CRM &amp; documentation</DocStrong> — incremental UX polish and module field controls for admins.
          </DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Staying informed">
        <DocP>
          Subscribe to internal comms from your administrators. For developers, the repository commit history remains the
          exhaustive source of truth between formal release notes.
        </DocP>
      </DocSection>
    </DocArticle>
  );
}
