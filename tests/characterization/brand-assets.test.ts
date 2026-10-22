import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingScreen } from "../../client/src/components/LoadingScreen";
import { BrandLockup, BrandMark } from "../../client/src/v2/BrandMark";
import { createRefCounted } from "../../client/src/v2/useV2Fonts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const bytes = (rel: string) => readFileSync(join(ROOT, rel));

function pngSize(rel: string): [number, number] {
  const b = bytes(rel);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function icoSizes(rel: string): number[] {
  const b = bytes(rel);
  expect(b.readUInt16LE(2)).toBe(1);
  const n = b.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => {
    const o = 6 + 16 * i;
    const size = b.readUInt8(o) || 256;
    const len = b.readUInt32LE(o + 8);
    const off = b.readUInt32LE(o + 12);
    expect(b.subarray(off + 1, off + 4).toString("ascii")).toBe("PNG");
    expect(len).toBeGreaterThan(0);
    return size;
  });
}

/** Geometry of an SVG's shapes, ignoring colours and classes. */
function shapes(svg: string): string[] {
  return [...svg.matchAll(/<(circle|rect)\s([^>]*?)\/?>/g)].map(([, tag, attrs]) => {
    const pairs = [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)]
      .map(([, k, v]) => [k, v] as const)
      .filter(([k]) => !["fill", "stroke", "class"].includes(k))
      .map(([k, v]) => [k === "strokeWidth" ? "stroke-width" : k, v] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return `${tag} ${pairs.map(([k, v]) => `${k}=${v}`).join(" ")}`;
  });
}

describe("brand mark: the d and the dot (#326)", () => {
  it("pins the icon links and theme colour in client/index.html", () => {
    const html = read("client/index.html");
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
    expect(html).toContain('<meta name="theme-color" content="#0F1524" />');
  });

  it("ships the web manifest with the 192 and 512 icons", () => {
    const manifest = JSON.parse(read("client/public/site.webmanifest"));
    expect(manifest.icons.map((i: { src: string }) => i.src)).toEqual(["/icon-192.png", "/icon-512.png"]);
  });

  it("ships every generated raster at its size", () => {
    expect(pngSize("client/public/apple-touch-icon.png")).toEqual([180, 180]);
    expect(pngSize("client/public/icon-192.png")).toEqual([192, 192]);
    expect(pngSize("client/public/icon-512.png")).toEqual([512, 512]);
    expect(pngSize("desktop-agent/assets/icon.png")).toEqual([512, 512]);
    for (const f of ["tray-icon", "tray-icon-running", "tray-icon-paused"]) {
      expect(pngSize(`desktop-agent/assets/${f}.png`)).toEqual([32, 32]);
    }
    expect(icoSizes("client/public/favicon.ico")).toEqual([16, 32, 48]);
    expect(icoSizes("desktop-agent/assets/icon.ico")).toEqual([16, 32, 48, 64, 128, 256]);
    expect(bytes("desktop-agent/assets/icon.icns").subarray(0, 4).toString("ascii")).toBe("icns");
    expect(bytes("client/public/favicon.svg").equals(bytes("brand/mark-tile.svg"))).toBe(true);
    expect(existsSync(join(ROOT, "brand/mark-tile-16.svg"))).toBe(true);
  });

  it("keeps the BrandMark component on the geometry of brand/mark-light.svg and mark-dark.svg", () => {
    const component = renderToStaticMarkup(createElement(BrandMark));
    expect(component).toContain('viewBox="10 10 44 44"');
    for (const source of ["brand/mark-light.svg", "brand/mark-dark.svg"]) {
      const svg = read(source);
      expect(svg).toContain('viewBox="10 10 44 44"');
      expect(shapes(component)).toEqual(shapes(svg));
    }
    // The tile is the same mark on the Case Ink square.
    expect(shapes(read("brand/mark-tile.svg")).slice(1)).toEqual(shapes(read("brand/mark-light.svg")));
  });

  it("uses the brand colours in the sources", () => {
    expect(read("brand/mark-light.svg")).toContain("#0F1524");
    expect(read("brand/mark-dark.svg")).toContain("#FFFFFF");
    for (const f of ["mark-tile", "mark-light", "mark-dark"]) {
      expect(read(`brand/${f}.svg`)).toContain("#E9A23B");
    }
  });

  it("colours the tray icons as tiles: ink idle, amber running, slate paused, no dot", () => {
    const states = [
      ["idle", "#0F1524", "#FFFFFF"],
      ["running", "#E9A23B", "#0F1524"],
      ["paused", "#6B778C", "#FFFFFF"],
    ] as const;
    for (const [state, tile, d] of states) {
      const svg = read(`brand/tray-${state}.svg`);
      expect(svg).toContain(`<rect width="64" height="64" rx="14" fill="${tile}"/>`);
      expect(svg).toContain(`fill="none" stroke="${d}" stroke-width="7.5"/>`);
      expect(svg).toContain(`height="38.5" rx="3.75" fill="${d}"/>`);
      expect(svg.match(/<circle /g)).toHaveLength(1);
    }
  });

  it("draws the mark's d on the loading screen, and holds it still under reduced motion", () => {
    const html = renderToStaticMarkup(createElement(LoadingScreen));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('fill="#0F1524"');
    expect(html).toContain('fill="#E9A23B"');
    // The bowl and the stem are the two drawn strokes.
    expect(html.match(/class="df-loading-stroke[^"]*"/g)).toHaveLength(2);
    expect(html.match(/pathLength="1"/g)).toHaveLength(2);
    // The loop runs only when motion is welcome; the words are for screen readers.
    expect(html).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.df-loading-stroke \{ animation: df-loading-draw/);
    expect(html).toContain('<span class="sr-only">Loading…</span>');
  });

  it("labels the lockup once, and the lone mark by name", () => {
    const lockup = renderToStaticMarkup(createElement(BrandLockup));
    expect(lockup).toContain("DocuFlow</span>");
    expect(lockup).toContain('aria-hidden="true"');
    expect(lockup).not.toContain("aria-label");
    const alone = renderToStaticMarkup(createElement(BrandMark, { label: "DocuFlow" }));
    expect(alone).toContain('role="img"');
    expect(alone).toContain('aria-label="DocuFlow"');
  });

  it("puts the lockup in the rail, the platform frame and sign-in; the lone mark when the rail is collapsed", () => {
    const rail = read("client/src/v2/V2Rail.tsx");
    expect(rail).toMatch(
      /collapsed && !drawer \? \(\s*<button[^>]*className="df-rail-expand"[^>]*aria-label="Expand navigation"[^>]*onClick=\{onToggleCollapse\}[^>]*data-testid="v2-rail-collapse"[^>]*>\s*<BrandMark \/>\s*<\/button>\s*\) : \(\s*<>\s*<BrandLockup \/>\s*<button[^>]*className="df-rail-collapse"/,
    );
    expect(rail).not.toContain('<BrandMark label="DocuFlow" />');
    const frame = read("client/src/v2/V2PlatformFrame.tsx");
    expect(frame).toMatch(
      /\{collapsed \? \(\s*<button[^>]*className="df-rail-expand"[^>]*aria-label="Expand navigation"[^>]*onClick=\{toggleSidebar\}[^>]*>\s*<BrandMark \/>\s*<\/button>\s*\) : \(\s*<div className="df-platform-brand">\s*<BrandLockup \/>/,
    );
    expect(frame).not.toContain("df-brand");
    expect(read("client/src/pages/AuthPage.tsx")).toContain("<BrandLockup");
    expect(read("client/src/v2/tokens.css")).toMatch(/\.dark \.df-brand-mark-d\s*{\s*fill: #ffffff;/);
  });
});

describe("v2 fonts are shared, not owned (#326)", () => {
  it("removes the link only when the last user lets go, whoever mounted first", () => {
    const log: string[] = [];
    const acquire = createRefCounted(() => {
      log.push("add");
      return () => log.push("remove");
    });
    const lockup = acquire();
    const shell = acquire();
    lockup(); // the rail collapses
    expect(log).toEqual(["add"]);
    shell();
    expect(log).toEqual(["add", "remove"]);
    acquire()();
    expect(log).toEqual(["add", "remove", "add", "remove"]);
  });

  it("ignores a release called twice", () => {
    const log: string[] = [];
    const acquire = createRefCounted(() => {
      log.push("add");
      return () => log.push("remove");
    });
    const a = acquire();
    const b = acquire();
    a();
    a();
    expect(log).toEqual(["add"]);
    b();
    expect(log).toEqual(["add", "remove"]);
  });
});
