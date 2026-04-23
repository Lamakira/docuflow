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
    <section className="mb-12 last:mb-0 scroll-mt-24">
      <h2
        id={sectionId}
        className="text-lg sm:text-xl font-semibold tracking-tight text-foreground border-b border-border pb-2 mb-4"
      >
        {title}
      </h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export function DocH3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-foreground mt-5 mb-2 pl-3 border-l-2 border-primary/35">
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

const calloutBase =
  "rounded-lg border px-3 py-2.5 text-sm leading-relaxed flex gap-2.5 [&_svg]:shrink-0 [&_svg]:mt-0.5";

export function DocCalloutImportant({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(calloutBase, "border-amber-500/35 bg-amber-500/5 text-amber-950 dark:text-amber-100/95")}>
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
      <div className="min-w-0 space-y-1.5">{children}</div>
    </div>
  );
}

export function DocCalloutAdmin({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(calloutBase, "border-violet-500/30 bg-violet-500/5 text-foreground/90")}>
      <Shield className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">Admin</p>
        {children}
      </div>
    </div>
  );
}

export function DocCalloutNext({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(calloutBase, "border-primary/25 bg-primary/5 text-foreground/90")}>
      <ArrowRight className="h-4 w-4 text-primary" aria-hidden />
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-semibold text-foreground">What happens next</p>
        {children}
      </div>
    </div>
  );
}

export function DocCalloutNote({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(calloutBase, "border-muted-foreground/20 bg-muted/40 text-muted-foreground")}>
      <Info className="h-4 w-4" aria-hidden />
      <div className="min-w-0 space-y-1.5">{children}</div>
    </div>
  );
}
