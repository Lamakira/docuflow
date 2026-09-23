import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every v2 destination waits the way Administration does: its real frame, its
 * real titles and column heads, and breathing bars where the values will be.
 * An empty card of a guessed height was the wait everywhere else, and it moved
 * the whole page when the data landed.
 */

const v2Dir = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");
const sources = readdirSync(v2Dir)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, source: readFileSync(join(v2Dir, name), "utf8") }));
const source = (name: string) => sources.find((file) => file.name === name)?.source ?? "";

describe("v2 waits with real geometry", () => {
  it("draws no empty placeholder card of a guessed height anywhere", () => {
    const offenders = sources
      .filter(({ source: text }) => /<div className="df-card" style=\{\{ minHeight: \d+/.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("shows no loading copy under the title while the skeleton is up", () => {
    const skeleton = source("V2Skeleton.tsx");
    expect(skeleton).not.toContain("Loading this Workspace");
    expect(skeleton).not.toMatch(/subhead\??:\s*string/);
    expect(skeleton).toMatch(/<h1 className="df-title">\{title\}<\/h1>\s*<SkeletonSubhead \/>/);
    const offenders = sources
      .filter(({ source: text }) => /<V2PageSkeleton[^>]*\bsubhead=/.test(text) || text.includes("LOADING_SUBHEAD"))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
    expect(source("V2Today.tsx")).toContain("<SkeletonSubhead />");
  });

  it.each([
    ["V2Today.tsx", ["Needs attention", "Active Projects", "Workday", "Recent knowledge changes"]],
    ["V2Projects.tsx", ["PROJECT / CLIENT", "BUDGET USED"]],
    ["V2Clients.tsx", ["CLIENT", "COMPANY", "SOURCE", "On this Client", "Client details"]],
    ["V2Opportunities.tsx", ["Opportunity record"]],
    ["V2People.tsx", ["MEMBER", "WORKSPACE ROLE", "CAPABILITIES"]],
    ["V2Time.tsx", ["Timer", "WHEN", "DURATION", "By Project", "By Member"]],
    ["V2Activity.tsx", ["Tracking Policy", "WHEN", "SOURCE"]],
    ["V2DailyUpdates.tsx", ["Today"]],
    ["V2DailyUpdate.tsx", ["Submitted today", "Submit today's update"]],
    ["V2Devices.tsx", ["Your Devices", "LAST SEEN"]],
    ["V2Dossier.tsx", ["Next actions", "Latest Daily Update", "Budget & time", "Project Documents"]],
  ])("%s waits with its own titles", (file, words) => {
    const text = source(file);
    expect(text).toContain('from "./V2Skeleton"');
    for (const word of words) expect(text).toContain(word);
  });

  it("gives the two Document registers the library frame and head", () => {
    for (const file of ["V2Documents.tsx", "V2ProjectDocumentation.tsx"]) {
      expect(source(file)).toMatch(/<V2PageSkeleton[\s\S]*?frame="library"[\s\S]*?<SkeletonLibrary/);
    }
  });

  it("draws the boards as columns, with a bar for a stage name not loaded yet", () => {
    expect(source("V2Opportunities.tsx")).toContain("<SkeletonBoard");
    expect(source("V2Projects.tsx")).toContain("<SkeletonBoard");
    expect(source("V2Skeleton.tsx")).toMatch(/label \? <h2 className="df-card-title">\{label\}<\/h2> : <SkeletonBar/);
  });

  it("keeps a screen reader told, once, that the page is loading", () => {
    const skeleton = source("V2Skeleton.tsx");
    expect(skeleton).toContain('aria-busy="true"');
    expect(skeleton).toContain('role="status"');
  });
});
