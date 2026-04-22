import { DocH3, DocLi, DocList, DocP, DocSection } from "@/components/help-center/DocBlocks";

export function CrmProjectsDoc() {
  return (
    <div className="space-y-2">
      <DocSection title="Projects in Project Management">
        <DocP>
          Projects represent billable or trackable units of work — often a client engagement, internal initiative, or
          deliverable. Open <strong className="text-foreground">Project Management</strong> from the sidebar, then use the pipeline or list views
          your team adopted.
        </DocP>
        <DocList>
          <DocLi>Create a project from the new-project flow; assign a client where required.</DocLi>
          <DocLi>Fill mandatory CRM fields your administrator configured so reporting stays consistent.</DocLi>
          <DocLi>Archive or close completed projects according to your organisation policy instead of deleting history.</DocLi>
        </DocList>
      </DocSection>

      <DocSection title="Tasks">
        <DocH3>Creating tasks</DocH3>
        <DocP>
          Tasks live under projects. Add a task when work can be broken into trackable chunks (for example “Discovery
          workshop”, “Implementation sprint 2”). Tasks appear in the time tracker task picker when linked correctly.
        </DocP>
        <DocH3>Assignment and follow-up</DocH3>
        <DocP>
          Assign owners so dashboards and filters show who is accountable. Use descriptions or custom fields for
          acceptance criteria if your schema includes them.
        </DocP>
      </DocSection>

      <DocSection title="Naming and hygiene">
        <DocList>
          <DocLi>
            Prefer <strong className="text-foreground">clear, unique project names</strong> — avoid “Misc” or duplicate “Client A” without a
            qualifier.
          </DocLi>
          <DocLi>Align task names with how you describe work in timesheet descriptions to simplify audits.</DocLi>
          <DocLi>Use consistent casing (sentence case or title case) across the portfolio for readability.</DocLi>
        </DocList>
      </DocSection>
    </div>
  );
}
