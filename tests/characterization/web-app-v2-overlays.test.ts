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

/** WCAG 2.1 relative luminance, for the one token that must stay legible. */
function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? [...raw].map((char) => char + char).join("") : raw;
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
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
  it("wears the shadcn Button instead of a parallel button class", () => {
    for (const cls of ["df-ghost-btn", "df-icon-btn", "df-ink-btn", "df-danger-btn", "df-file-zoom-btn"]) {
      expect(tokensCss).not.toContain(`.${cls}`);
    }
    const files = readdirSync(v2Dir).filter((name) => name.endsWith(".tsx"));
    for (const name of files) {
      const body = readFileSync(join(v2Dir, name), "utf8");
      expect(body, name).not.toMatch(/\bdf-(?:ghost|ink|icon|danger|file-zoom)-btn\b/);
    }
    expect(source("client/src/components/ui/button.tsx")).toContain("hover-elevate");
    expect(tokensCss).toMatch(/\.df-v2 button:not\(\.df-btn\)/);
    expect(tokensCss).toMatch(/\.df-v2 button\.df-btn\.bg-primary/);
    expect(tokensCss).toMatch(/\.df-v2 a\.df-btn\.bg-primary/);
  });

  it("keeps the destructive token legible in both of the jobs it does", () => {
    // --df-destructive is a fill under white text and red text on Card White, so
    // one number covers both: its contrast against white. 7:1 is WCAG AAA for the
    // 12.5px label on the one control a reader must never misread.
    expect(contrastWithWhite(dfHex("--df-destructive"))).toBeGreaterThanOrEqual(7);
  });

  it("opens a destructive confirmation from a control that does not flood", () => {
    // The flood is the answer to the dialog's question, not the invitation to ask
    // it — and a chromatic flood is a loud thing in a palette of two voices.
    const admin = source("client/src/v2/V2Administration.tsx");
    expect(admin).toContain('variant="destructiveOutline"');
    expect(admin).not.toContain('variant="destructive"');
    expect(source("client/src/components/ui/button.tsx")).toContain("destructiveOutline");
  });

  it("keeps the dev overlay from reporting floating-ui's settling notice as an error", () => {
    // Every Radix surface positions through @floating-ui autoUpdate, which makes
    // the browser emit "ResizeObserver loop completed with undelivered
    // notifications" when it cannot settle inside one frame. It carries no Error
    // object, so the Replit overlay renders it as "(unknown runtime error)" over
    // a stack of its own script. The guard must stay in index.html: the overlay
    // injects a deferred module, and only a classic inline script registers
    // ahead of it.
    const html = source("client/index.html");
    const inlineScript = html.slice(0, html.indexOf('<script type="module"'));
    expect(inlineScript).toContain("ResizeObserver loop");
    expect(inlineScript).toContain("stopImmediatePropagation");
    expect(inlineScript).not.toContain('type="module"');
  });

  it("groups a menu with its separator rather than a hairline on every item", () => {
    // A rule under every item made the separator indistinguishable from the gaps
    // around it, and the account menu read as one flat list.
    expect(rule(tokensCss, ".df-v2 .df-menu-item")).not.toMatch(/border-bottom:\s*1px/);
    expect(rule(tokensCss, ".df-v2 .df-menu-separator")).toMatch(/background:\s*var\(--df-divider\)/);
    expect(source("client/src/v2/chrome.ts")).toContain('"separator"');
  });

  it("keeps the indicator gutter on a menu item that carries one", () => {
    // shadcn positions the indicator absolutely and reserves room with a
    // single-class `pl-8`, which `.df-v2 .df-menu-item` outranks — the dot then
    // lands on the first letter of the label.
    expect(tokensCss).toMatch(/\[role="menuitemradio"\][\s\S]*?padding-left:\s*var\(--df-space-7\)/);
  });

  it("anchors the command palette to the top of a phone viewport", () => {
    expect(tokensCss).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.df-v2\.df-command-palette[\s\S]*?top:\s*12px/);
    // And says what it is waiting for, so it is a surface and not a stray field.
    expect(source("client/src/v2/V2CommandBar.tsx")).toMatch(/Type to search/);
  });

  it("points the keyboard at the dismissal, not at the destructive action", () => {
    const admin = source("client/src/v2/V2Administration.tsx");
    expect(admin).toMatch(/<AlertDialogCancel[^>]*autoFocus/);
  });

  it("uses one danger convention, the destructive token", () => {
    expect(source("client/src/components/ui/button.tsx")).toMatch(
      /destructiveOutline:[\s\S]*text-destructive/,
    );
    expect(source("client/src/v2/V2TaskTable.tsx")).toContain('variant="destructiveOutline"');
    expect(rule(tokensCss, '.df-v2 .df-menu-item[data-danger="true"]')).toMatch(
      /var\(--df-destructive\)/,
    );
  });
});
