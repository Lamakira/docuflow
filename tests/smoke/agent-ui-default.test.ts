import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chromeModeFor, expectsV2Ui } from "../../desktop-agent/src/lib/windowChrome";

/**
 * Agent 0.2.0 shipped v1's screens: both renderer entries chose v2 only when
 * the build set DOCUFLOW_UI=v2, and the release builds set nothing. v2 is now
 * the default, in the main window and the floating bar alike; v1 is opt-in.
 */
describe("desktop agent UI default", () => {
  for (const entry of ["index.tsx", "widget-index.tsx"]) {
    it(`${entry} opens v2 unless v1 is asked for`, () => {
      const source = readFileSync(`desktop-agent/src/renderer/${entry}`, "utf8");
      expect(source).toContain("return process.env.DOCUFLOW_UI !== 'v1';");
      expect(source).not.toContain("process.env.DOCUFLOW_UI === 'v2'");
    });
  }
});

/**
 * The main process builds the window before the renderer picks a UI, so it has
 * to guess the same way. 0.2.1 guessed v1 on a fresh install: a square, framed
 * window around the v2 UI on its first launch.
 */
describe("desktop agent first window", () => {
  it("expects v2 on a fresh install, as the renderer defaults", () => {
    expect(expectsV2Ui(null, undefined)).toBe(true);
    expect(expectsV2Ui(null, "")).toBe(true);
    expect(chromeModeFor("linux", expectsV2Ui(null, undefined))).toBe("app");
  });

  it("follows the UI the renderer last reported, then the build's v1 opt-in", () => {
    expect(expectsV2Ui("v1", undefined)).toBe(false);
    expect(expectsV2Ui("v2", "v1")).toBe(true);
    expect(expectsV2Ui(null, "v1")).toBe(false);
  });

  it("asks windowChrome, not a v1-first check, in the main process", () => {
    const main = readFileSync("desktop-agent/src/main/index.ts", "utf8");
    expect(main).toContain("expectsV2Ui(store.getUiMode(), process.env.DOCUFLOW_UI)");
    expect(main).not.toContain("process.env.DOCUFLOW_UI === 'v2' || store.getUiMode() === 'v2'");
  });
});

/** #332 item 2: the v2 agent wore the old "DF" monogram after #326 rebranded everything else. */
describe("desktop agent v2 brand mark", () => {
  for (const [file, variant] of [
    ["pages/LoginPage.tsx", "tile"],
    ["components/Rail.tsx", "onDark"],
  ] as const) {
    it(`${file} shows the d-and-dot mark, not "DF"`, () => {
      const source = readFileSync(`desktop-agent/src/renderer/app-v2/${file}`, "utf8");
      expect(source).toContain(`<BrandMark variant="${variant}"`);
      expect(source).not.toMatch(/>DF</);
    });
  }

  it("draws the mark from the brand geometry", () => {
    const mark = readFileSync("desktop-agent/src/renderer/app-v2/components/BrandMark.tsx", "utf8");
    expect(mark).toContain('<rect width="64" height="64" rx="14" fill="#0F1524" />');
    expect(mark).toContain('<circle cx="47" cy="46.25" r="4" fill="#E9A23B" />');
  });
});
