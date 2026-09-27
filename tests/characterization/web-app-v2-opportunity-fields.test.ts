import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeOpportunityForm,
  composeOpportunityHistory,
  composeOpportunityNotes,
  composeOpportunityPipeline,
  composeOpportunityRecord,
  composeOpportunityStages,
  FALLBACK_OPEN_STAGES,
  formatMoney,
  lostReasonOptions,
  newOpportunityDraft,
  newOpportunityPayload,
  opportunityDraft,
  opportunityLostPath,
  readAmount,
  readLostDraft,
  readWinDraft,
  winDraft,
  winProjectTypeOptions,
  withSavedChoice,
  type OpportunityPipelineRowInput,
  type SavedOpportunity,
} from "../../client/src/v2/opportunities";

/**
 * An Opportunity's fields (#276): Owner, Expected close, Source, Estimated
 * value, notes, Stage history, and the questions Won and Lost ask.
 */

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "../../client/src/v2/V2Opportunities.tsx"), "utf8");
const css = readFileSync(join(here, "../../client/src/v2/tokens.css"), "utf8");

const spaced = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
const stages = composeOpportunityStages(FALLBACK_OPEN_STAGES);

function row(overrides: Partial<OpportunityPipelineRowInput> = {}): OpportunityPipelineRowInput {
  return {
    id: "opp-1",
    name: "Harbour survey",
    clientName: "Harbour Shipping",
    combinedStatus: "proposal_sent",
    projectType: "one_time",
    isDocumentationOnly: 0,
    ...overrides,
  };
}

const saved: SavedOpportunity = {
  name: "Harbour survey",
  clientId: "client-1",
  opportunityOwnerId: "user-1",
  dueDate: "2026-10-15T00:00:00.000Z",
  source: "zoho",
  estimatedValueMinor: 450000,
  estimatedValueCurrency: "EUR",
};

describe("Estimated value", () => {
  it("formats money in its own currency, minor units only when there are some", () => {
    expect(spaced(formatMoney(450000, "EUR"))).toBe("4 500 €");
    expect(spaced(formatMoney(120050, "USD"))).toBe("1 200,50 $");
    expect(spaced(formatMoney(3000, "MAD"))).toContain("30");
  });

  it("reads an amount as typed into minor units, and blank as no value", () => {
    expect(readAmount("4500", "EUR")).toEqual({ minor: 450000, issue: null });
    expect(readAmount("4 500,5", "EUR")).toEqual({ minor: 450050, issue: null });
    expect(readAmount("4500.50", "USD")).toEqual({ minor: 450050, issue: null });
    expect(readAmount("  ", "EUR")).toEqual({ minor: null, issue: null });
    expect(readAmount("12.345", "EUR").issue).toMatch(/amount/);
    expect(readAmount("abc", "EUR").issue).toMatch(/amount/);
    expect(readAmount("99999999999", "EUR").issue).toBe("That Estimated value is too large.");
  });

  it("totals each stage column once per currency and never adds currencies together", () => {
    const pipeline = composeOpportunityPipeline({
      workspaceName: "Harbour",
      stages,
      filterQuery: "",
      changingId: null,
      rows: [
        row({ id: "a", estimatedValueMinor: 300000, estimatedValueCurrency: "EUR" }),
        row({ id: "b", estimatedValueMinor: 150000, estimatedValueCurrency: "EUR" }),
        row({ id: "c", estimatedValueMinor: 120000, estimatedValueCurrency: "USD" }),
        row({ id: "d" }),
        row({ id: "e", combinedStatus: "lead", estimatedValueMinor: 5000, estimatedValueCurrency: "GBP" }),
      ],
    });
    const proposal = pipeline.columns.find((column) => column.id === "proposal_sent")!;
    expect(proposal.cards).toHaveLength(4);
    expect(proposal.totals.map(spaced)).toEqual(["4 500 €", "1 200 $"]);
    expect(proposal.cards.map((card) => card.valueLabel && spaced(card.valueLabel))).toEqual([
      "3 000 €",
      "1 500 €",
      "1 200 $",
      null,
    ]);
    expect(pipeline.columns.find((column) => column.id === "lead")!.totals.map(spaced)).toEqual(["50 £"]);
    expect(pipeline.columns.find((column) => column.id === "follow_up")!.totals).toEqual([]);
  });

  it("shows the board totals beside each column's count", () => {
    expect(pageSource).toContain('column.totals.join(" · ")');
    expect(pageSource).toContain("card.valueLabel");
    expect(css).toMatch(/\.df-opportunity-totals,\s*\.df-opportunity-card-value\s*\{/);
  });
});

describe("New Opportunity and the Opportunity record", () => {
  it("posts the agreed fields, with the current user as Owner and an optional first note", () => {
    const draft = {
      ...newOpportunityDraft("user-1"),
      name: "  Harbour survey ",
      clientId: "client-1",
      closeDate: "2026-10-15",
      source: "zoho",
      amount: "4500",
      stage: "proposal_sent",
      note: "  Met at the fair. ",
    };
    expect(newOpportunityPayload(draft)).toEqual({
      body: {
        name: "Harbour survey",
        clientId: "client-1",
        opportunityOwnerId: "user-1",
        dueDate: "2026-10-15",
        source: "zoho",
        estimatedValueMinor: 450000,
        estimatedValueCurrency: "EUR",
        status: "proposal_sent",
      },
      note: "Met at the fair.",
      issue: null,
    });
    expect(newOpportunityPayload({ ...draft, stage: "won" }).body?.status).toBe("lead");
    expect(newOpportunityPayload({ ...draft, amount: "" }).body).toMatchObject({
      estimatedValueMinor: null,
      estimatedValueCurrency: null,
    });
    expect(newOpportunityPayload({ ...draft, name: " " }).issue).toBe("Name the Opportunity.");
  });

  it("sends only the keys that change, and the value with its currency", () => {
    const untouched = composeOpportunityForm(opportunityDraft(saved), saved);
    expect(untouched).toMatchObject({ dirty: false, canSave: false, patch: null });

    const changed = composeOpportunityForm(
      { ...opportunityDraft(saved), name: "Harbour audit", currency: "USD", closeDate: "" },
      saved,
    );
    expect(composeOpportunityForm({ ...opportunityDraft(saved), ownerId: "user-2" }, saved).patch).toEqual({
      opportunityOwnerId: "user-2",
    });
    expect(changed.patch).toEqual({
      projectName: "Harbour audit",
      dueDate: null,
      estimatedValueMinor: 450000,
      estimatedValueCurrency: "USD",
    });
    expect(composeOpportunityForm({ ...opportunityDraft(saved), amount: "lots" }, saved).canSave).toBe(false);
  });

  it("shows Owner, Expected close, Source, Estimated value and a link to the Client", () => {
    const record = composeOpportunityRecord({
      ...row({ estimatedValueMinor: 450000, estimatedValueCurrency: "EUR" }),
      stages,
      clientId: "client-1",
      owner: { firstName: "Amina", lastName: "Diallo" },
      dueDate: saved.dueDate,
      source: "zoho",
      sourceOptions: [{ value: "zoho", label: "Zoho" }],
    });
    expect(record.clientHref).toBe("/clients/client-1");
    expect(record.fields.map((field) => [field.label, spaced(field.value)])).toEqual([
      ["OWNER", "Amina Diallo"],
      ["EXPECTED CLOSE", "15 Oct 2026"],
      ["SOURCE", "Zoho"],
      ["ESTIMATED VALUE", "4 500 €"],
    ]);
    expect(record.lostReason).toBeNull();
    expect(JSON.stringify(record)).not.toContain("/projects/");
  });

  it("keeps a saved choice offered after its option left the list", () => {
    const options = [{ value: "zoho", label: "Zoho" }];
    expect(withSavedChoice(options, "trade_fair").map((option) => option.value)).toEqual(["zoho", "trade_fair"]);
    expect(withSavedChoice(options, "zoho")).toBe(options);
  });
});

describe("Mark as won and Mark as lost", () => {
  const types = winProjectTypeOptions([]);

  it("never offers Internal for the Client Project a win creates", () => {
    expect(types.map((option) => option.value)).toEqual(["one_time", "monthly", "hourly_budget"]);
  });

  it("prefills the Project Manager with the Owner and asks the budget in hours, never the value", () => {
    const opportunity = {
      projectType: null,
      opportunityOwnerId: "user-1",
      assigneeId: null,
      clientId: "client-1",
      budgetedHours: null,
      budgetedMinutes: null,
      estimatedValueMinor: 450000,
    };
    const draft = winDraft(opportunity, types);
    expect(draft).toEqual({ projectType: "one_time", hours: "", minutes: "", managerId: "user-1", clientId: "client-1" });

    const read = readWinDraft({ ...draft, hours: "40", minutes: "30", managerId: "user-2" }, { status: "proposal_sent", clientId: "client-1" });
    expect(read.payload).toEqual({
      status: "won",
      projectType: "one_time",
      budgetedHours: 40,
      budgetedMinutes: 30,
      assigneeId: "user-2",
    });
    expect(JSON.stringify(read.payload)).not.toContain("450000");
    // Another Project Manager leaves the Opportunity Owner as it is.
    expect(read.payload).not.toHaveProperty("opportunityOwnerId");
    expect(readWinDraft({ ...draft, projectType: "internal" }, { status: "lead", clientId: "client-1" }).issue).toBe(
      "Choose the Project type.",
    );
    expect(readWinDraft({ ...draft, clientId: "" }, { status: "lead", clientId: null }).issue).toBe(
      "Choose the Client this Client Project is for.",
    );
  });

  it("requires a Lost reason, with an optional detail, and edits it once Lost", () => {
    expect(lostReasonOptions([]).map((option) => option.label)).toEqual([
      "Price",
      "Timing",
      "Chose a competitor",
      "No response",
      "Other",
    ]);
    expect(readLostDraft({ reason: "", detail: "" }).issue).toBe("Choose a Lost reason.");
    expect(readLostDraft({ reason: "price", detail: "  Too high " }).payload).toEqual({
      lostReason: "price",
      lostReasonDetail: "Too high",
    });
    expect(readLostDraft({ reason: "timing", detail: "" }).payload).toEqual({
      lostReason: "timing",
      lostReasonDetail: null,
    });
    // v2 marks Lost through the route that requires the reason; v1's PATCH does not.
    expect(opportunityLostPath("opp-1")).toBe("/api/crm/projects/opp-1/lost");
    expect(pageSource).toContain('apiRequest("POST", opportunityLostPath(row.id), payload)');
  });

  it("shows the Lost reason on a Lost record only", () => {
    const lost = composeOpportunityRecord({
      ...row({ combinedStatus: "lost" }),
      lostReason: "chose_a_competitor",
      lostReasonDetail: "Went with a local firm",
      lostReasonOptions: lostReasonOptions([]),
    });
    expect(lost.lostReason).toEqual({ label: "Chose a competitor", detail: "Went with a local firm" });
    expect(composeOpportunityRecord({ ...row(), lostReason: "price" }).lostReason).toBeNull();
  });

  it("opens the dialogs on a drop onto Won or Lost instead of moving the card", () => {
    expect(pageSource).toMatch(/nextStage === "won" \|\| nextStage === "lost"/);
    expect(pageSource).toContain('title="Mark as won"');
    expect(pageSource).toContain('ariaLabel="Project Manager"');
    expect(pageSource).toContain('ariaLabel="Lost reason"');
  });
});

describe("The record's empty states", () => {
  it("chooses the Client in the record's form, and shows the Client card only once one is set", () => {
    expect(composeOpportunityRecord({ ...row(), clientName: null }).clientHref).toBeNull();
    expect(composeOpportunityRecord({ ...row(), clientId: "client-1" }).clientHref).toBe("/clients/client-1");

    expect(pageSource).toMatch(/\{record\.clientHref \? \(\s*<section className="df-card" data-testid="v2-opportunity-client">/);
    expect(pageSource).toContain('<Link href={record.clientHref}>Open Client</Link>');
    expect(pageSource).toContain('ariaLabel="Client"');
    expect(pageSource).not.toContain("No Client yet. Choose");
    expect(pageSource).not.toContain("v2-opportunity-client-empty");
    expect(pageSource).not.toContain("ChooseClientDialog");
  });

  it("asks for the Lost reason v1 never recorded", () => {
    const bare = composeOpportunityRecord({ ...row({ combinedStatus: "lost" }), lostReason: null });
    expect(bare).toMatchObject({ lostReason: null, lostReasonMissing: true });
    expect(composeOpportunityRecord({ ...row({ combinedStatus: "lost" }), lostReason: "price" }).lostReasonMissing).toBe(false);
    expect(composeOpportunityRecord(row()).lostReasonMissing).toBe(false);
    expect(pageSource).toContain("Add reason");
    expect(pageSource).toContain('"Add Lost reason"');
  });

  it("empties Stage history with the designed empty state, not a bare line", () => {
    const history = composeOpportunityHistory([], stages, new Date());
    expect(history.emptyState.title).toBe("No Stage changes yet");
    expect(pageSource).toContain('testId="v2-opportunity-stage-history-empty"');
    expect(pageSource).not.toMatch(/<p className="df-empty">\{history/);
  });
});

describe("Stage history and notes", () => {
  const now = new Date("2026-09-27T12:00:00Z");

  it("lists Stage changes newest first and leaves out a won Project's delivery moves", () => {
    const history = composeOpportunityHistory(
      [
        { id: "h1", fromStatus: null, toStatus: "lead", changedAt: "2026-09-01T09:00:00Z", changedBy: { firstName: "Amina" } },
        { id: "h2", fromStatus: "lead", toStatus: "proposal_sent", changedAt: "2026-09-10T09:00:00Z" },
        { id: "h3", fromStatus: "proposal_sent", toStatus: "won", changedAt: "2026-09-20T09:00:00Z" },
        { id: "h4", fromStatus: "won", toStatus: "won_in_progress", changedAt: "2026-09-25T09:00:00Z" },
      ],
      stages,
      now,
    );
    expect(history.rows.map((entry) => [entry.id, entry.from, entry.to])).toEqual([
      ["h3", "PROPOSAL SENT", "WON"],
      ["h2", "LEAD", "PROPOSAL SENT"],
      ["h1", null, "LEAD"],
    ]);
    expect(history.rows[0].held).toMatch(/so far$/);
    expect(history.rows[2].who).toBe("Amina");
    expect(composeOpportunityHistory([], stages, now)).toMatchObject({ empty: true });
  });

  it("composes a dated thread of notes with a designed empty state", () => {
    const thread = composeOpportunityNotes(
      [{ id: "n1", content: "Called the buyer.", createdAt: "2026-09-26T10:00:00Z", createdBy: { firstName: "Kofi" } }],
      now,
    );
    expect(thread.rows[0].meta).toContain("KOFI");
    expect(thread.rows[0].deleteConsequence).toMatch(/This cannot be undone\.$/);
    expect(composeOpportunityNotes([], now)).toMatchObject({
      empty: true,
      emptyState: { title: "No notes yet", action: "Write the first note" },
    });
  });

  it("builds every select, dialog and confirmation from the shared components", () => {
    expect(pageSource).not.toMatch(/<select\b/);
    expect(pageSource).toContain("<V2FilterSelect");
    expect(pageSource).toContain("<AlertDialogContent className=\"df-v2 df-alert\">");
    expect(pageSource).toContain('icon="notes"');
    expect(pageSource).toContain("opportunityNotesPath(result.crmProject.id)");
  });
});
