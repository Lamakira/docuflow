import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
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
  composeOpportunityRecord,
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
    workspaceName: "Harbor Co",
    stages: composeOpportunityStages(FALLBACK_OPEN_STAGES),
    rows: [],
    filterQuery: "",
    changingId: null,
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

describe("Opportunities routing (#187)", () => {
  it("shows a live pipeline on the rail Opportunities destination", () => {
    const match = matchV2Route("/opportunities");
    expect(match.kind).toBe("opportunities");
    expect(navIdForPath("/opportunities")).toBe("opportunities");
    expect(breadcrumbFor("/opportunities", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "OPPORTUNITIES",
    ]);
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
});

describe("Opportunities pipeline from live Opportunity rows (#187)", () => {
  it("empty Workspace uses empty geometry and never shows sample names", () => {
    const pipeline = composeOpportunityPipeline(emptyPipeline());
    const blob = JSON.stringify(pipeline);

    expect(pipeline.empty).toBe(true);
    expect(pipeline.count).toBe(0);
    expect(pipeline.emptyCopy.toLowerCase()).toContain("opportunit");
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
    expect(pipeline.emptyCopy).toBe("");
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
    expect(rule(".df-opportunity-pipeline")).toMatch(/scrollbar-width:\s*none/);
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
