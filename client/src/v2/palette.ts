import type { CSSProperties } from "react";
import { projectStatusFromCombined } from "@shared/projectLifecycle";
import { stageColor } from "./stageColor";

/**
 * Which colour a status or a meter wears.
 *
 * A Project Status, Opportunity stage, Client status, or Task status wears its
 * own colour — the one its board column wears (v1 parity) — so every status is
 * told apart at a glance. `statusSwatch` turns that colour into a badge: a tint
 * of the hue, a border, and text of the same hue dark enough to read.
 *
 * Other states keep a tone: green what is online or signed off, carmine what is
 * overdue, blocked, or refused. tokens.css maps each tone onto the ramps.
 */

export type StatusTone = "active" | "positive" | "alert" | "neutral";

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "active",
  "IN PROGRESS": "active",
  "IN REVIEW": "active",
  COMPLETED: "positive",
  DONE: "positive",
  APPROVED: "positive",
  "SIGNED OFF": "positive",
  WON: "positive",
  ONLINE: "positive",
  OVERDUE: "alert",
  BLOCKED: "alert",
  REFUSED: "alert",
  LOST: "alert",
};

/** A Device or review status label, as the composers print it. */
export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONE[status.trim().toUpperCase()] ?? "neutral";
}

/** Read-only is a Workspace blocked from writing; Past due is overdue. */
export function billingConditionTone(condition: string | null | undefined): StatusTone {
  if (condition === "Past due" || condition === "Read-only") return "alert";
  return "neutral";
}

export type MeterTone = "within" | "over" | "paused";

/** A budget meter: green while inside the budget, carmine once past it. */
export function meterTone(percent: number | null | undefined, status?: string | null): MeterTone {
  if (percent != null && percent > 100) return "over";
  const label = status?.trim().toUpperCase();
  if (label === "ON HOLD" || label === "ARCHIVED") return "paused";
  return "within";
}

/**
 * v1's contact status colours (`client/src/pages/CrmPage.tsx`), except `lead`,
 * which matches the Opportunity stage, and `client_recurrent`, whose teal sat
 * too close to `client` green.
 */
const CLIENT_STATUS_COLORS: Record<string, string> = {
  lead: "#ec4899",
  prospect: "#8b5cf6",
  client: "#22c55e",
  client_recurrent: "#3b82f6",
};

/** v1 never coloured a Task status; these borrow the board hues for the same meaning. */
const TASK_STATUS_COLORS: Record<string, string> = {
  open: "#64748b",
  in_progress: "#3b82f6",
  done: "#22c55e",
  archived: "#a8a29e",
};

/** v1 gave a cancelled win its own rose; every other combined status reads as its column. */
const CANCELLED_COLOR = "#f43f5e";

export function projectStatusColor(status: string | null | undefined): string {
  return stageColor(status ?? "");
}

export function clientStatusColor(status: string | null | undefined): string {
  return (status && CLIENT_STATUS_COLORS[status]) || stageColor("");
}

export function taskStatusColor(status: string | null | undefined): string {
  return (status && TASK_STATUS_COLORS[status]) || stageColor("");
}

/**
 * A combined `crm_projects.status`, as Status history records it. A win in
 * delivery wears its Project Status column; anything earlier, its stage.
 */
export function lifecycleColor(combined: string | null | undefined): string {
  if (!combined) return stageColor("");
  if (combined === "won_cancelled") return CANCELLED_COLOR;
  if (combined.startsWith("won_")) return stageColor(projectStatusFromCombined(combined));
  return stageColor(combined);
}

const WHITE = "#ffffff";
const CASE_INK = "#0f1524";
/** The dark palette's card and ink (#272), mirrored from tokens.css. */
const INK_RAISED = "#161d30";
const DARK_INK = "#e8ecf2";
const TINT_SHARE = 0.14;
const LINE_SHARE = 0.4;
const DARK_TINT_SHARE = 0.2;
const DARK_LINE_SHARE = 0.45;
/** WCAG AA for the small mono type a badge uses. */
const TEXT_MIN_CONTRAST = 4.5;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

/** `share` of `hex` over `ground`. */
function mix(hex: string, ground: string, share: number): string {
  const top = channels(hex);
  const base = channels(ground);
  return `#${top
    .map((value, index) => Math.round(value * share + base[index] * (1 - share)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export type StatusSwatch = { tint: string; line: string; ink: string };

type TailwindStop = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
type TailwindScale = Record<TailwindStop, string>;

/**
 * The named colours an option can wear, exactly as Tailwind CSS 3.4 defines
 * them (`tailwindcss/colors`). A name's colour is its 500; its badge is drawn
 * from the rest of its own scale.
 */
export const TAILWIND_SCALES = {
  pink: { 50: "#fdf2f8", 100: "#fce7f3", 200: "#fbcfe8", 300: "#f9a8d4", 400: "#f472b6", 500: "#ec4899", 600: "#db2777", 700: "#be185d", 800: "#9d174d", 900: "#831843", 950: "#500724" },
  violet: { 50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6", 900: "#4c1d95", 950: "#2e1065" },
  indigo: { 50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 800: "#3730a3", 900: "#312e81", 950: "#1e1b4b" },
  blue: { 50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af", 900: "#1e3a8a", 950: "#172554" },
  sky: { 50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e", 950: "#082f49" },
  cyan: { 50: "#ecfeff", 100: "#cffafe", 200: "#a5f3fc", 300: "#67e8f9", 400: "#22d3ee", 500: "#06b6d4", 600: "#0891b2", 700: "#0e7490", 800: "#155e75", 900: "#164e63", 950: "#083344" },
  teal: { 50: "#f0fdfa", 100: "#ccfbf1", 200: "#99f6e4", 300: "#5eead4", 400: "#2dd4bf", 500: "#14b8a6", 600: "#0d9488", 700: "#0f766e", 800: "#115e59", 900: "#134e4a", 950: "#042f2e" },
  green: { 50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80", 500: "#22c55e", 600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d", 950: "#052e16" },
  lime: { 50: "#f7fee7", 100: "#ecfccb", 200: "#d9f99d", 300: "#bef264", 400: "#a3e635", 500: "#84cc16", 600: "#65a30d", 700: "#4d7c0f", 800: "#3f6212", 900: "#365314", 950: "#1a2e05" },
  amber: { 50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f", 950: "#451a03" },
  orange: { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12", 950: "#431407" },
  red: { 50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1d", 950: "#450a0a" },
  rose: { 50: "#fff1f2", 100: "#ffe4e6", 200: "#fecdd3", 300: "#fda4af", 400: "#fb7185", 500: "#f43f5e", 600: "#e11d48", 700: "#be123c", 800: "#9f1239", 900: "#881337", 950: "#4c0519" },
  slate: { 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#020617" },
} satisfies Record<string, TailwindScale>;

export type TailwindColourName = keyof typeof TAILWIND_SCALES;

/** The stops a badge is drawn from; the ink takes the first stop that reads on the tint. */
export const SCALE_STOPS = {
  light: { tint: 100, line: 300, ink: [700, 800, 900] },
  dark: { tint: 950, line: 700, ink: [300, 200, 100] },
} as const satisfies Record<"light" | "dark", { tint: TailwindStop; line: TailwindStop; ink: readonly TailwindStop[] }>;

const SCALE_BY_BASE = new Map<string, TailwindScale>(Object.values(TAILWIND_SCALES).map((scale) => [scale[500], scale]));

function scaleSwatch(scale: TailwindScale, dark: boolean): StatusSwatch | null {
  const stops = SCALE_STOPS[dark ? "dark" : "light"];
  const tint = scale[stops.tint];
  const ground = dark ? INK_RAISED : WHITE;
  const ink = stops.ink
    .map((stop) => scale[stop])
    .find((hex) => contrastRatio(hex, tint) >= TEXT_MIN_CONTRAST && contrastRatio(hex, ground) >= TEXT_MIN_CONTRAST);
  return ink ? { tint, line: scale[stops.line], ink } : null;
}

/**
 * A badge in one hue. A named Tailwind colour takes its tint, line and text
 * from its own scale. Any other colour is mixed: the text is the hue itself,
 * pulled toward the ink only as far as it takes to read on the tint, so a dark
 * red stays red and a lime turns olive rather than black. On the dark ground
 * the tint sits on the raised card and the pull is toward the light ink.
 */
export function statusSwatch(color: string, ground: "light" | "dark" = "light"): StatusSwatch {
  const dark = ground === "dark";
  const scale = SCALE_BY_BASE.get(color.toLowerCase());
  const named = scale ? scaleSwatch(scale, dark) : null;
  if (named) return named;
  const base = dark ? INK_RAISED : WHITE;
  const toward = dark ? DARK_INK : CASE_INK;
  const tint = mix(color, base, dark ? DARK_TINT_SHARE : TINT_SHARE);
  const line = mix(color, base, dark ? DARK_LINE_SHARE : LINE_SHARE);
  let ink = color;
  for (let step = 1; step <= 20 && contrastRatio(ink, tint) < TEXT_MIN_CONTRAST; step += 1) {
    ink = mix(toward, color, step / 20);
  }
  return { tint, line, ink };
}

/**
 * Both swatches as the custom properties `.df-status[data-swatch]` reads, and
 * the colour itself for a solid chip.
 */
export function swatchStyle(color: string): CSSProperties {
  const light = statusSwatch(color);
  const dark = statusSwatch(color, "dark");
  return {
    "--df-swatch-base": color,
    "--df-swatch-tint": light.tint,
    "--df-swatch-line": light.line,
    "--df-swatch-ink": light.ink,
    "--df-swatch-tint-dark": dark.tint,
    "--df-swatch-line-dark": dark.line,
    "--df-swatch-ink-dark": dark.ink,
  } as CSSProperties;
}
