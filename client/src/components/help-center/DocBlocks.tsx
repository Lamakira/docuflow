/** Shared typography blocks for Help Center articles (additive, no prose plugin dependency). */

export function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 mb-10 last:mb-0">
      <h2 className="text-lg font-semibold text-foreground scroll-mt-20">{title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export function DocH3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground pt-1">{children}</h3>;
}

export function DocList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-2">{children}</ul>;
}

export function DocOrderedList({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal pl-5 space-y-2">{children}</ol>;
}

export function DocLi({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

export function DocP({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

/** Help Center: reserve space for a future capture without embedding images. */
export function DocScreenshotPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-muted-foreground/35 bg-muted/25 px-3 py-2 font-mono text-[11px] leading-snug text-muted-foreground">
      {children}
    </p>
  );
}
