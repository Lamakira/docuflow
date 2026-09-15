import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Row actions across the v2 chrome.
 * An action a User performs is a control and looks like one; navigation stays
 * a link. `.df-ghost-link` is a mono 10px annotation, so it may only carry a
 * `<Link>` or a label inside a row that is itself already clickable.
 */

const v2Dir = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");

const css = readFileSync(join(v2Dir, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function pages(): Array<{ name: string; source: string }> {
  return readdirSync(v2Dir)
    .filter((file) => file.startsWith("V2") && file.endsWith(".tsx"))
    .map((file) => ({ name: file, source: readFileSync(join(v2Dir, file), "utf8") }));
}

/** The JSX tag that owns a className, found by walking back from its line. */
function owningTag(lines: string[], index: number): string | null {
  for (let cursor = index; cursor > index - 8 && cursor >= 0; cursor -= 1) {
    const tags = lines[cursor].match(/<(button|Link|span|a)\b/g);
    if (tags) return tags[tags.length - 1].slice(1);
  }
  return null;
}

describe("v2 row actions look like controls", () => {
  it("never dresses a button as the quiet annotation", () => {
    const offenders: string[] = [];
    for (const page of pages()) {
      const lines = page.source.split("\n");
      lines.forEach((line, index) => {
        if (!line.includes('className="df-ghost-link"')) return;
        if (owningTag(lines, index) === "button") {
          offenders.push(`${page.name}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("still lets navigation and in-row labels stay quiet", () => {
    const keepers: string[] = [];
    for (const page of pages()) {
      const lines = page.source.split("\n");
      lines.forEach((line, index) => {
        if (!line.includes('className="df-ghost-link"')) return;
        const tag = owningTag(lines, index);
        if (tag === "Link" || tag === "span") keepers.push(`${page.name}:${index + 1}`);
      });
    }
    // A Link is navigation; a span inside an already-clickable row is a label,
    // and a control may not nest inside another control.
    expect(keepers.length).toBeGreaterThan(0);
  });

  it("gives an action control the one control height wherever it sits", () => {
    const at = css.indexOf(".df-row-actions .df-ghost-btn");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at) + 1);
    for (const container of [
      ".df-register-row",
      ".df-people-action",
      ".df-devices-confirm",
      ".df-card-head",
    ]) {
      expect(block).toContain(`${container} .df-ghost-btn`);
    }
    // Measured in Chrome: the button renders 34px, the action row 65px.
    expect(block).toMatch(/height:\s*var\(--df-control-h\)/);
  });
});
