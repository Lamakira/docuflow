/**
 * The pages a Project starts with when its documentation is turned on. Every
 * Workspace gets them, so they name no company, product, or way of billing
 * (F66).
 */

type Node = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };

const text = (value: string, bold = false) => ({ type: "text", text: value, ...(bold ? { marks: [{ type: "bold" }] } : {}) });

const heading = (level: 1 | 2 | 3, value: string): Node => ({
  type: "heading",
  attrs: { level, textAlign: null },
  content: [text(value, true)],
});

const paragraph = (value?: string): Node => ({
  type: "paragraph",
  attrs: { textAlign: null },
  ...(value ? { content: [text(value)] } : {}),
});

const list = (...items: string[]): Node => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
});

// `content` is the jsonb column's own type.
const page = (title: string, ...content: Node[]): { title: string; content: any } => ({
  title,
  content: { type: "doc", content },
});

export const DEFAULT_PROJECT_PAGES = [
  page(
    "Resources",
    heading(1, "Links"),
    paragraph("[Add the links this Project needs: sites, boards, shared folders]"),
    heading(1, "Conversations"),
    paragraph("[Add conversation references or summaries]"),
    heading(1, "Recordings"),
    paragraph("[Add meeting or call recording links]"),
    heading(1, "Files"),
    paragraph("[Add related Documents or attachments]"),
    heading(1, "Client notes"),
    paragraph("[Add the Client's notes and remarks]"),
  ),
  page(
    "Requirements",
    list("Client: [Client name]", "Prepared by: [Name]", "Date: [Date]", "Project: [Project name]"),
    heading(1, "1. Overview"),
    paragraph("[What this Project addresses: the current need, who it affects, and why it matters]"),
    heading(1, "2. Objectives"),
    paragraph("[What this Project aims to achieve]"),
    heading(1, "3. Scope of work"),
    heading(2, "Included"),
    list("[Item]"),
    heading(2, "Not included"),
    list("[Item]"),
    heading(1, "4. Detailed requirements"),
    heading(2, "4.1 [Requirement]"),
    heading(3, "Today"),
    paragraph("[How it works now]"),
    heading(3, "Expected"),
    paragraph("[How it should work]"),
    heading(1, "5. Rules"),
    list("[If this happens, then that]"),
    heading(1, "6. Constraints"),
    list("[What must not change or break]"),
    heading(1, "7. Acceptance criteria"),
    paragraph("The Project is complete when:"),
    list("[Criterion]"),
  ),
  page(
    "Deliverables",
    heading(1, "For the Client"),
    list("[Deliverable]"),
    heading(1, "Internal"),
    list("[Deliverable]"),
  ),
];
