import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One overlay system, one control system (#249).
 * Seams: composeAccountMenu / workspaceSwitcher / composeRefusalPlacement
 * live in the chrome suites. This file freezes the palette bridge, the
 * shadcn inventory, and the button states.
 * Do not assert hex or millisecond curves.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const v2Dir = join(root, "client/src/v2");

const tokens = readFileSync(join(v2Dir, "tokens.css"), "utf8");
const tokensCss = tokens.replace(/\/\*[\s\S]*?\*\//g, "");
const indexCss = readFileSync(join(root, "client/src/index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function source(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function rootBlock(css: string): string {
  const match = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!match) throw new Error("missing :root");
  return match[1];
}

function darkBlock(css: string): string {
  const match = css.match(/\.dark\s*\{([\s\S]*?)\n\}/);
  if (!match) throw new Error("missing .dark");
  return match[1];
}

function dfHex(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]+)`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

function cssVar(block: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`(?:^|[\\s;])${escaped}:\\s*([^;]+)`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1].trim();
}

function hexToHslTriplet(hex: string): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? [...raw].map((char) => char + char).join("") : raw;
  const r = Number.parseInt(full.slice(0, 2), 16) / 255;
  const g = Number.parseInt(full.slice(2, 4), 16) / 255;
  const b = Number.parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

describe("shadcn wears the DocuFlow palette (#249)", () => {
  it("bridges Case Ink, Cold Stock, Card White, Divider, Archive Slate, Amber, Signed-Off, and Destructive onto shadcn variables", () => {
    const rootVars = rootBlock(indexCss);
    const darkVars = darkBlock(indexCss);
    const caseInk = hexToHslTriplet(dfHex("--df-case-ink"));
    const coldStock = hexToHslTriplet(dfHex("--df-cold-stock"));
    const cardWhite = hexToHslTriplet(dfHex("--df-card-white"));
    const divider = hexToHslTriplet(dfHex("--df-divider"));
    const archiveSlate = hexToHslTriplet(dfHex("--df-archive-slate"));
    const amber = hexToHslTriplet(dfHex("--df-amber"));
    const signedOff = hexToHslTriplet(dfHex("--df-signed-off"));
    const destructive = hexToHslTriplet(dfHex("--df-destructive"));

    for (const block of [rootVars, darkVars]) {
      expect(cssVar(block, "--foreground")).toBe(caseInk);
      expect(cssVar(block, "--primary")).toBe(caseInk);
      expect(cssVar(block, "--background")).toBe(coldStock);
      expect(cssVar(block, "--muted")).toBe(coldStock);
      expect(cssVar(block, "--card")).toBe(cardWhite);
      expect(cssVar(block, "--popover")).toBe(cardWhite);
      expect(cssVar(block, "--border")).toBe(divider);
      expect(cssVar(block, "--input")).toBe(divider);
      expect(cssVar(block, "--muted-foreground")).toBe(archiveSlate);
      expect(cssVar(block, "--accent")).toBe(amber);
      expect(cssVar(block, "--ring")).toBe(amber);
      expect(cssVar(block, "--chart-2")).toBe(signedOff);
      expect(cssVar(block, "--destructive")).toBe(destructive);
    }
    expect(rootVars).not.toMatch(/--primary:\s*120deg/);
    expect(rootVars).not.toMatch(/--accent:\s*254\.21/);
  });

  it("does not invent a v2 dark palette", () => {
    expect(tokensCss).not.toMatch(/\.dark\s*\{/);
    expect(tokensCss).not.toMatch(/prefers-color-scheme:\s*dark/);
  });
});

describe("floating surfaces are shadcn primitives (#249)", () => {
  it("does not implement a popover, menu, sheet, or palette as a df-* positioning class", () => {
    expect(tokensCss).not.toMatch(/\.df-refusal-pop\s*\{/);
    expect(tokensCss).not.toMatch(/\.df-overlay\s*\{/);
    expect(tokensCss).not.toMatch(/\.df-overlay-scrim\s*\{/);
    expect(tokensCss).not.toMatch(/\.df-sheet\s*\{/);
    expect(tokensCss).not.toMatch(/\.df-ws-menu\s*\{/);
  });

  it("renders each overlay through the shadcn primitive that owns it", () => {
    const people = source("client/src/v2/V2People.tsx");
    const today = source("client/src/v2/V2Today.tsx");
    const fileViewer = source("client/src/v2/V2FileViewer.tsx");
    const refusalPopover = source("client/src/v2/V2RefusalPopover.tsx");
    const rail = source("client/src/v2/V2Rail.tsx");
    const rowMenu = source("client/src/v2/V2RowMenu.tsx");
    const panel = source("client/src/v2/V2ContextPanel.tsx");
    const command = source("client/src/v2/V2CommandBar.tsx");
    const admin = source("client/src/v2/V2Administration.tsx");
    const shell = source("client/src/v2/V2Shell.tsx");

    expect(refusalPopover).toContain('from "@/components/ui/popover"');
    expect(people).toContain("V2RefusalPopover");
    expect(today).toContain("V2RefusalPopover");
    expect(fileViewer).toContain("V2RefusalPopover");
    expect(rail).toContain('from "@/components/ui/dropdown-menu"');
    expect(rail).toContain("DropdownMenuRadioGroup");
    expect(rail).toContain("DropdownMenuSeparator");
    expect(rail).toContain("account.structure");
    expect(rail).not.toContain("v2-theme-dark");
    expect(rail).toContain("switcher.others");
    expect(rowMenu).toContain('from "@/components/ui/dropdown-menu"');
    expect(shell).toContain('from "@/components/ui/sheet"');
    expect(shell).not.toContain("hideClose");
    expect(panel).not.toContain('"df-sheet"');
    expect(command).toContain("CommandDialog");
    expect(command).toContain("CommandInput");
    expect(command).toContain("df-command-palette");
    expect(command).not.toContain("df-overlay");
    expect(admin).toContain('from "@/components/ui/alert-dialog"');
    expect(admin).not.toContain("df-btn-danger");
  });

  it("sizes rail menus to the control that opens them", () => {
    const rail = source("client/src/v2/V2Rail.tsx");
    expect(rail).toContain("df-menu-match-trigger");
    expect(rule(tokensCss, ".df-v2.df-menu.df-menu-match-trigger")).toMatch(
      /width:\s*var\(--radix-dropdown-menu-trigger-width\)/,
    );
  });

  it("does not hand-roll a floating surface anywhere else in v2", () => {
    const files = readdirSync(v2Dir).filter((name) => name.endsWith(".tsx"));
    for (const name of files) {
      const body = readFileSync(join(v2Dir, name), "utf8");
      expect(body, name).not.toMatch(/df-refusal-pop(?!over)/);
      expect(body, name).not.toContain("df-overlay-scrim");
      expect(body, name).not.toMatch(/className="df-overlay"/);
      expect(body, name).not.toMatch(/className="df-sheet"/);
      expect(body, name).not.toContain("df-ws-menu");
    }
  });
});

describe("controls have hover, focus-visible, and disabled states (#249)", () => {
  it("covers the four v2 button classes without migrating screen markup", () => {
    for (const cls of [".df-ghost-btn", ".df-icon-btn", ".df-danger-btn"]) {
      expect(tokensCss).toMatch(new RegExp(`${cls.replace(".", "\\.")}:hover`));
      expect(tokensCss).toMatch(new RegExp(`${cls.replace(".", "\\.")}:focus-visible`));
      expect(tokensCss).toMatch(new RegExp(`${cls.replace(".", "\\.")}:disabled`));
    }
    expect(tokensCss).toMatch(/\.df-ink-btn:hover/);
    expect(tokensCss).toMatch(/\.df-ink-btn:focus-visible/);
    expect(tokensCss).toMatch(/\.df-ink-btn:disabled/);
  });

  it("uses one danger convention, the destructive token", () => {
    expect(rule(tokensCss, '.df-ghost-btn[data-danger="true"]')).toMatch(/var\(--df-destructive\)/);
    expect(rule(tokensCss, '.df-v2 .df-menu-item[data-danger="true"]')).toMatch(
      /var\(--df-destructive\)/,
    );
    expect(tokensCss).toMatch(/^\.df-danger-btn\s*\{[^}]*var\(--df-destructive\)/m);
  });
});
