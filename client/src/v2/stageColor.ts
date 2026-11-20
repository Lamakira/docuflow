/**
 * Colour on the boards (v1 parity). A column wears its stage or Project Status
 * colour as a filled pill over a light tint of the same hue.
 *
 * The defaults are v1's, per combined status (`client/src/pages/CrmPage.tsx`),
 * except where two sat too close to tell apart as a tint: `lead` was slate,
 * which read as no colour at all, and `planned` was an emerald beside the
 * `active` teal.
 * A Project Status takes the colour v1 gave the combined status it reads back
 * from; `archived` holds both lost and cancelled, so it stays neutral.
 * `on_hold` has no combined source in v1, so it takes an orange no other
 * Project Status wears. An Opportunity stage an Administrator coloured in the
 * CRM field options keeps that colour.
 */

export const STAGE_FALLBACK_COLOR = "#64748b";

const STAGE_COLORS: Record<string, string> = {
  lead: "#ec4899",
  discovering_call_completed: "#8b5cf6",
  proposal_sent: "#f59e0b",
  follow_up: "#06b6d4",
  in_negotiation: "#3b82f6",
  won: "#22c55e",
  lost: "#ef4444",
  planned: "#6366f1",
  active: "#14b8a6",
  on_hold: "#f97316",
  in_review: "#0ea5e9",
  completed: "#84cc16",
  archived: STAGE_FALLBACK_COLOR,
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The pill's text is 10px, so it owes 4.5:1 (F29). White wins when it clears
 * that; dark ink when only it does; where neither does (a mid violet such as
 * Discovering's #8b5cf6, 4.23:1 white, 4.30:1 dark) the pill's fill steps
 * darker until white clears it. The Administrator's stored colour never
 * changes: only what a pill wears.
 */
const PILL_MIN_CONTRAST = 4.5;
const PILL_PAPER = "#ffffff"; // --df-fill-paper
const PILL_INK = "#0f1524"; // --df-fill-ink

/** A configured colour lands in a style attribute, so only a hex colour is taken. */
export function stageColor(stageId: string, configured?: string | null): string {
  if (configured && HEX.test(configured.trim())) return configured.trim().toLowerCase();
  return STAGE_COLORS[stageId] ?? STAGE_FALLBACK_COLOR;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Mix toward black by `share` (0..1), as a hex colour. */
function darken(hex: string, share: number): string {
  const channel = (index: number) =>
    Math.round(parseInt(hex.slice(index, index + 2), 16) * (1 - share))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** What a stage pill wears: its fill and the ink on it, at 4.5:1 or better. */
export function stagePill(hex: string): { fill: string; ink: "light" | "dark" } {
  if (contrast(PILL_PAPER, hex) >= PILL_MIN_CONTRAST) return { fill: hex, ink: "light" };
  if (contrast(PILL_INK, hex) >= PILL_MIN_CONTRAST) return { fill: hex, ink: "dark" };
  for (let step = 1; step <= 25; step += 1) {
    const fill = darken(hex, step * 0.04);
    if (contrast(PILL_PAPER, fill) >= PILL_MIN_CONTRAST) return { fill, ink: "light" };
  }
  return { fill: PILL_INK, ink: "light" };
}

/** The ink on a pill of this fill; use `stagePill` where the fill may need to darken. */
export function stageInk(hex: string): "light" | "dark" {
  return stagePill(hex).ink;
}
