import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Typography (#325, Amendment 6). Geist replaces JetBrains Mono; recorded
 * values keep their column alignment through tabular figures.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(join(root, "client/src/v2/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(css|ts|tsx|html)$/.test(name) ? [path] : [];
  });
}

describe("v2 typography (#325)", () => {
  it("defines the data face as Geist", () => {
    expect(css).toMatch(/--df-font-data:\s*"Geist",\s*system-ui,\s*sans-serif;/);
  });

  it("loads Geist and no longer loads JetBrains Mono", () => {
    const html = readFileSync(join(root, "client/index.html"), "utf8");
    expect(html).toMatch(/family=Geist/);
    expect(html).not.toMatch(/JetBrains/i);
  });

  it("leaves no JetBrains Mono or --df-font-mono in client/src or index.html", () => {
    const files = [...sourceFiles(join(root, "client/src")), join(root, "client/index.html")];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/JetBrains Mono/);
      expect(text, file).not.toContain("--df-font-mono");
    }
  });

  it("sets tabular figures on every rule that uses the data face", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => match[2].includes("var(--df-font-data)"));
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) {
      expect(body, selector.trim()).toMatch(/font-variant-numeric:\s*tabular-nums/);
    }
  });

  it("keeps uppercase only on chips (stage pill, filed chip) and the internal back office scope", () => {
    const uppercase = [...css.matchAll(/([^{}]+)\{([^{}]*text-transform:\s*uppercase[^{}]*)\}/g)].map((match) => match[1]);
    expect(uppercase).toHaveLength(3);
    expect(uppercase.some((selector) => selector.includes(".df-stage-pill"))).toBe(true);
    expect(uppercase.some((selector) => selector.includes(".df-filed-chip"))).toBe(true);
    expect(uppercase.some((selector) => selector.includes(".df-backoffice-section"))).toBe(true);
  });

  it("gives the back office back the letter-spacing its label rules carried", () => {
    const scope = ":is(.df-backoffice-section, .df-backoffice-lines, .df-backoffice-register, .df-platform-page)";
    const spaced = [...css.matchAll(/([^{}]+)\{([^{}]*letter-spacing:\s*([\d.]+em)[^{}]*)\}/g)].filter((match) =>
      match[1].includes(scope),
    );
    const byClass = new Map<string, string>();
    for (const [, selector, , spacing] of spaced) {
      for (const name of selector.match(/\.df-[a-z-]+(?: th)?/g) ?? []) byClass.set(name, spacing);
    }
    for (const name of [".df-register-head", ".df-library-head", ".df-analytics-figure-label", ".df-settings-label", ".df-chart-table th"]) {
      expect(byClass.get(name), name).toBe("0.07em");
    }
    expect(byClass.get(".df-library-foot")).toBe("0.04em");
  });

  it("keeps Kind and Today attention-kind chips uppercase, and puts no letter-spacing on a label inline", () => {
    const dossier = readFileSync(join(root, "client/src/v2/dossier.ts"), "utf8");
    expect(dossier).toContain('return "INTERNAL"');
    const today = readFileSync(join(root, "client/src/v2/today.ts"), "utf8");
    expect(today).toContain('export type AttentionKind = "UPDATE" | "MENTION" | "REMINDER"');
    for (const name of readdirSync(join(root, "client/src/v2"))) {
      if (!/^V2.*\.tsx$/.test(name) || /^V2(BackOffice|Platform)/.test(name)) continue;
      expect(readFileSync(join(root, "client/src/v2", name), "utf8"), name).not.toContain("letterSpacing");
    }
  });

  it("leaves no uppercase form-field or section label in the Workspace screens", () => {
    // Badges and acronyms keep their case: the Projects view switcher, the Opportunity badge on a card, and URL.
    const kept = new Set(["LIST", "BOARD", "OPPORTUNITY", "URL"]);
    for (const name of readdirSync(join(root, "client/src/v2"))) {
      if (!/^V2.*\.tsx$/.test(name) || /^V2(BackOffice|Platform)/.test(name)) continue;
      const lines = readFileSync(join(root, "client/src/v2", name), "utf8").split("\n");
      const loud = lines.map((line) => line.trim()).filter((line) => /^[A-Z][A-Z0-9 /&-]{2,}$/.test(line) && !kept.has(line));
      expect(loud, name).toEqual([]);
    }
  });
});
