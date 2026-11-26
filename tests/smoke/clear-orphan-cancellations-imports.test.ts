import { build } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * The script is run from a Replit workspace whose install may lack Stripe's SDK
 * (2026-11-26: `Cannot find package 'stripe'`). Only `--check-stripe` reads
 * Stripe, so only that path may load it: no static import may reach it.
 */
describe("billing:clear-orphan-cancellations", () => {
  it("reaches Stripe's SDK only through the dynamic import --check-stripe takes", async () => {
    const result = await build({
      entryPoints: ["scripts/clear-orphan-cancellations.ts"],
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
      packages: "external",
      logLevel: "silent",
    });
    const inputs = result.metafile.inputs;
    const seen = new Set<string>();
    const reached: string[] = [];
    const walk = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      for (const edge of inputs[path]?.imports ?? []) {
        if (edge.kind === "dynamic-import") continue;
        if (edge.external) reached.push(edge.path);
        else walk(edge.path);
      }
    };
    walk("scripts/clear-orphan-cancellations.ts");
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.filter((path) => path === "stripe" || path.startsWith("stripe/"))).toEqual([]);
  });
});
