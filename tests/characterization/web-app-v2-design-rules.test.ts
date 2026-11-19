import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The rules in DESIGN.md that a pattern can catch. Each one is a correction the
 * owner made; DESIGN.md holds the why.
 */

const v2Dir = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");
const modelSources = readdirSync(v2Dir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, source: readFileSync(join(v2Dir, name), "utf8") }));
const css = readFileSync(join(v2Dir, "tokens.css"), "utf8");

describe("DESIGN.md › Copy", () => {
  it("builds no subtitle that only says '<Page> in <Workspace>.'", () => {
    const offenders = modelSources.flatMap(({ name, source }) =>
      [...source.matchAll(/subhead:\s*`[^`$]*\bin \$\{input\.workspaceName\}\.`/g)].map((match) => `${name}: ${match[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("DESIGN.md › Surfaces", () => {
  it("never sets scrollbar-width: thin outside the Firefox fallback, which brings the arrow buttons back in Chrome", () => {
    const withoutFallbacks = css.replace(/@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*?\n\}/g, "");
    expect(withoutFallbacks).not.toMatch(/scrollbar-width:\s*thin/);
  });
});
