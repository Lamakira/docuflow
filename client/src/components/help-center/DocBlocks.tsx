/** Shared typography blocks for Help Center articles (additive, no prose plugin dependency). */

import { AlertTriangle, Info, Shield, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

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
  return (
    <section className="mb-14 last:mb-0 scroll-mt-28 pt-2 first:pt-0 border-t border-border/40 first:border-t-0 first:mt-0 mt-2">
      <h2
        id={sectionId}
        className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground pb-3 mb-5"
      >
        {title}
      </h2>
      <div className="space-y-4 text-sm sm:text-[15px] text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export function DocH3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[15px] sm:text-base font-semibold text-foreground mt-8 mb-2.5 pl-3 border-l-2 border-primary/40">
      {children}
    </h3>
  );
}

export function DocList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-2 marker:text-muted-foreground/80">{children}</ul>;
}

export function DocOrderedList({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal pl-5 space-y-2 marker:text-muted-foreground/80">{children}</ol>;
}

export function DocLi({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

export function DocP({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn(className)}>{children}</p>;
}

/** Top-of-article summary block (editorial “at a glance” — same role as a TL;DR, without changing body copy). */
export function DocLeadSummary({
  title,
  children,
  variant = "intro",
}: {
  title: string;
  children: React.ReactNode;
  variant?: "intro" | "caution" | "neutral";
}) {
  const tone =
    variant === "caution"
      ? "border-l-amber-500/65 bg-amber-500/[0.07]"
      : variant === "neutral"
        ? "border-l-muted-foreground/45 bg-muted/40"
        : "border-l-emerald-500/60 bg-emerald-500/[0.07]";

  return (
    <div
      className={cn(
        "mb-2 rounded-xl border border-border/60 py-4 pl-4 pr-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:pl-5 sm:pr-5",
        "border-l-[3px]",
        tone,
      )}
    >
      <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
      <div className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed space-y-2 [&_p]:m-0">
        {children}
      </div>
    </div>
  );
}

const calloutBase =
  "rounded-xl border px-4 py-3.5 text-sm leading-relaxed flex gap-3 shadow-sm ring-1 ring-black/5 dark:ring-white/5 [&_svg]:shrink-0 [&_svg]:mt-0.5";

export function DocCalloutImportant({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(calloutBase, "border-amber-500/40 bg-amber-500/[0.07] text-amber-950 dark:text-amber-100/95")}>
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200/95">Important</p>
        {children}
      </div>
    </div>
  );
}

export function DocCalloutAdmin({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(calloutBase, "border-violet-500/35 bg-violet-500/[0.08] text-foreground/90")}>
      <Shield className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">Admin</p>
        {children}
      </div>
    </div>
  );
}

export function DocCalloutNext({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(calloutBase, "border-primary/30 bg-primary/[0.06] text-foreground/90")}>
      <ArrowRight className="h-4 w-4 text-primary" aria-hidden />
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold text-foreground">What happens next</p>
        {children}
      </div>
    </div>
  );
}

export function DocCalloutNote({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(calloutBase, "border-border/60 bg-muted/50 text-muted-foreground")}>
      <Info className="h-4 w-4 opacity-80" aria-hidden />
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/90">Note</p>
        {children}
      </div>
    </div>
  );
}
