import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeOpportunityPipeline,
  composeOpportunityStages,
  stageOptionsFromFieldOptions,
} from "../../client/src/v2/opportunities";
import { composeProjectBoard } from "../../client/src/v2/projects";
import { STAGE_FALLBACK_COLOR, stageColor, stageInk } from "../../client/src/v2/stageColor";

/**
 * Colour on the v2 boards, as v1 had it. Each column wears its stage or
 * Project Status colour as a filled pill, over a light tint of the same hue.
 * Seams: stageColor / stageInk, composeProjectBoard, composeOpportunityPipeline.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, "../..", path), "utf8");

describe("a stage's colour", () => {
  it("is v1's colour for the same stage when nothing is configured", () => {
    expect(stageColor("proposal_sent")).toBe("#f59e0b");
    expect(stageColor("follow_up")).toBe("#06b6d4");
    expect(stageColor("lost")).toBe("#ef4444");
    expect(stageColor("something_new")).toBe(STAGE_FALLBACK_COLOR);
  });

  it("gives each Project Status the colour v1 gave its combined status", () => {
    expect(stageColor("planned")).toBe("#10b981");
    expect(stageColor("active")).toBe("#14b8a6");
    expect(stageColor("in_review")).toBe("#0ea5e9");
    expect(stageColor("completed")).toBe("#84cc16");
    expect(stageColor("archived")).toBe(STAGE_FALLBACK_COLOR);
  });

  it("takes a configured colour only when it is a hex colour", () => {
    expect(stageColor("proposal_sent", "#123ABC")).toBe("#123abc");
    // It lands in a style attribute, so anything else falls back.
    expect(stageColor("proposal_sent", "red; background:url(x)")).toBe("#f59e0b");
    expect(stageColor("proposal_sent", "")).toBe("#f59e0b");
  });

  it("puts the more legible ink on the pill, by contrast rather than habit", () => {
    // v1 wrote white on every pill: 2.15:1 on amber, 3.76:1 even on red.
    expect(stageInk("#f59e0b")).toBe("dark");
    expect(stageInk("#84cc16")).toBe("dark");
    expect(stageInk("#ef4444")).toBe("dark");
    expect(stageInk("#3b82f6")).toBe("dark");
    expect(stageInk(STAGE_FALLBACK_COLOR)).toBe("light");
  });
});

describe("the Projects board wears Project Status colours", () => {
  it("colours every column, empty ones included", () => {
    const board = composeProjectBoard({ workspaceName: "Harbor Co", projects: [], filterQuery: "", changingId: null });
    expect(board.columns.map((column) => [column.id, column.color, column.ink])).toEqual([
      ["planned", "#10b981", "dark"],
      ["active", "#14b8a6", "dark"],
      ["in_review", "#0ea5e9", "dark"],
      ["completed", "#84cc16", "dark"],
      ["archived", STAGE_FALLBACK_COLOR, "light"],
    ]);
  });
});

describe("the Opportunities pipeline wears the configured stage colours", () => {
  it("reads the colour an Administrator gave a stage, and v1's for the rest", () => {
    const stages = composeOpportunityStages(
      stageOptionsFromFieldOptions([
        JSON.stringify({ label: "Proposal Sent", color: "#8b5cf6" }),
        "follow_up",
      ]),
    );
    const pipeline = composeOpportunityPipeline({
      workspaceName: "Harbor Co",
      stages,
      rows: [],
      filterQuery: "",
      changingId: null,
    });
    const colors = Object.fromEntries(pipeline.columns.map((column) => [column.id, column.color]));
    expect(colors).toEqual({
      proposal_sent: "#8b5cf6",
      follow_up: "#06b6d4",
      won: "#22c55e",
      lost: "#ef4444",
    });
  });
});

describe("both boards draw the colour as a pill over a tint", () => {
  it("passes the colour as one custom property, not a hand-built style per element", () => {
    for (const page of ["client/src/v2/V2Projects.tsx", "client/src/v2/V2Opportunities.tsx"]) {
      const source = read(page);
      expect(source).toContain('"--df-stage": column.color');
      expect(source).toContain("df-stage-pill");
      expect(source).toContain("data-ink={column.ink}");
    }
  });

  it("tints the column lightly and fills the pill", () => {
    const css = read("client/src/v2/tokens.css");
    expect(css).toMatch(/\.df-opportunity-column\[data-staged="true"\]\s*\{[^}]*color-mix\(in srgb, var\(--df-stage\)/);
    expect(css).toMatch(/\.df-stage-pill\s*\{[^}]*background:\s*var\(--df-stage\)/);
  });
});
