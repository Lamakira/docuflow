import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { isWonStatus, opportunityStageFromCombined, projectStatusFromCombined } from "../../shared/projectLifecycle";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  canChangeOpportunityStage,
  combinedStatusForStage,
  composeOpportunityPipeline,
  composeOpportunityStages,
  FALLBACK_OPEN_STAGES,
  opportunityWriteRefusal,
  stageOptionsFromFieldOptions,
  opportunityHref,
  reopenStageOf,
  TERMINAL_PREVIEW,
  composeOpportunityRecord,
  opportunityCardActions,
  type OpportunityPipelineInput,
  type OpportunityPipelineRowInput,
} from "../../client/src/v2/opportunities";

/**
 * Opportunities live pipeline (#187).
 * Seams: matchV2Route (flagged app chrome) and compose helpers over existing `/api/*`.
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function row(overrides: Partial<OpportunityPipelineRowInput> = {}): OpportunityPipelineRowInput {
  return {
    id: "opp-1",
    name: "Harbour survey",
    clientName: "Harbour Shipping",
    combinedStatus: "lead",
    projectType: "one_time",
    isDocumentationOnly: 0,
    ...overrides,
  };
}

function emptyPipeline(overrides: Partial<OpportunityPipelineInput> = {}): OpportunityPipelineInput {
  return {
    stages: composeOpportunityStages(FALLBACK_OPEN_STAGES),
    rows: [],
    filterQuery: "",
    changingId: null,
    now: new Date("2026-11-19T10:00:00Z"),
    ...overrides,
  };
}

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Opportunities.tsx"),
  "utf8",
);
const notifySource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/notify.ts"),
  "utf8",
);
const commandBarSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2CommandBar.tsx"),
  "utf8",
);
const recordLabelSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/useRecordLabel.ts"),
  "utf8",
);

describe("Opportunities routing (#187)", () => {
  it("names a top-level page only by its Workspace crumb, and keeps a record's full breadcrumb", () => {
    // The page title and the active sidebar item already name a top-level page.
    expect(breadcrumbFor("/opportunities", "Harbor Co")).toEqual([{ label: "Harbor Co" }]);
    expect(breadcrumbFor("/opportunities/opp-1", "Harbor Co")).toEqual([
      { label: "Harbor Co", href: "/" },
      { label: "Opportunities", href: "/opportunities" },
      { label: "Opportunity" },
    ]);
    // The record's crumb is its name; "trim to the Workspace" never applies to it.
    expect(breadcrumbFor("/opportunities/opp-1", "Harbor Co", "Ledger renewal")).toEqual([
      { label: "Harbor Co", href: "/" },
      { label: "Opportunities", href: "/opportunities" },
      { label: "Ledger renewal" },
    ]);
    expect(breadcrumbFor("/platform/users", "Harbor Co")).toEqual([{ label: "PLATFORM" }]);
  });

  it("shows a live pipeline on the rail Opportunities destination", () => {
    const match = matchV2Route("/opportunities");
    expect(match.kind).toBe("opportunities");
    expect(navIdForPath("/opportunities")).toBe("opportunities");
    expect(breadcrumbFor("/opportunities", "Harbor Co").map((crumb) => crumb.label)).toEqual(["Harbor Co"]);
    expect(appSource).toContain("V2OpportunitiesPage");
    expect(appSource).toMatch(/path="\/opportunities"/);
    expect(appSource).toMatch(/path="\/opportunities"\s+component=\{V2OpportunitiesPage\}/);
    expect(pageSource).toContain('motionForSurface("opportunity-stage-change")');
    expect(pageSource).toContain("DragDropContext");
    expect(pageSource).toContain("Droppable");
    expect(pageSource).toContain("Draggable");
    expect(pageSource).toContain("isDragDisabled");
    expect(pageSource).toContain("renderClone");
    expect(pageSource).toContain("getContainerForClone");
    expect(pageSource).toContain("opportunityCloneRoot");
    expect(pageSource).toContain("isOpportunityCardClick");
    expect(pageSource).toContain("setLocation");
    expect(pageSource).not.toContain("df-opportunity-move");
    expect(pageSource).not.toContain("Move {card.name}");
    expect(pageSource).not.toContain("df-opportunity-stage-input");
    expect(pageSource).not.toContain("df-opportunity-stage-control");
  });

  it("opens a pipeline card as an Opportunity record, not a Project Dossier (#213)", () => {
    expect(opportunityHref("opp-1")).toBe("/opportunities/opp-1");
    expect(matchV2Route("/opportunities/opp-1")).toMatchObject({
      kind: "opportunity-record",
      opportunityId: "opp-1",
    });
    expect(appSource).toContain("V2OpportunityRecordPage");
    expect(appSource).toMatch(/path="\/opportunities\/:id"/);
  });
});

describe("Opportunity record (#213)", () => {
  it("keeps sales identity separate from delivery work", () => {
    const record = composeOpportunityRecord({
      id: "opp-1",
      name: "Ledger renewal",
      clientName: "Harbor Co",
      combinedStatus: "won_in_progress",
      projectType: "one_time",
      isDocumentationOnly: 0,
    });

    expect(record).toMatchObject({
      title: "Ledger renewal",
      clientLabel: "Harbor Co",
      stage: "WON",
      terminal: true,
    });
    // A won Opportunity "may create a Client Project but is not itself delivery
    // work" (CONTEXT). The legacy rows share one id, so a link built from it
    // would point the Opportunity at itself; the record offers none.
    expect(JSON.stringify(record)).not.toContain("/projects/");
    expect(pageSource).not.toContain("linked Client Project");
  });

  it("says there is no Client with null, never a lone dash", () => {
    const bare = composeOpportunityRecord({
      id: "opp-2",
      name: "Cold lead",
      clientName: null,
      combinedStatus: "lead",
      projectType: "one_time",
      isDocumentationOnly: 0,
    });
    expect(bare.clientLabel).toBeNull();
    expect(bare.clientHref).toBeNull();
    expect(pageSource).toContain("record.clientLabel ? (");
    expect(pageSource).not.toContain('"TERMINAL"');
    expect(pageSource).not.toContain(">OPPORTUNITY<");
  });

  it("names the record in the breadcrumb from the page's cache entry", () => {
    expect(recordLabelSource).toContain('queryKey: ["/api/crm/projects", opportunityId]');
    expect(recordLabelSource).toContain("enabled: false");
    expect(commandBarSource).toContain("breadcrumbFor(location, workspaceName, recordLabel, ");
  });

  it("wears the stage as the pipeline's filled pill and keeps Edit in place while editing", () => {
    expect(composeOpportunityRecord({ id: "o", name: "N", combinedStatus: "lead", projectType: "one_time", isDocumentationOnly: 0 }).stageInk).toMatch(/^(light|dark)$/);
    expect(pageSource).toContain('data-ink={record.stageInk}');
    expect(pageSource).toContain("disabled={editing}");
    expect(pageSource).not.toContain("{editing ? null : (\n              <Button");
  });

  it("closes from the Stage card with Mark as won and Mark as lost, and says what each does", () => {
    expect(pageSource).toMatch(/variant="default"[^>]*onClick=\{\(\) => onOutcomeButton\("won"\)\}/);
    expect(pageSource).toMatch(/variant="outline"[^>]*onClick=\{\(\) => onOutcomeButton\("lost"\)\}/);
    expect(pageSource).toContain("else setOutcome({ kind, row });");
    expect(pageSource).toContain("A won Opportunity stays won; a lost one can be reopened.");
    expect(pageSource).toContain("Won: it is now a Client Project.");
    expect(pageSource).toContain("Lost. The reason stays with the Opportunity until it is reopened.");
    expect(pageSource).not.toContain('<span className="df-settings-label">Stage</span>');
  });

  it("tells the two failed loads apart and gives a way out of each", () => {
    expect(pageSource).toContain("This Opportunity is not in this Workspace, or it was deleted");
    expect(pageSource).toContain("This Opportunity could not be loaded");
    expect(pageSource).toContain("onRetry={() => refetch()}");
    expect(pageSource).toContain("Back to Opportunities");
  });

  it("names the record's layout columns apart from the pipeline's", () => {
    expect(pageSource).toContain('className="df-opportunity-record-column"');
    expect(pageSource).not.toMatch(/<div className="df-opportunity-column">/);
    expect(css).toMatch(/\.df-opportunity-record-column\s*\{/);
  });
});

describe("Opportunities pipeline from live Opportunity rows (#187)", () => {
  it("empty Workspace uses empty geometry and never shows sample names", () => {
    const pipeline = composeOpportunityPipeline(emptyPipeline());
    const blob = JSON.stringify(pipeline);

    expect(pipeline.empty).toBe(true);
    expect(pipeline.count).toBe(0);
    expect(pipeline.emptyState?.copy.toLowerCase()).toContain("opportunit");
    expect(pipeline.columns.some((column) => column.id === "won" && column.terminal)).toBe(true);
    expect(pipeline.columns.some((column) => column.id === "lost" && column.terminal)).toBe(true);
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("fills columns from Opportunity reads and keeps Won / Lost terminal", () => {
    const pipeline = composeOpportunityPipeline(
      emptyPipeline({
        rows: [
          row({ id: "opp-lead", name: "Harbour survey", combinedStatus: "lead" }),
          row({
            id: "opp-won",
            name: "Pier rebuild",
            combinedStatus: "won_in_progress",
            clientName: "Pier Surveyors",
          }),
          row({
            id: "opp-internal",
            name: "Internal tooling",
            projectType: "internal",
            combinedStatus: "lead",
          }),
          row({
            id: "opp-docs",
            name: "Handbook",
            isDocumentationOnly: 1,
            combinedStatus: "lead",
          }),
        ],
      }),
    );

    expect(pipeline.empty).toBe(false);
    expect(pipeline.columns.find((column) => column.id === "lead")?.cards.map((card) => card.id)).toEqual([
      "opp-lead",
    ]);
    const lead = pipeline.columns.find((column) => column.id === "lead")?.cards[0];
    expect(lead).toMatchObject({
      id: "opp-lead",
      projectHref: "/projects/opp-lead",
    });
    expect(lead!.recordHref).toBe("/opportunities/opp-lead");
    expect(matchV2Route(lead!.recordHref).kind).toBe("opportunity-record");
    const won = pipeline.columns.find((column) => column.id === "won")?.cards[0];
    expect(won).toMatchObject({
      id: "opp-won",
      name: "Pier rebuild",
      stage: "won",
      terminal: true,
      canChangeStage: false,
      projectHref: "/projects/opp-won",
    });
    expect(JSON.stringify(pipeline)).not.toContain("Internal tooling");
    expect(JSON.stringify(pipeline)).not.toContain("Handbook");
    expect(JSON.stringify(pipeline)).not.toContain("Keystone");
    expect(matchV2Route(won!.recordHref).kind).toBe("opportunity-record");
  });

  it("filters by name without inventing rows", () => {
    const pipeline = composeOpportunityPipeline(
      emptyPipeline({
        filterQuery: "pier",
        rows: [
          row({ id: "opp-1", name: "Pier survey", combinedStatus: "proposal_sent" }),
          row({ id: "opp-2", name: "Harbour survey", combinedStatus: "lead" }),
        ],
      }),
    );

    expect(pipeline.columns.flatMap((column) => column.cards).map((card) => card.id)).toEqual(["opp-1"]);
    expect(pipeline.empty).toBe(false);
    expect(pipeline.emptyState).toBeNull();
  });

  it("uses workspace-configurable open stages and collapses delivery statuses into Won", () => {
    const stages = composeOpportunityStages(
      stageOptionsFromFieldOptions([
        JSON.stringify({ label: "Qualified", color: "#3b82f6" }),
        JSON.stringify({ label: "Proposal Sent", color: "#f59e0b" }),
        JSON.stringify({ label: "Won - In Progress", color: "#14b8a6" }),
        "lost",
      ]),
    );

    expect(stages.map((stage) => stage.id)).toEqual(["qualified", "proposal_sent", "won", "lost"]);
    expect(stages.find((stage) => stage.id === "won")?.terminal).toBe(true);
    expect(stages.find((stage) => stage.id === "lost")?.terminal).toBe(true);
    expect(stages.find((stage) => stage.id === "qualified")?.terminal).toBe(false);
  });

  it("shows human Opportunity Stage names instead of stored slugs", () => {
    const stages = composeOpportunityStages(
      stageOptionsFromFieldOptions(["discovering_call_completed", "proposal_sent"]),
    );

    expect(stages.find((stage) => stage.id === "discovering_call_completed")?.label).toBe(
      "Discovering call completed",
    );
    expect(stages.find((stage) => stage.id === "proposal_sent")?.label).toBe("Proposal sent");

    const pipeline = composeOpportunityPipeline(
      emptyPipeline({
        stages,
        rows: [row({ combinedStatus: "discovering_call_completed", clientName: null })],
      }),
    );
    const card = pipeline.columns.find((column) => column.id === "discovering_call_completed")?.cards[0];
    expect(card?.stageLabel).toBe("Discovering call completed");
    expect(card?.clientLabel).toBe("");
  });
});

describe("Opportunity Stage writes (#187)", () => {
  it("lets open stages move, including to Won / Lost, and keeps terminals terminal", () => {
    expect(canChangeOpportunityStage("lead", "proposal_sent")).toBe(true);
    expect(canChangeOpportunityStage("lead", "won")).toBe(true);
    expect(canChangeOpportunityStage("in_negotiation", "lost")).toBe(true);
    expect(canChangeOpportunityStage("won", "lead")).toBe(false);
    expect(canChangeOpportunityStage("lost", "won")).toBe(false);
    expect(canChangeOpportunityStage("lead", "lead")).toBe(false);
  });

  it("writes the existing combined status column and does not regress a won delivery Project", () => {
    expect(combinedStatusForStage("proposal_sent")).toBe("proposal_sent");
    expect(combinedStatusForStage("won")).toBe("won");
    expect(combinedStatusForStage("lost")).toBe("lost");
    expect(combinedStatusForStage("won", "won_in_progress")).toBe("won_in_progress");
    expect(combinedStatusForStage("lead", "won_in_progress")).toBe("lead");
  });

  it("names the Workspace condition or Capability, never a generic permission denied", () => {
    expect(
      opportunityWriteRefusal({
        readOnly: true,
        workspaceName: "Harbor Co",
      }),
    ).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");

    expect(
      opportunityWriteRefusal({
        readOnly: false,
        workspaceName: "Harbor Co",
        errorMessage: "permission denied",
        ownerName: "Sam Lee",
      }),
    ).toBe("You do not have the Create Opportunities Capability. Sam Lee (Owner) can grant it.");

    expect(
      opportunityWriteRefusal({
        readOnly: false,
        workspaceName: "Harbor Co",
        errorMessage: "permission denied",
      }).toLowerCase(),
    ).not.toContain("permission denied");

    expect(
      opportunityWriteRefusal({
        readOnly: false,
        workspaceName: "Harbor Co",
        errorMessage: "permission denied",
        ownerName: "Sam Lee",
        capability: "Change Opportunity Stage",
      }),
    ).toBe("You do not have the Change Opportunity Stage Capability. Sam Lee (Owner) can grant it.");
  });
});

describe("Opportunity Stage-change motion (#187)", () => {
  it("moves the Opportunity between Stage columns and keeps reduced-motion from adding extra movement", () => {
    const motion = motionForSurface("opportunity-stage-change");
    expect(motion.enterExit).toBe("standard");
    expect(motion.keepOpacity).toBe(true);

    const reduced = motionForSurface("opportunity-stage-change", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);
    expect(reduced.enterExit).toBe("standard");

    expect(pageSource).toContain("DragDropContext");
    expect(pageSource).toContain("handleDragEnd");
    expect(css).not.toMatch(/\.df-opportunity-card\[data-motion/);
    expect(reducedMotionCss()).toMatch(/\.df-opportunity-card[^{]*\{[^}]*animation:\s*none/);
    expect(reducedMotionCss()).not.toMatch(/opacity:\s*0/);
  });

  it("does not animate pipeline scroll, column mount, or decorative card tilt", () => {
    expect(rule(".df-opportunity-pipeline")).toMatch(/transition:\s*none/);
    expect(rule(".df-opportunity-pipeline")).toMatch(/animation:\s*none/);
    expect(rule(".df-opportunity-pipeline")).toMatch(/scroll-behavior:\s*auto/);
    // The board's horizontal bar stays visible (F25): never hidden.
    expect(rule(".df-opportunity-pipeline")).not.toMatch(/scrollbar-width/);
    // As on Trello (F25): the board fills the page, every column is its height, and a
    // long column scrolls inside itself, during a drag too.
    expect(rule(".df-opportunity-pipeline")).toMatch(/align-items:\s*stretch/);
    expect(rule(".df-page:has(> .df-opportunity-pipeline[data-stacked=\"false\"])")).toMatch(/height:\s*100%/);
    expect(rule(".df-opportunity-pipeline[data-stacked=\"false\"]")).toMatch(/flex:\s*1 1 0/);
    expect(rule(".df-opportunity-pipeline[data-stacked=\"false\"] .df-opportunity-drop")).toMatch(/overflow-y:\s*auto/);
    // A horizontal trackpad swipe over the cards must reach the board: contain the vertical axis only.
    expect(rule(".df-opportunity-pipeline[data-stacked=\"false\"] .df-opportunity-drop")).toMatch(/overscroll-behavior-y:\s*contain/);
    expect(rule(".df-opportunity-pipeline[data-stacked=\"false\"] .df-opportunity-drop")).not.toMatch(/overscroll-behavior:/);
    // The column's scrollbar blends in: no arrows, no track, and scrollbar-width left unset,
    // since setting it makes Chrome ignore ::-webkit-scrollbar.
    expect(rule(".df-opportunity-pipeline[data-stacked=\"false\"] .df-opportunity-drop")).not.toMatch(/scrollbar-(width|color):/);
    expect(rule(".df-opportunity-pipeline[data-stacked=\"false\"] .df-opportunity-drop::-webkit-scrollbar-button")).toMatch(/display:\s*none/);
    expect(rule(".df-opportunity-pipeline[data-stacked=\"false\"] .df-opportunity-drop::-webkit-scrollbar-thumb")).toMatch(/background:\s*transparent/);
    expect(rule(".df-opportunity-pipeline[data-stacked=\"false\"] .df-opportunity-column:hover .df-opportunity-drop::-webkit-scrollbar-thumb")).toMatch(/background-color:[^;]*var\(--df-stage\)/);
    expect(rule(".df-opportunity-pipeline[data-dragging=\"true\"][data-stacked=\"true\"] .df-opportunity-drop")).toMatch(
      /overflow:\s*visible/,
    );
    expect(css).not.toMatch(/\.df-opportunity-pipeline\[data-dragging="true"\] \.df-opportunity-drop\s*[,{]/);
    // Every column head is one line, so no column's cards start lower than the others.
    expect(rule(".df-opportunity-column .df-card-head")).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule(".df-opportunity-column .df-card-head > .df-card-title")).toMatch(/min-width:\s*0/);
    expect(rule(".df-opportunity-column")).toMatch(/transition:\s*none/);
    expect(rule(".df-opportunity-column")).toMatch(/animation:\s*none/);
    expect(rule(".df-opportunity-drop")).toMatch(/transition:\s*none/);
    expect(rule(".df-opportunity-card")).toMatch(/transition:\s*none/);
    expect(rule(".df-opportunity-card")).toMatch(/animation:\s*none/);
    expect(rule(".df-opportunity-card")).toMatch(/cursor:\s*pointer/);
    expect(rule(".df-v2 .df-opportunity-card[data-rfd-drag-handle-context-id]")).toMatch(
      /cursor:\s*pointer/,
    );
    expect(rule(".df-opportunity-card")).not.toMatch(/cursor:\s*grab;/);
    expect(rule(".df-opportunity-card[data-pressing=\"true\"]")).toMatch(/cursor:\s*grabbing/);
    expect(rule(".df-opportunity-card[data-dragging=\"true\"]")).toMatch(/cursor:\s*grabbing/);
    expect(rule(".df-opportunity-card")).toMatch(/align-self:\s*stretch/);
    expect(rule(".df-opportunity-card")).not.toMatch(/width:\s*100%/);
    expect(rule(".df-opportunity-card[data-dragging=\"true\"]")).toMatch(/box-shadow/);
  });
});

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function reducedMotionCss(): string {
  return [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n");
}

const V1_WORKSPACE_OPTIONS = [
  '{"label":"Lead","color":"#64748b"}',
  '{"label":"Discovering Call Completed","color":"#8b5cf6"}',
  '{"label":"Proposal Sent","color":"#f59e0b"}',
  '{"label":"Follow Up","color":"#06b6d4"}',
  '{"label":"In Negociation","color":"#3b82f6"}',
  '{"label":"Won","color":"#22c55e"}',
  '{"label":"Won - Not Started","color":"#10b981"}',
  '{"label":"Won - In Progress","color":"#14b8a6"}',
  '{"label":"Won - In Review (PM)","color":"#0ea5e9"}',
  '{"label":"Won - In Review (Client)","color":"#64748b"}',
  '{"label":"Won - Completed","color":"#84cc16"}',
  '{"label":"Lost","color":"#ef4444"}',
  '{"label":"Won-Cancelled","color":"#f43f5e"}',
];

describe("v1 statuses the lifecycle maps once did not know (#372)", () => {
  it("locks a column made on the fly for an unconfigured status, but not a configured custom stage", () => {
    const stages = composeOpportunityStages(stageOptionsFromFieldOptions([...V1_WORKSPACE_OPTIONS, '{"label":"Won - Paid"}']));
    const pipeline = composeOpportunityPipeline(
      emptyPipeline({
        stages,
        rows: [
          row({ id: "s", name: "Stray", combinedStatus: "won_on_hold" }),
          row({ id: "p", name: "Paid", combinedStatus: "won_paid" }),
        ],
      }),
    );
    const stray = pipeline.columns.find((c) => c.id === "won_on_hold");
    expect(stray?.locked).toBe(true);
    expect(stray?.cards.map((c) => c.canChangeStage)).toEqual([false]);
    const paid = pipeline.columns.find((c) => c.id === "won_paid");
    expect(paid?.locked).toBe(false);
    expect(paid?.cards.map((c) => c.canChangeStage)).toEqual([true]);
    expect(pipeline.columns.find((c) => c.id === "lead")?.locked).toBe(false);
  });

  it("maps the three v1 statuses to a stage and a Project Status", () => {
    expect(opportunityStageFromCombined("won_in_review_pm")).toBe("won");
    expect(opportunityStageFromCombined("won_in_review_client")).toBe("won");
    expect(opportunityStageFromCombined("in_negociation")).toBe("in_negotiation");
    expect(projectStatusFromCombined("won_in_review_pm")).toBe("in_review");
    expect(projectStatusFromCombined("won_in_review_client")).toBe("in_review");
    expect(projectStatusFromCombined("in_negociation")).toBe("planned");
  });

  it("keeps a custom open stage open and reads won statuses as won", () => {
    expect(opportunityStageFromCombined("won_paid")).toBe("won_paid");
    expect(opportunityStageFromCombined("wonderful_lead")).toBe("wonderful_lead");
    for (const status of ["won", "won_not_started", "won_in_review_pm", "won_cancelled"]) {
      expect(isWonStatus(status), status).toBe(true);
    }
    for (const status of ["won_paid", "lead", "lost", null]) {
      expect(isWonStatus(status), String(status)).toBe(false);
    }
  });

  it("composes the real Workspace's stages with five open stages", () => {
    const stages = composeOpportunityStages(stageOptionsFromFieldOptions(V1_WORKSPACE_OPTIONS));
    expect(stages.filter((s) => !s.terminal).map((s) => s.id)).toEqual([
      "lead",
      "discovering_call_completed",
      "proposal_sent",
      "follow_up",
      "in_negotiation",
    ]);
    expect(stages.slice(-2).map((s) => s.id)).toEqual(["won", "lost"]);
    expect(stages.find((s) => s.id === "in_negotiation")?.label).toBe("In Negociation");
  });

  it("puts the v1 rows in the won column or the negotiation column", () => {
    const pipeline = composeOpportunityPipeline(
      emptyPipeline({
        stages: composeOpportunityStages(stageOptionsFromFieldOptions(V1_WORKSPACE_OPTIONS)),
        rows: [
          row({ id: "a", name: "Alpha", combinedStatus: "won_in_review_pm" }),
          row({ id: "b", name: "Bravo", combinedStatus: "won_in_review_client" }),
          row({ id: "c", name: "Charlie", combinedStatus: "in_negociation" }),
        ],
      }),
    );
    const column = (id: string) => pipeline.columns.find((c) => c.id === id);
    expect(column("won")?.cards.map((c) => [c.id, c.canChangeStage])).toEqual([
      ["a", false],
      ["b", false],
    ]);
    expect(column("in_negotiation")?.cards.map((c) => [c.id, c.canChangeStage])).toEqual([["c", true]]);
    for (const id of ["won_in_review_pm", "won_in_review_client", "in_negociation"]) {
      expect(column(id)).toBeUndefined();
    }
  });
});

describe("Opportunities pipeline polish (F25, F27, F28, F30, F31)", () => {
  const lostRows = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      row({
        id: `lost-${index}`,
        name: `Lost ${index}`,
        combinedStatus: "lost",
        updatedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
      }),
    );
  const lostColumn = (input: Partial<OpportunityPipelineInput>) =>
    composeOpportunityPipeline(emptyPipeline(input)).columns.find((column) => column.id === "lost")!;

  it("keeps the 10 most recent cards of a Won or Lost column and says how many are left", () => {
    const column = lostColumn({ rows: lostRows(22) });
    expect(TERMINAL_PREVIEW).toBe(10);
    expect(column.cards).toHaveLength(10);
    expect(column.cards[0].id).toBe("lost-21");
    expect(column.total).toBe(22);
    expect(column.hiddenCount).toBe(12);
    expect(composeOpportunityPipeline(emptyPipeline({ rows: lostRows(22) })).count).toBe(22);
  });

  it("shows every card once expanded, and never caps a search", () => {
    const expanded = lostColumn({ rows: lostRows(22), expandedColumns: new Set(["lost"]) });
    expect(expanded.cards).toHaveLength(22);
    expect(expanded.hiddenCount).toBe(0);
    const searched = lostColumn({ rows: lostRows(22), filterQuery: "Lost" });
    expect(searched.cards).toHaveLength(22);
    expect(searched.hiddenCount).toBe(0);
    expect(lostColumn({ rows: lostRows(10) }).hiddenCount).toBe(0);
  });

  it("puts rows without a date last", () => {
    const column = lostColumn({ rows: [row({ id: "none", combinedStatus: "lost" }), ...lostRows(2)] });
    expect(column.cards.map((card) => card.id)).toEqual(["lost-1", "lost-0", "none"]);
  });

  it("gives a card its Owner initials and Expected close, overdue only while open", () => {
    const pipeline = composeOpportunityPipeline(
      emptyPipeline({
        rows: [
          row({ id: "a", ownerName: "Amina Kofi", closeDate: "2026-11-18T00:00:00.000Z" }),
          row({ id: "b", closeDate: "2026-11-19T00:00:00.000Z" }),
          row({ id: "c", combinedStatus: "lost", closeDate: "2026-01-01T00:00:00.000Z" }),
          row({ id: "d" }),
        ],
      }),
    );
    const card = (id: string) => pipeline.columns.flatMap((column) => column.cards).find((c) => c.id === id)!;
    expect(card("a")).toMatchObject({ ownerName: "Amina Kofi", ownerInitials: "AK", closeLabel: "18 Nov 2026", closeOverdue: true });
    expect(card("b")).toMatchObject({ ownerName: null, ownerInitials: null, closeLabel: "19 Nov 2026", closeOverdue: false });
    expect(card("c").closeOverdue).toBe(false);
    expect(card("d")).toMatchObject({ closeLabel: null, closeOverdue: false });
  });

  it("reopens to the stage the last loss left, else the first open stage", () => {
    const stages = composeOpportunityStages(FALLBACK_OPEN_STAGES);
    const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
    expect(
      reopenStageOf(
        [
          { fromStatus: "lead", toStatus: "lost", changedAt: at(1) },
          { fromStatus: "follow_up", toStatus: "lost", changedAt: at(5) },
        ],
        stages,
      ),
    ).toBe("follow_up");
    expect(reopenStageOf([{ fromStatus: "won", toStatus: "lost", changedAt: at(1) }], stages)).toBe("lead");
    expect(reopenStageOf([{ fromStatus: "gone_stage", toStatus: "lost", changedAt: at(1) }], stages)).toBe("lead");
    expect(reopenStageOf([{ fromStatus: null, toStatus: "lost", changedAt: at(1) }], stages)).toBe("lead");
    expect(reopenStageOf([], stages)).toBe("lead");
  });

  it("renders the card as a link, hides New Opportunity when read-only, offers Undo, and keeps the board bar", () => {
    expect(pageSource).toMatch(/<a\s+ref=\{[\s\S]*?href=\{recordHref\}/);
    expect(pageSource).toContain("role={undefined}");
    expect(pageSource).not.toContain("window.open");
    expect(pageSource).toMatch(/\{readOnly \? null : \(\s*<Button[\s\S]*?New Opportunity/);
    expect(pageSource).toMatch(/notify\.success\(`Moved to \$\{labelOf\(status\)\}`, \{[\s\S]*?action: \{ label: "Undo"/);
    expect(notifySource).toContain("action?: { label: string; onClick: () => void }");
    const pipelineRule = css.slice(css.indexOf(".df-opportunity-pipeline {"), css.indexOf("}", css.indexOf(".df-opportunity-pipeline {")));
    expect(pipelineRule).not.toContain("scrollbar-width");
    expect(css).not.toMatch(/\.df-opportunity-pipeline::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });
});

describe("Actions menu on a pipeline card", () => {
  const stages = composeOpportunityStages(FALLBACK_OPEN_STAGES);
  const openIds = stages.filter((stage) => !stage.terminal).map((stage) => stage.id);

  it("offers an open card every action, and moves it to any other open stage", () => {
    const actions = opportunityCardActions({ canChangeStage: true, readOnly: false, currentStage: "lead", stages });
    expect(actions).toMatchObject({ rename: true, owner: true, note: true, outcomes: true });
    expect(actions?.moveTo?.map((stage) => stage.id)).toEqual(openIds.filter((id) => id !== "lead"));
    expect(actions?.moveTo?.some((stage) => stage.id === "won" || stage.id === "lost")).toBe(false);
  });

  it("lets a Won or Lost card be renamed, given an Owner and a note, never moved", () => {
    for (const currentStage of ["won", "lost"]) {
      expect(opportunityCardActions({ canChangeStage: false, readOnly: false, currentStage, stages }), currentStage).toEqual({
        rename: true,
        owner: true,
        note: true,
        moveTo: null,
        outcomes: false,
      });
    }
  });

  it("offers nothing in a Read-only Workspace", () => {
    expect(opportunityCardActions({ canChangeStage: true, readOnly: true, currentStage: "lead", stages })).toBeNull();
    expect(opportunityCardActions({ canChangeStage: false, readOnly: true, currentStage: "won", stages })).toBeNull();
  });

  it("puts the menu beside the card's link, never inside it, and leaves it off the dragged clone", () => {
    expect(pageSource).toMatch(
      /<div ref=\{provided\.innerRef\} \{\.\.\.provided\.draggableProps\} className="df-opportunity-card-shell">\s*<a\s+ref=\{cardRef\}[\s\S]*?<\/a>\s*\{menu\}\s*<\/div>/,
    );
    expect(pageSource).toContain("{...provided.dragHandleProps}");
    expect(pageSource).toMatch(/return <OpportunityCardView card=\{card\} provided=\{provided\} dragging locked=\{false\} onOpen=\{\(\) => \{\}\} \/>;/);
    expect(pageSource).toContain("menu={cardMenu(card, column.id)}");
    expect(pageSource).toContain("ariaLabel={`Actions on ${card.name}`}");
    expect(rule(".df-opportunity-card-shell")).toMatch(/position:\s*relative/);
    expect(css).toMatch(/\.df-opportunity-pipeline\[data-dragging="true"\] \.df-opportunity-card-shell button\.df-btn\.df-opportunity-card-menu\s*\{[^}]*opacity:\s*0/);
  });

  it("opens a menu item's dialog only once the menu has closed, and hands focus back to the card's button", () => {
    // A dialog opened while the menu was closing left the page unclickable
    // after it closed (seen 2026-11-26 with Mark as won, then Escape).
    const rowMenu = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2RowMenu.tsx"), "utf8");
    expect(rowMenu).toContain("onCloseAutoFocus={onCloseAutoFocus}");
    expect(rowMenu).toMatch(/onSelect=\{\(\) => choose\(item\)\}/);
    expect(rowMenu).not.toMatch(/onSelect=\{item\.onSelect\}/);
    for (const testId of ["v2-opportunity-rename", "v2-opportunity-owner", "v2-opportunity-add-note"]) {
      expect(pageSource).toMatch(new RegExp(`testId="${testId}"\\s*onCloseAutoFocus=\\{focusCardMenu\\(row\\.id\\)\\}`));
    }
    expect(pageSource).toContain("onCloseAutoFocus={outcome.fromMenu ? focusCardMenu(row.id) : undefined}");
  });
});
