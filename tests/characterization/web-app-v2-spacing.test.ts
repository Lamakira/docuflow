import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Spacing, radius, and type for v2 (#256).
 * The scale is a closed set on `.df-v2`. A card uses one padding.
 */

const v2Dir = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");
const tokensPath = join(v2Dir, "tokens.css");
const css = readFileSync(tokensPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rootBlock(): string {
  const at = css.search(/\.df-v2\s*\{/);
  return css.slice(at, css.indexOf("}", at) + 1);
}

function defined(name: string): string[] {
  return [...css.matchAll(new RegExp(`${name}-(\\d+)\\s*:`, "g"))].map((match) => match[1]);
}

/** Subjects whose padding is the card's. One value, every side (#256). */
const CARD_SUBJECTS = [
  ".df-card-head",
  ".df-opportunity-card",
  ".df-empty",
  ".df-toolbar",
  ".df-figure-band",
  ".df-register-row",
  ".df-attention-row",
  ".df-knowledge-row",
  ".df-workday-row",
  ".df-table-cell",
  ".df-task-row",
  ".df-doc-row",
  ".df-contact-row",
  ".df-library-row",
  ".df-update-body",
  ".df-record-fields",
  ".df-form-actions",
  ".df-billing-actions",
  ".df-help-topic",
  ".df-analytics-figure",
  ".df-installer-row",
  ".df-blocker",
  ".df-action-bar",
  ".df-doc-callout",
  ".df-account-workspace",
  ".df-audio-recorder",
  ".df-kpi-grid",
  ".df-rollcall",
  ".df-refusal",
  ".df-ask-composer",
  ".df-notice-row",
  ".df-notice-foot",
];

function subject(selector: string): string {
  const parts = selector.trim().split(/\s+/);
  return parts[parts.length - 1] ?? selector;
}

describe("v2 scale (#256)", () => {
  it("defines a closed space scale", () => {
    const root = rootBlock();
    expect(root).toMatch(/--df-space-1:\s*4px/);
    expect(root).toMatch(/--df-space-2:\s*8px/);
    expect(root).toMatch(/--df-space-3:\s*12px/);
    expect(root).toMatch(/--df-space-4:\s*16px/);
    expect(root).toMatch(/--df-space-5:\s*20px/);
    expect(root).toMatch(/--df-space-6:\s*24px/);
    expect(root).toMatch(/--df-space-7:\s*32px/);
    expect(root).toMatch(/--df-space-8:\s*40px/);
    expect(defined("--df-space")).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("defines a closed radius scale", () => {
    const root = rootBlock();
    expect(root).toMatch(/--df-radius-1:\s*4px/);
    expect(root).toMatch(/--df-radius-2:\s*6px/);
    expect(root).toMatch(/--df-radius-3:\s*8px/);
    expect(root).toMatch(/--df-radius-4:\s*10px/);
    expect(defined("--df-radius")).toEqual(["1", "2", "3", "4"]);
  });

  it("defines a closed type scale", () => {
    const root = rootBlock();
    expect(root).toMatch(/--df-text-1:\s*10px/);
    expect(root).toMatch(/--df-text-2:\s*12px/);
    expect(root).toMatch(/--df-text-3:\s*14px/);
    expect(root).toMatch(/--df-text-4:\s*16px/);
    expect(root).toMatch(/--df-text-5:\s*20px/);
    expect(root).toMatch(/--df-text-6:\s*28px/);
    expect(defined("--df-text")).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("pads the card with one step on every side", () => {
    const seen = new Set<string>();
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(css))) {
      const selectors = match[1].split(",");
      const padding = match[2].match(/(?:^|[;\s])padding\s*:\s*([^;]+)/);
      if (!padding) continue;
      for (const selector of selectors) {
        const name = subject(selector);
        if (!CARD_SUBJECTS.includes(name)) continue;
        // The popover keeps a tight bottom; the card's own refusal copy does not.
        if (selector.includes("df-refusal-popover")) continue;
        // A card head is the card, including the compact column and the phone.
        // Other subjects keep a later phone override on the nearest step.
        if (name === ".df-card-head" || !seen.has(name)) {
          expect(padding[1].trim(), selector.trim()).toBe("var(--df-space-4)");
        }
        seen.add(name);
      }
    }
    expect(seen.has(".df-card-head")).toBe(true);
    expect(seen.has(".df-register-row")).toBe(true);
    expect(seen.has(".df-toolbar")).toBe(true);
    // Phone rows were 11×13 and 10×13. Nearest step is 12, not the card's 16.
    expect(css).toMatch(
      /\.df-v2\[data-chrome="mobile"\] \.df-attention-row \{[^}]*padding:\s*var\(--df-space-3\)/,
    );
    expect(css).toMatch(
      /\.df-v2\[data-chrome="mobile"\] \.df-register-row \{[^}]*padding:\s*var\(--df-space-3\)/,
    );
    expect(css).toMatch(
      /\.df-v2\[data-chrome="mobile"\] \.df-card-head \{[^}]*padding:\s*var\(--df-space-4\)/,
    );
  });

  it("keeps padding, gap, radius, and type on the scale", () => {
    const decl = /(padding(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap|border-radius|font-size)\s*:\s*([^;]+);/g;
    const stray: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = decl.exec(css))) {
      const property = match[1];
      const value = match[2];
      for (const length of value.matchAll(/(-?\d*\.?\d+)px\b/g)) {
        const px = Number(length[1]);
        if (px === 0) continue;
        if (property === "border-radius" && (px === 99 || px === 999)) continue;
        stray.push(`${property}: ${length[1]}px`);
      }
      if (property === "border-radius" && /%/.test(value)) continue;
    }
    expect(stray).toEqual([]);
  });

  it("keeps padding, gap, and margin out of inline styles", () => {
    const layout = /(?:^|[,{\s])(padding(?:Top|Right|Bottom|Left)?|gap|rowGap|columnGap|margin(?:Top|Right|Bottom|Left)?)\s*:/;
    const offenders: string[] = [];
    for (const name of readdirSync(v2Dir).filter((file) => file.endsWith(".tsx"))) {
      const src = readFileSync(join(v2Dir, name), "utf8");
      let i = 0;
      while ((i = src.indexOf("style={{", i)) !== -1) {
        let depth = 0;
        let quote: string | null = null;
        let j = i + "style=".length;
        for (; j < src.length; j++) {
          const c = src[j];
          if (quote) {
            if (c === "\\") { j += 1; continue; }
            if (c === quote) quote = null;
            continue;
          }
          if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
          if (c === "{") depth += 1;
          else if (c === "}") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        const body = src.slice(i, j + 1);
        const before = src.slice(Math.max(0, i - 240), i);
        if (layout.test(body) && !before.toLowerCase().includes("per-instance")) {
          offenders.push(`${name}:${src.slice(0, i).split("\n").length}`);
        }
        i = j + 1;
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves the parallel button classes off the screens", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(v2Dir).filter((file) => file.endsWith(".tsx"))) {
      const src = readFileSync(join(v2Dir, name), "utf8");
      if (/\bdf-(?:ghost|ink|icon|danger|file-zoom)-btn\b/.test(src)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
    expect(css).not.toMatch(/\.df-(?:ghost|ink|icon|danger|file-zoom)-btn\b/);
  });
});
