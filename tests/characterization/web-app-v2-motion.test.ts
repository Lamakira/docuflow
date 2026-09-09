import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { authenticatedPresentation } from "../../client/src/v2/presentation";

/**
 * v2 motion substrate (#182). Later tickets inherit this system.
 * Seams: motionForSurface (Gate) + tokens.css (runtime). Do not assert
 * cubic-beziers, millisecond durations, or hex. HTTP `/api/*` stays elsewhere.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("v2 motion substrate (#182)", () => {
  it("declares shared ease-out and ease-drawer tokens for ordinary UI motion", () => {
    expect(css).toMatch(/--ease-out\s*:/);
    expect(css).toMatch(/--ease-drawer\s*:/);
    expect(css).not.toMatch(/transition\s*:\s*all\b/);
    expect(css).not.toMatch(/scale\(\s*0\s*\)/);
    expect(css).not.toMatch(/(?<![-\w])ease-in(?!-out)/);
  });

  it("keeps flag-off v1 chrome unchanged", () => {
    expect(authenticatedPresentation(false)).toEqual({
      chrome: "v1",
      signedInHome: "home",
    });
  });

  it("opens search with / or the search field with no enter/exit and no scrim fade", () => {
    const search = motionForSurface("search-overlay");
    expect(search.enterExit).toBe("instant");
    expect(search.movement).toBe("none");
    expect(motionForSurface("command-palette").enterExit).toBe("instant");
    expect(motionForSurface("focus-jump").enterExit).toBe("instant");
    expect(rule(".df-overlay")).toMatch(/transition:\s*none/);
    expect(rule(".df-overlay")).toMatch(/animation:\s*none/);
    expect(rule(".df-overlay-scrim")).toMatch(/transition:\s*none/);
    expect(rule(".df-overlay-scrim")).toMatch(/animation:\s*none/);
    expect(css).not.toMatch(/\.df-overlay[^{]*\{[^}]*@starting-style/);
  });

  it("clicks a rail destination with no enter/exit", () => {
    const rail = motionForSurface("rail-destination");
    expect(rail.enterExit).toBe("instant");
    expect(rail.movement).toBe("none");
    expect(rule(".df-main")).toMatch(/transition:\s*none/);
    expect(rule(".df-main")).toMatch(/animation:\s*none/);
  });

  it("gives chrome pressables near-imperceptible press feedback", () => {
    expect(motionForSurface("chrome-press").press).toBe("scale");
    expect(css).toMatch(/:active[^{]*\{[^}]*scale\(0\.97\)/);
    expect(css).toMatch(/transition:[^;]*transform[^;]*var\(--ease-out\)/);
  });

  it("drops movement and keeps opacity under prefers-reduced-motion", () => {
    const reduced = motionForSurface("chrome-press", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.press).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    const railReduced = motionForSurface("rail-collapse", { reducedMotion: true });
    expect(railReduced.movement).toBe("none");
    expect(railReduced.keepOpacity).toBe(true);

    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(reducedMotionCss()).toMatch(/transform:\s*none/);
    expect(reducedMotionCss()).not.toMatch(/opacity:\s*0/);
  });
});

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
