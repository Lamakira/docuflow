import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  billingConditionTone,
  meterTone,
  opportunityStageTone,
  statusTone,
} from "../../client/src/v2/palette";

/**
 * The v2 palette, built on the brand amber. Amber marks what is active or in
 * progress and the primary action; green what is finished; carmine what is
 * overdue, blocked, or refused. Colour lands in six places only: the primary
 * Button, the active rail item, the active tab, status badges, budget meters,
 * and the focus ring / running timer.
 * Seams: statusTone / opportunityStageTone / billingConditionTone / meterTone.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const v2Dir = join(root, "client/src/v2");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const css = stripComments(read("client/src/v2/tokens.css"));
const indexCss = stripComments(read("client/src/index.css"));

type Rule = { selectors: string[]; body: string };

function rules(source: string): Rule[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((selector) => selector.trim()),
    body: match[2],
  }));
}

function rule(selector: string): string {
  const found = rules(css).filter((entry) => entry.selectors.includes(selector));
  if (found.length === 0) throw new Error(`missing rule ${selector}`);
  return found.map((entry) => entry.body).join("\n");
}

function v2Block(): string {
  const at = css.search(/\.df-v2\s*\{/);
  return css.slice(at, css.indexOf("}", at) + 1);
}

function declared(block: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`(?:^|[\\s;{])${escaped}:\\s*([^;]+)`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1].trim();
}

function hexOf(name: string): string {
  const value = declared(v2Block(), name);
  const alias = value.match(/^var\((--df-[a-z0-9-]+)\)$/);
  return (alias ? hexOf(alias[1]) : value).toLowerCase();
}

function hexToHslTriplet(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
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

/** WCAG 2.1 contrast ratio. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => {
      const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const SCALES: Record<string, string> = {
  "--df-amber-50": "#fdf8ef",
  "--df-amber-100": "#fcf3e4",
  "--df-amber-200": "#fae3bf",
  "--df-amber-300": "#f5cf8e",
  "--df-amber-400": "#efb862",
  "--df-amber-500": "#e9a23b",
  "--df-amber-600": "#d8912f",
  "--df-amber-700": "#b0741f",
  "--df-amber-800": "#87561a",
  "--df-amber-900": "#5f4528",
  "--df-green-50": "#eaf2ed",
  "--df-green-200": "#cfe8dc",
  "--df-green-500": "#1f9d6b",
  "--df-green-700": "#16704d",
  "--df-green-900": "#0e4531",
  "--df-carmine-50": "#f8e9ea",
  "--df-carmine-200": "#edc3c6",
  "--df-carmine-400": "#b8323a",
  "--df-carmine-500": "#95232a",
  "--df-carmine-900": "#5e1419",
};

describe("v2 colour scales", () => {
  it("defines the amber, green, and carmine ramps on .df-v2", () => {
    for (const [name, hex] of Object.entries(SCALES)) {
      expect(hexOf(name), name).toBe(hex);
    }
  });

  it("keeps the neutrals and points the old names at the new stops", () => {
    expect(hexOf("--df-case-ink")).toBe("#0f1524");
    expect(hexOf("--df-cold-stock")).toBe("#f3f5f7");
    expect(hexOf("--df-archive-slate")).toBe("#59657a");
    expect(declared(v2Block(), "--df-amber")).toBe("var(--df-amber-500)");
    expect(declared(v2Block(), "--df-amber-wash")).toBe("var(--df-amber-100)");
    expect(declared(v2Block(), "--df-signed-off")).toBe("var(--df-green-500)");
    expect(declared(v2Block(), "--df-destructive")).toBe("var(--df-carmine-500)");
  });

  it("keeps every pairing it ships legible", () => {
    const ink = hexOf("--df-case-ink");
    expect(contrast(ink, hexOf("--df-amber-500"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, hexOf("--df-amber-600"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexOf("--df-amber-800"), hexOf("--df-amber-100"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexOf("--df-green-700"), hexOf("--df-green-50"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexOf("--df-carmine-500"), hexOf("--df-carmine-50"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexOf("--df-amber-800"), hexOf("--df-card-white"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexOf("--df-green-700"), hexOf("--df-card-white"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("shadcn inherits the brand inside v2 only", () => {
  it("re-points shadcn's variables on .df-v2 to the v2 stops", () => {
    const block = v2Block();
    const ink = hexToHslTriplet(hexOf("--df-case-ink"));
    expect(declared(block, "--primary")).toBe(hexToHslTriplet(hexOf("--df-amber-500")));
    expect(declared(block, "--primary-foreground")).toBe(ink);
    expect(declared(block, "--primary-border")).toBe("var(--df-amber-600)");
    expect(declared(block, "--accent")).toBe(hexToHslTriplet(hexOf("--df-amber-100")));
    expect(declared(block, "--accent-foreground")).toBe(ink);
    expect(declared(block, "--ring")).toBe(hexToHslTriplet(hexOf("--df-amber-500")));
    expect(declared(block, "--destructive")).toBe(hexToHslTriplet(hexOf("--df-carmine-500")));
  });

  it("sets shadcn's variables nowhere else in tokens.css, and leaves v1's :root on ink", () => {
    for (const entry of rules(css)) {
      if (!/(?:^|[\s;])--(?:primary|accent|ring|destructive)(?:-[a-z]+)?:/.test(entry.body)) continue;
      expect(entry.selectors).toEqual([".df-v2"]);
    }
    expect(indexCss).not.toContain(".df-v2");
    const rootVars = indexCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(declared(rootVars, "--primary")).toBe(hexToHslTriplet(hexOf("--df-case-ink")));
  });

  it("lets every portalled panel carry the class the override hangs on", () => {
    for (const name of ["V2Select.tsx", "V2RowMenu.tsx", "V2RefusalPopover.tsx", "V2CommandBar.tsx"]) {
      expect(read(`client/src/v2/${name}`), name).toMatch(/className="df-v2 /);
    }
  });
});

describe("where colour goes", () => {
  it("fills the primary Button with amber under ink, and presses to 600", () => {
    expect(read("client/src/components/ui/button.tsx")).toMatch(/default:\s*\n?\s*"bg-primary text-primary-foreground/);
    const primary = rule(".df-v2 button.df-btn.bg-primary");
    expect(primary).toMatch(/background:\s*var\(--df-amber-500\)/);
    expect(primary).toMatch(/color:\s*var\(--df-case-ink\)/);
    expect(rule(".df-v2 button.df-btn.bg-primary:hover:not(:disabled)")).toMatch(
      /background:\s*var\(--df-amber-600\)/,
    );
    expect(rule(".df-v2 button.df-btn.bg-destructive")).toMatch(/color:\s*var\(--df-card-white\)/);
    expect(rule(".df-v2 button.df-btn.bg-destructive")).not.toMatch(/--df-case-ink/);
  });

  it("marks the active rail item with an amber wash and no bar", () => {
    const active = rule('.df-rail-item[data-active="true"]');
    expect(active).toMatch(/background:\s*var\(--df-amber-100\)/);
    expect(active).not.toMatch(/box-shadow/);
  });

  it("underlines the active tab in amber", () => {
    expect(rule('.df-tab[data-active="true"]')).toMatch(/border-bottom-color:\s*var\(--df-amber-500\)/);
  });

  it("gives each status tone its own ramp", () => {
    expect(rule('.df-status[data-tone="active"]')).toMatch(/background:\s*var\(--df-amber-100\)/);
    expect(rule('.df-status[data-tone="active"]')).toMatch(/color:\s*var\(--df-amber-800\)/);
    expect(rule('.df-status-word[data-tone="positive"]')).toMatch(/background:\s*var\(--df-green-50\)/);
    expect(rule('.df-status-word[data-tone="positive"]')).toMatch(/color:\s*var\(--df-green-700\)/);
    expect(rule('.df-status[data-tone="alert"]')).toMatch(/background:\s*var\(--df-carmine-50\)/);
    expect(rule('.df-status[data-tone="alert"]')).toMatch(/color:\s*var\(--df-carmine-500\)/);
  });

  it("fills budget meters green, and carmine past the budget", () => {
    expect(rule(".df-meter-fill")).toMatch(/background:\s*var\(--df-green-500\)/);
    expect(rule('.df-meter-fill[data-tone="over"]')).toMatch(/background:\s*var\(--df-carmine-500\)/);
    for (const name of ["V2Projects.tsx", "V2Today.tsx", "V2Dossier.tsx"]) {
      const src = read(`client/src/v2/${name}`);
      expect(src, name).toContain("data-tone={meterTone(");
      expect(src, name).not.toMatch(/className="df-meter-fill"[^/]*background:/);
    }
  });

  it("keeps the focus ring and the running timer amber", () => {
    expect(rule(".df-v2 :focus-visible")).toMatch(/outline:\s*2px solid var\(--df-amber\)/);
    expect(rule('.df-chip[data-appearance="running"]')).toMatch(/background:\s*var\(--df-amber-wash\)/);
    expect(rule('.df-chip[data-appearance="running"]')).toMatch(/border-color:\s*var\(--df-amber\)/);
  });

  it("reads the tone from the composer, not from a word in JSX", () => {
    const toned: Record<string, string> = {
      "V2Projects.tsx": "statusTone(",
      "V2Today.tsx": "statusTone(",
      "V2Dossier.tsx": "statusTone(",
      "V2TaskTable.tsx": "statusTone(",
      "V2Clients.tsx": "statusTone(",
      "V2Devices.tsx": "statusTone(",
      "V2Opportunities.tsx": "opportunityStageTone(",
      "V2Administration.tsx": "billingConditionTone(",
    };
    for (const [name, call] of Object.entries(toned)) {
      expect(read(`client/src/v2/${name}`), name).toContain(`data-tone={${call}`);
    }
    for (const name of readdirSync(v2Dir).filter((file) => file.endsWith(".tsx"))) {
      expect(read(`client/src/v2/${name}`), name).not.toContain("function meterFill");
    }
  });
});

describe("status and meter tones", () => {
  it("tones Project and Task statuses by what they mean", () => {
    for (const status of ["ACTIVE", "IN PROGRESS", "IN REVIEW"]) expect(statusTone(status), status).toBe("active");
    for (const status of ["COMPLETED", "DONE", "APPROVED", "SIGNED OFF", "ONLINE"]) {
      expect(statusTone(status), status).toBe("positive");
    }
    for (const status of ["OVERDUE", "BLOCKED", "REFUSED"]) expect(statusTone(status), status).toBe("alert");
    for (const status of ["PLANNED", "TO DO", "ON HOLD", "ARCHIVED", "OFFLINE", "", null]) {
      expect(statusTone(status), String(status)).toBe("neutral");
    }
  });

  it("tones every open Opportunity stage as in progress, and says how a closed one ended", () => {
    expect(opportunityStageTone("PROPOSAL SENT", false)).toBe("active");
    expect(opportunityStageTone("A STAGE THE WORKSPACE NAMED", false)).toBe("active");
    expect(opportunityStageTone("WON", true)).toBe("positive");
    expect(opportunityStageTone("LOST", true)).toBe("alert");
  });

  it("tones a blocked or overdue Workspace in carmine and leaves the rest neutral", () => {
    expect(billingConditionTone("Past due")).toBe("alert");
    expect(billingConditionTone("Read-only")).toBe("alert");
    expect(billingConditionTone("Trial")).toBe("neutral");
    expect(billingConditionTone("Active")).toBe("neutral");
    expect(billingConditionTone(null)).toBe("neutral");
  });

  it("turns a meter carmine only past 100%", () => {
    expect(meterTone(40)).toBe("within");
    expect(meterTone(100)).toBe("within");
    expect(meterTone(101)).toBe("over");
    expect(meterTone(140, "ON HOLD")).toBe("over");
    expect(meterTone(40, "ON HOLD")).toBe("paused");
    expect(meterTone(40, "ARCHIVED")).toBe("paused");
    expect(meterTone(null)).toBe("within");
  });
});

describe("v2 screens read colour from tokens", () => {
  /** Files allowed a raw hex, with the reason. Empty: every colour has a token. */
  const EXCEPTIONS: Record<string, string> = {};

  it("puts no raw hex in client/src/v2/*.tsx", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(v2Dir).filter((file) => file.endsWith(".tsx"))) {
      if (EXCEPTIONS[name]) continue;
      const lines = readFileSync(join(v2Dir, name), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/["'`]#[0-9a-fA-F]{3,8}\b/.test(line)) offenders.push(`${name}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
