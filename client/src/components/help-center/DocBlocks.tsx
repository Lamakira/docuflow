/**
 * Shared typography blocks for Help Center articles. An article body carries no
 * class names of its own: every one comes from the surface map (#216), so the
 * same copy renders on the flag-off system or on v2 tokens.
 */

import { AlertTriangle, Info, Shield, ArrowRight } from "lucide-react";
import { docBlockClass, type HelpCalloutVariant, type HelpLeadVariant } from "@/v2/helpArticle";
import { useHelpSurface } from "./helpSurface";

export function DocArticle({ children }: { children: React.ReactNode }) {
  const surface = useHelpSurface();
  return <div className={docBlockClass("article", surface)}>{children}</div>;
}

export function DocSection({
  title,
  children,
  sectionId,
}: {
  title: string;
  children: React.ReactNode;
  /** Anchor id for in-page TOC links (e.g. `section-sign-in`). */
  sectionId?: string;
}) {
  const surface = useHelpSurface();
  return (
    <section className={docBlockClass("section", surface)}>
      <h2 id={sectionId} className={docBlockClass("sectionTitle", surface)}>
        {title}
      </h2>
      <div className={docBlockClass("sectionBody", surface)}>{children}</div>
    </section>
  );
}

export function DocH3({ children }: { children: React.ReactNode }) {
  return <h3 className={docBlockClass("h3", useHelpSurface())}>{children}</h3>;
}

export function DocList({ children }: { children: React.ReactNode }) {
  return <ul className={docBlockClass("list", useHelpSurface())}>{children}</ul>;
}

export function DocOrderedList({ children }: { children: React.ReactNode }) {
  return <ol className={docBlockClass("orderedList", useHelpSurface())}>{children}</ol>;
}

export function DocLi({ children }: { children: React.ReactNode }) {
  return <li className={docBlockClass("item", useHelpSurface())}>{children}</li>;
}

export function DocP({ children }: { children: React.ReactNode }) {
  return <p className={docBlockClass("p", useHelpSurface())}>{children}</p>;
}

/** Emphasis inside body copy — the ink is the surface's, not the article's. */
export function DocStrong({ children }: { children: React.ReactNode }) {
  return <strong className={docBlockClass("strong", useHelpSurface())}>{children}</strong>;
}

export function DocCode({ children }: { children: React.ReactNode }) {
  return <code className={docBlockClass("code", useHelpSurface())}>{children}</code>;
}

/** Top-of-article summary block (editorial “at a glance” — same role as a TL;DR, without changing body copy). */
export function DocLeadSummary({
  title,
  children,
  variant = "intro",
}: {
  title: string;
  children: React.ReactNode;
  variant?: HelpLeadVariant;
}) {
  const surface = useHelpSurface();
  return (
    <div className={docBlockClass("lead", surface, variant)}>
      <p className={docBlockClass("leadTitle", surface)}>{title}</p>
      <div className={docBlockClass("leadBody", surface)}>{children}</div>
    </div>
  );
}

function DocCallout({
  variant,
  label,
  children,
}: {
  variant: HelpCalloutVariant;
  label: string;
  children: React.ReactNode;
}) {
  const surface = useHelpSurface();
  const Icon = CALLOUT_ICONS[variant];
  return (
    <div className={docBlockClass("callout", surface, variant)}>
      <Icon className={docBlockClass("calloutIcon", surface, variant)} aria-hidden />
      <div className={docBlockClass("calloutBody", surface)}>
        <p className={docBlockClass("calloutLabel", surface, variant)}>{label}</p>
        {children}
      </div>
    </div>
  );
}

const CALLOUT_ICONS: Record<HelpCalloutVariant, typeof Info> = {
  important: AlertTriangle,
  admin: Shield,
  next: ArrowRight,
  note: Info,
};

export function DocCalloutImportant({ children }: { children: React.ReactNode }) {
  return (
    <DocCallout variant="important" label="Important">
      {children}
    </DocCallout>
  );
}

export function DocCalloutAdmin({ children }: { children: React.ReactNode }) {
  return (
    <DocCallout variant="admin" label="Admin">
      {children}
    </DocCallout>
  );
}

export function DocCalloutNext({ children }: { children: React.ReactNode }) {
  return (
    <DocCallout variant="next" label="What happens next">
      {children}
    </DocCallout>
  );
}

export function DocCalloutNote({ children }: { children: React.ReactNode }) {
  return (
    <DocCallout variant="note" label="Note">
      {children}
    </DocCallout>
  );
}
