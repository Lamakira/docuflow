/**
 * Why a record list shows nothing (#325). Three cases, one rule each:
 * `none`: nothing exists yet, so the screen shows the designed V2EmptyState;
 * `filtered`: filters hide every row, so a short line and `Clear filters`;
 * `range`: a period (Today, This week) holds nothing but rows may exist outside
 * it, so no first-use invitation: the compact in-card `df-empty` line a
 * dashboard section uses, with a hint to widen the Range.
 */
export type EmptyKind = "none" | "filtered" | "range";

/**
 * What an empty list carries to its screen: the case, the headline of the
 * designed state (`none` only; empty otherwise) and the one line of copy.
 */
export type EmptyModel = { kind: EmptyKind; title: string; copy: string };

/**
 * `narrowRange`: the Range filter is shorter than the widest one on offer, so
 * an unfiltered empty list cannot claim the Workspace holds nothing.
 */
export function emptyKindOf(empty: boolean, filtered: boolean, narrowRange = false): EmptyKind | null {
  if (!empty) return null;
  if (filtered) return "filtered";
  return narrowRange ? "range" : "none";
}

/** The one line that says filters hid every row. */
export function filteredEmptyCopy(noun: string): string {
  return `No ${noun} match these filters.`;
}

/**
 * The empty model of a list: `null` while it has rows. `noun` names what
 * filters hid; `none` is the first-use headline and sentence, or null for a
 * list that is always read over a Range; `range` is the compact line for it.
 */
export function emptyModelOf(
  kind: EmptyKind | null,
  noun: string,
  none: { title: string; copy: string } | null,
  range = "",
): EmptyModel | null {
  if (!kind) return null;
  if (kind === "filtered") return { kind, title: "", copy: filteredEmptyCopy(noun) };
  // A list with no first-use case (`none` null) is always a Range that holds nothing.
  if (kind === "range" || !none) return { kind: "range", title: "", copy: range };
  return { kind, title: none.title, copy: none.copy };
}
