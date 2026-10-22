import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
