import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { armedEdgeScroll, EDGE_SCROLL_MAX, EDGE_SCROLL_ZONE, edgeScrollStep } from "../../client/src/v2/boardEdgeScroll";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// A board 736px wide from x=264 to x=1000, as measured on the dev board.
const LEFT = 264;
const RIGHT = 1000;

describe("the board scrolls while a card is dragged near its edge (F111)", () => {
  it("does not scroll while the pointer is away from both edges", () => {
    expect(edgeScrollStep(600, LEFT, RIGHT)).toBe(0);
    expect(edgeScrollStep(RIGHT - EDGE_SCROLL_ZONE, LEFT, RIGHT)).toBe(0);
    expect(edgeScrollStep(LEFT + EDGE_SCROLL_ZONE, LEFT, RIGHT)).toBe(0);
  });

  it("scrolls right near the right edge, faster the closer it gets", () => {
    const entering = edgeScrollStep(RIGHT - EDGE_SCROLL_ZONE + 10, LEFT, RIGHT);
    const deep = edgeScrollStep(RIGHT - 10, LEFT, RIGHT);
    expect(entering).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(entering);
  });

  it("keeps full speed with the pointer past the edge, where the card's centre leaves the board", () => {
    expect(edgeScrollStep(RIGHT + 40, LEFT, RIGHT)).toBe(EDGE_SCROLL_MAX);
    expect(edgeScrollStep(LEFT - 40, LEFT, RIGHT)).toBe(-EDGE_SCROLL_MAX);
  });

  it("scrolls left near the left edge", () => {
    expect(edgeScrollStep(LEFT + 10, LEFT, RIGHT)).toBeLessThan(0);
  });

  it("narrows the band on a narrow board so the middle never scrolls", () => {
    expect(edgeScrollStep(150, 100, 300)).toBe(0);
    expect(edgeScrollStep(295, 100, 300)).toBeGreaterThan(0);
  });

  it("does not move the board for a card lifted near an edge until the pointer has left that edge", () => {
    let arming = { left: false, right: false };
    // Lifted 20px from the right edge: nothing moves.
    let frame = armedEdgeScroll(arming, RIGHT - 20, LEFT, RIGHT);
    expect(frame.step).toBe(0);
    arming = frame.arming;
    // The pointer goes to the middle, then back to the edge: now it scrolls.
    arming = armedEdgeScroll(arming, 600, LEFT, RIGHT).arming;
    frame = armedEdgeScroll(arming, RIGHT - 20, LEFT, RIGHT);
    expect(frame.step).toBeGreaterThan(0);
    // Lifted near the left edge: the same, until the pointer has been away from it.
    expect(armedEdgeScroll({ left: false, right: false }, LEFT + 10, LEFT, RIGHT).step).toBe(0);
    expect(armedEdgeScroll(armedEdgeScroll({ left: false, right: false }, 600, LEFT, RIGHT).arming, LEFT + 10, LEFT, RIGHT).step).toBeLessThan(0);
  });

  it("switches the columns off scrolling before the drag library measures, on both boards, and starts the edge scroll then", () => {
    const shared = read("client/src/v2/boardEdgeScroll.ts");
    expect(shared).toMatch(/beforeCapture\(\) \{[\s\S]*?setAttribute\("data-dragging", "true"\)[\s\S]*?startBoardEdgeScroll\(board\)/);
    expect(shared).toMatch(/end\(\) \{[\s\S]*?stop\.current\?\.\(\)[\s\S]*?setAttribute\("data-dragging", "false"\)/);
    for (const file of ["client/src/v2/V2Opportunities.tsx", "client/src/v2/V2Projects.tsx"]) {
      const board = read(file);
      expect(board, file).toContain("onBeforeCapture={boardDrag.beforeCapture}");
      expect(board, file).not.toContain("onDragStart=");
      expect(board, file).toContain("boardDrag.end();");
    }
    const css = read("client/src/v2/tokens.css");
    expect(css).toMatch(
      /\.df-opportunity-pipeline\[data-stacked="false"\]\[data-dragging="true"\] \.df-opportunity-drop \{\s*overflow-y: hidden;/,
    );
  });
});
