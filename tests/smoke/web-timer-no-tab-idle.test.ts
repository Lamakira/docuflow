import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 2026-10-22: a browser tab left in the background for 3 minutes paused the
 * Timer the moment it came back, while the desktop agent was tracking real
 * keyboard and mouse input. Idle detection is the agent's; a tab coming back
 * only resyncs.
 */
describe("web Timer and a hidden tab", () => {
  const source = readFileSync("client/src/contexts/TimeTrackerContext.tsx", "utf8");

  it("never pauses the Timer because the tab was hidden", () => {
    expect(source).not.toMatch(/IDLE_THRESHOLD_MS/);
    expect(source).not.toMatch(/idle detected/i);
    const visibility = source.slice(source.indexOf("visibilitychange") - 400, source.indexOf("visibilitychange") + 200);
    expect(visibility).not.toMatch(/\/pause/);
  });

  it("still resyncs with the server when the tab comes back", () => {
    expect(source).toMatch(/if \(!document\.hidden\) invalidateAll\(\);/);
  });
});
