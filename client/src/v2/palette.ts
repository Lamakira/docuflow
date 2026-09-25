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
const TINT_SHARE = 0.14;
const LINE_SHARE = 0.4;
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

/**
 * A badge in one hue. The text is the hue itself, pulled toward Case Ink only
 * as far as it takes to read on the tint, so a dark red stays red and a lime
 * turns olive rather than black.
 */
export function statusSwatch(color: string): StatusSwatch {
  const tint = mix(color, WHITE, TINT_SHARE);
  const line = mix(color, WHITE, LINE_SHARE);
  let ink = color;
  for (let step = 1; step <= 20 && contrastRatio(ink, tint) < TEXT_MIN_CONTRAST; step += 1) {
    ink = mix(CASE_INK, color, step / 20);
  }
  return { tint, line, ink };
}

/** The swatch as the custom properties `.df-status[data-swatch]` reads. */
export function swatchStyle(color: string): CSSProperties {
  const swatch = statusSwatch(color);
  return {
    "--df-swatch-tint": swatch.tint,
    "--df-swatch-line": swatch.line,
    "--df-swatch-ink": swatch.ink,
  } as CSSProperties;
}
