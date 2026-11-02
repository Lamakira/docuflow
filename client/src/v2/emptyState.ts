/**
 * Why a record list shows nothing (#325). Three cases, one rule each:
 * `none`: nothing exists yet, so the screen shows the designed V2EmptyState;
 * `filtered`: filters hide every row, so a short line and `Clear filters`;
 * `range`: a period (Today, This week) holds nothing but rows may exist outside
 * it, so no first-use invitation: the designed state with an action that widens
 * the Range one step. Dashboard sections keep the compact `df-empty` line
 * through `V2CompactEmpty`.
 */
export type EmptyKind = "none" | "filtered" | "range";

/**
 * What an empty list carries to its screen: the case, the headline of the
 * designed state, the one line of copy and, for `range`, the label of the action
 * that widens the Range (`null` when none is wider, and for the other cases).
 */
export type EmptyModel = { kind: EmptyKind; title: string; copy: string; widenLabel: string | null };

/**
 * `narrowRange`: the Range filter is shorter than the widest one on offer, so
 * an unfiltered empty list cannot claim the Workspace holds nothing, unless
 * `everRecorded` is `false`: the reader has none in any period.
 */
export function emptyKindOf(
  empty: boolean,
  filtered: boolean,
  narrowRange = false,
  everRecorded: boolean | null = null,
): EmptyKind | null {
  if (!empty) return null;
  if (filtered) return "filtered";
  // A narrow Range is `none` only once a wider probe has shown nothing was ever
  // recorded; while that is unknown (`null`) the line stays the Range hint.
  if (narrowRange && everRecorded !== false) return "range";
  return "none";
}

/** The one line that says filters hid every row. */
export function filteredEmptyCopy(noun: string): string {
  return `No ${noun} match these filters.`;
}

/**
 * The empty model of a list: `null` while it has rows. `noun` names what
 * filters hid; `none` is the first-use headline and sentence, or null for a
 * list that is always read over a Range; `range` names the period that holds
 * nothing (`window`, e.g. "today") and the label of the action that widens it.
 */
export function emptyModelOf(
  kind: EmptyKind | null,
  noun: string,
  none: { title: string; copy: string } | null,
  range?: { window: string; widenLabel: string | null },
): EmptyModel | null {
  if (!kind) return null;
  if (kind === "filtered") return { kind, title: "", copy: filteredEmptyCopy(noun), widenLabel: null };
  // A list with no first-use case (`none` null) is always a Range that holds nothing.
  if (kind === "range" || !none) {
    const { window, widenLabel } = range ?? { window: "in this Range", widenLabel: null };
    return {
      kind: "range",
      title: `No ${noun} ${window}`,
      copy: "Only this Range is shown. Widen it to look further back.",
      widenLabel,
    };
  }
  return { kind, title: none.title, copy: none.copy, widenLabel: null };
}
