/**
 * Why a record list shows nothing (#325). Three cases, one look (V2RecordEmpty):
 * `none`: nothing exists yet, so the screen invites the first one;
 * `filtered`: filters or the search hide every row, so it names them and clears them;
 * `range`: a period (Today, This week) holds nothing but rows may exist outside
 * it, so no first-use invitation: the action widens the Range one step.
 */
export type EmptyKind = "none" | "filtered" | "range";

/**
 * What an empty list carries to its screen: the case, the headline, the one line
 * of copy and the label of its way out (`widenLabel` for `range`, `null` when none
 * is wider; `clearLabel` for `filtered`). `icon` replaces the screen's own when a
 * filter or the search is the reason.
 */
export type EmptyModel = {
  kind: EmptyKind;
  title: string;
  copy: string;
  icon: "search" | "filters" | null;
  widenLabel: string | null;
  clearLabel: string | null;
};

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

/** What hides the rows, in plain words. */
export type EmptyCause = {
  /** The text in the search box. */
  search?: string;
  /** Each active filter by name and value; left out when the screen cannot name them. */
  filters?: string[];
  /** The search is the only control that can empty this list. */
  searchOnly?: boolean;
  /** The period the list is read over, after "Nothing", e.g. "in the last 30 days". */
  window?: string;
};

/**
 * Filters hide every row: every list says so in these words. The search on its
 * own names its text; any other filter names every filter, the search among them.
 */
export function filteredEmptyModel(noun: string, cause: EmptyCause = {}): EmptyModel {
  // Some screens list the search among their filter labels, in quotes.
  const listed = (cause.filters ?? []).find((label) => /^“.*”$/.test(label));
  const search = cause.search?.trim() || listed?.slice(1, -1) || "";
  const quoted = `“${search}”`;
  const filters = (cause.filters ?? []).filter((label) => label !== listed);
  const where = cause.window ?? "here";
  if (cause.searchOnly || (search && cause.filters !== undefined && filters.length === 0)) {
    return {
      kind: "filtered",
      title: search ? `No ${noun} match ${quoted}` : `No ${noun} match your search`,
      copy: "Try another word, or clear the search.",
      icon: "search",
      widenLabel: null,
      clearLabel: "Clear search",
    };
  }
  const named = search && filters.length > 0 ? [`Search: ${quoted}`, ...filters] : filters;
  return {
    kind: "filtered",
    title: `No ${noun} match these filters`,
    copy:
      named.length > 0
        ? `Nothing ${where} matches ${named.join(" · ")}. Clear the filters to see the rest.`
        : "Clear the filters to see the rest.",
    icon: "filters",
    widenLabel: null,
    clearLabel: "Clear filters",
  };
}

/**
 * The empty model of a list: `null` while it has rows. `noun` names what it
 * holds; `none` is the first-use headline and sentence, or null for a list that
 * is always read over a Range; `range` names the period that holds nothing
 * (`window`, e.g. "today") and the label of the action that widens it.
 */
export function emptyModelOf(
  kind: EmptyKind | null,
  noun: string,
  none: { title: string; copy: string } | null,
  range?: { window: string; widenLabel: string | null },
  cause?: EmptyCause,
): EmptyModel | null {
  if (!kind) return null;
  if (kind === "filtered") return filteredEmptyModel(noun, cause);
  // A list with no first-use case (`none` null) is always a Range that holds nothing.
  if (kind === "range" || !none) {
    const { window, widenLabel } = range ?? { window: "in this Range", widenLabel: null };
    return {
      kind: "range",
      title: `No ${noun} ${window}`,
      copy: "Only this Range is shown. Widen it to look further back.",
      icon: null,
      widenLabel,
      clearLabel: null,
    };
  }
  return { kind: "none", title: none.title, copy: none.copy, icon: null, widenLabel: null, clearLabel: null };
}
