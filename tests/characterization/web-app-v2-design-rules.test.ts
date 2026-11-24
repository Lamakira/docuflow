import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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

const repo = join(v2Dir, "../../..");
const files = (dir: string): string[] =>
  readdirSync(join(repo, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : [],
  );

/** Everything the v2 app and its emails can show. v1 screens stay as they are; the help articles are v2's too. */
const shownPaths = [
  ...files("client/src").filter(
    (path) =>
      (!path.startsWith("client/src/pages/") || path.startsWith("client/src/pages/help-center/articles/")) &&
      path !== "client/src/lib/featureFlags.ts",
  ),
  "server/email.ts",
];

/** The string literals, template parts, and JSX text of a source: what it can show, its comments left out. */
function shownText(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(join(repo, path), "utf8"), ts.ScriptTarget.Latest, true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("DESIGN.md › Copy", () => {
  it("builds no subtitle that only says '<Page> in <Workspace>.'", () => {
    const offenders = modelSources.flatMap(({ name, source }) =>
      [...source.matchAll(/subhead:\s*`[^`$]*\bin \$\{input\.workspaceName\}\.`/g)].map((match) => `${name}: ${match[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it("shows no em dash", () => {
    const offenders = shownPaths.flatMap((path) =>
      shownText(path)
        .filter((text) => /\u2014|&mdash;/.test(text))
        // Thrown to the operator before any email is built.
        .filter((text) => !text.startsWith("RESEND_API_KEY"))
        .map((text) => `${path}: ${text.trim()}`),
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
