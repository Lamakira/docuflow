/**
 * Colour on the boards (v1 parity). A column wears its stage or Project Status
 * colour as a filled pill over a light tint of the same hue.
 *
 * The defaults are v1's, per combined status (`client/src/pages/CrmPage.tsx`).
 * A Project Status takes the colour v1 gave the combined status it reads back
 * from; `archived` holds both lost and cancelled, so it stays neutral.
 * `on_hold` has no combined source in v1, so it takes an orange no other
 * Project Status wears. An Opportunity stage an Administrator coloured in the
 * CRM field options keeps that colour.
 */

export const STAGE_FALLBACK_COLOR = "#64748b";

const STAGE_COLORS: Record<string, string> = {
  lead: "#64748b",
  discovering_call_completed: "#8b5cf6",
  proposal_sent: "#f59e0b",
  follow_up: "#06b6d4",
  in_negotiation: "#3b82f6",
  won: "#22c55e",
  lost: "#ef4444",
  planned: "#10b981",
  active: "#14b8a6",
  on_hold: "#f97316",
  in_review: "#0ea5e9",
  completed: "#84cc16",
  archived: STAGE_FALLBACK_COLOR,
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * White reads best on a saturated fill (red, blue, purple) even where dark ink
 * would measure slightly higher. Below 3:1 — amber, lime, the greens and
 * cyans — white stops being legible, and the pill takes dark ink instead.
 */
const WHITE_MIN_CONTRAST = 3;

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

/** White on the pill unless the fill is too light for it. */
export function stageInk(hex: string): "light" | "dark" {
  const whiteContrast = 1.05 / (luminance(hex) + 0.05);
  return whiteContrast >= WHITE_MIN_CONTRAST ? "light" : "dark";
}
