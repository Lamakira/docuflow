/**
 * Help article bodies on both surfaces (#216, ADR-0003). The Help Center copy is
 * one set of components, but v2 chrome must not wear the discarded v1 visual
 * system: every class an article block puts on an element comes from this map,
 * so the flag-off Help Center keeps exactly the classes it had and v2 renders
 * the same copy on `--df-*` tokens.
 *
 * Motion is unchanged: article open stays opacity only (#194).
 */

export type HelpSurface = "v1" | "v2";

export type HelpDocBlock =
  | "article"
  | "section"
  | "sectionTitle"
  | "sectionBody"
  | "h3"
  | "p"
  | "list"
  | "orderedList"
  | "item"
  | "lead"
  | "leadTitle"
  | "leadBody"
  | "callout"
  | "calloutLabel"
  | "calloutIcon"
  | "calloutBody"
  | "strong"
  | "code"
  | "figure"
  | "figureFrame"
  | "figureImage"
  | "figureCaption"
  | "figureSlot"
  | "figureEmpty"
  | "figureAction"
  | "figureLoading"
  | "figureEmptyLabel"
  | "figureEmptyText"
  | "figureEmptyIcon"
  | "figureNote";

export type HelpLeadVariant = "intro" | "caution" | "neutral";
export type HelpCalloutVariant = "important" | "admin" | "next" | "note";

export const HELP_DOC_BLOCKS: HelpDocBlock[] = [
  "article",
  "section",
  "sectionTitle",
  "sectionBody",
  "h3",
  "p",
  "list",
  "orderedList",
  "item",
  "lead",
  "leadTitle",
  "leadBody",
  "callout",
  "calloutLabel",
  "calloutIcon",
  "calloutBody",
  "strong",
  "code",
  "figure",
  "figureFrame",
  "figureImage",
  "figureCaption",
  "figureSlot",
  "figureEmpty",
  "figureAction",
  "figureLoading",
  "figureEmptyLabel",
  "figureEmptyText",
  "figureEmptyIcon",
  "figureNote",
];

const V2_CLASSES: Record<HelpDocBlock, string> = {
  article: "df-doc-article",
  section: "df-doc-section",
  sectionTitle: "df-doc-section-title",
  sectionBody: "df-doc-section-body",
  h3: "df-doc-h3",
  p: "df-doc-p",
  list: "df-doc-list",
  orderedList: "df-doc-ordered-list",
  item: "df-doc-item",
  lead: "df-doc-lead",
  leadTitle: "df-doc-lead-title",
  leadBody: "df-doc-lead-body",
  callout: "df-doc-callout",
  calloutLabel: "df-doc-callout-label",
  calloutIcon: "df-doc-callout-icon",
  calloutBody: "df-doc-callout-body",
  strong: "df-doc-strong",
  code: "df-doc-code",
  figure: "df-doc-figure",
  figureFrame: "df-doc-figure-frame",
  figureImage: "df-doc-figure-image",
  figureCaption: "df-doc-figure-caption",
  figureSlot: "df-doc-figure-slot",
  figureEmpty: "df-doc-figure-empty",
  figureAction: "df-doc-figure-action",
  figureLoading: "df-doc-figure-loading",
  figureEmptyLabel: "df-doc-figure-empty-label",
  figureEmptyText: "df-doc-figure-empty-text",
  figureEmptyIcon: "df-doc-figure-empty-icon",
  figureNote: "df-doc-figure-note",
};

/** Exactly the classes the flag-off Help Center already rendered. */
const V1_CLASSES: Record<HelpDocBlock, string> = {
  article: "space-y-8",
  section:
    "mb-14 last:mb-0 scroll-mt-28 pt-2 first:pt-0 border-t border-border/40 first:border-t-0 first:mt-0 mt-2",
  sectionTitle: "text-xl sm:text-2xl font-semibold tracking-tight text-foreground pb-3 mb-5",
  sectionBody: "space-y-4 text-sm sm:text-[15px] text-muted-foreground leading-relaxed",
  h3: "text-[15px] sm:text-base font-semibold text-foreground mt-8 mb-2.5 pl-3 border-l-2 border-primary/40",
  p: "",
  list: "list-disc pl-5 space-y-2 marker:text-muted-foreground/80",
  orderedList: "list-decimal pl-5 space-y-2 marker:text-muted-foreground/80",
  item: "",
  lead: "mb-2 rounded-xl border border-border/60 py-4 pl-4 pr-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:pl-5 sm:pr-5 border-l-[3px]",
  leadTitle: "text-sm font-semibold tracking-tight text-foreground",
  leadBody: "mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed space-y-2 [&_p]:m-0",
  callout:
    "rounded-xl border px-4 py-3.5 text-sm leading-relaxed flex gap-3 shadow-sm ring-1 ring-black/5 dark:ring-white/5 [&_svg]:shrink-0 [&_svg]:mt-0.5",
  calloutLabel: "text-xs font-semibold",
  calloutIcon: "h-4 w-4",
  calloutBody: "min-w-0 space-y-2",
  strong: "text-foreground",
  code: "text-xs bg-muted px-1 py-0.5 rounded",
  figure: "my-8 space-y-3 not-prose",
  figureFrame:
    "relative overflow-hidden rounded-xl border border-border/70 bg-muted/30 shadow-inner ring-1 ring-border/30",
  figureImage: "w-full max-h-[min(70vh,520px)] object-contain bg-background/80",
  figureCaption: "text-xs text-muted-foreground px-1 leading-relaxed",
  figureSlot: "text-[11px] text-muted-foreground font-mono",
  figureEmpty:
    "my-8 rounded-xl border-2 border-dashed border-violet-500/45 bg-violet-500/[0.07] p-5 space-y-3 shadow-sm ring-1 ring-violet-500/10 text-sm text-foreground/90",
  figureAction: "h-7 text-xs shadow-sm",
  figureLoading: "flex items-center gap-2 text-xs text-muted-foreground py-2",
  figureEmptyLabel: "text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200",
  figureEmptyText: "text-xs text-muted-foreground leading-relaxed",
  figureEmptyIcon: "text-violet-600 dark:text-violet-400",
  figureNote: "text-[11px] text-muted-foreground leading-relaxed",
};

const V1_LEAD_TONES: Record<HelpLeadVariant, string> = {
  intro: "border-l-emerald-500/60 bg-emerald-500/[0.07]",
  caution: "border-l-amber-500/65 bg-amber-500/[0.07]",
  neutral: "border-l-muted-foreground/45 bg-muted/40",
};

const V1_CALLOUT_TONES: Record<HelpCalloutVariant, string> = {
  important: "border-amber-500/40 bg-amber-500/[0.07] text-amber-950 dark:text-amber-100/95",
  admin: "border-violet-500/35 bg-violet-500/[0.08] text-foreground/90",
  next: "border-primary/30 bg-primary/[0.06] text-foreground/90",
  note: "border-border/60 bg-muted/50 text-muted-foreground",
};

const V1_CALLOUT_LABEL_TONES: Record<HelpCalloutVariant, string> = {
  important: "uppercase tracking-wide text-amber-800 dark:text-amber-200/95",
  admin: "uppercase tracking-wide text-violet-800 dark:text-violet-200",
  next: "text-foreground",
  note: "uppercase tracking-wide text-muted-foreground/90",
};

const V1_CALLOUT_ICON_TONES: Record<HelpCalloutVariant, string> = {
  important: "text-amber-600 dark:text-amber-400",
  admin: "text-violet-600 dark:text-violet-400",
  next: "text-primary",
  note: "opacity-80",
};

export function docBlockClass(block: HelpDocBlock, surface: HelpSurface, variant?: string): string {
  if (surface === "v2") {
    const base = V2_CLASSES[block];
    if (block === "lead") return `${base} df-doc-lead-${leadVariant(variant)}`;
    if (block === "callout") return `${base} df-doc-callout-${calloutVariant(variant)}`;
    return base;
  }

  const base = V1_CLASSES[block];
  if (block === "lead") return join(base, V1_LEAD_TONES[leadVariant(variant)]);
  if (block === "callout") return join(base, V1_CALLOUT_TONES[calloutVariant(variant)]);
  if (block === "calloutLabel") return join(base, V1_CALLOUT_LABEL_TONES[calloutVariant(variant)]);
  if (block === "calloutIcon") return join(base, V1_CALLOUT_ICON_TONES[calloutVariant(variant)]);
  return base;
}

function leadVariant(variant: string | undefined): HelpLeadVariant {
  return variant === "caution" || variant === "neutral" ? variant : "intro";
}

function calloutVariant(variant: string | undefined): HelpCalloutVariant {
  return variant === "important" || variant === "admin" || variant === "next" ? variant : "note";
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}
