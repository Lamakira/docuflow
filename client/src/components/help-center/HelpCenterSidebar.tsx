import { Link, useLocation } from "wouter";
import { HELP_HUB_ITEMS } from "@/content/help-center/helpCenterConfig";
import { cn } from "@/lib/utils";
import { BookOpen, LayoutGrid } from "lucide-react";

function railLinkClass(active: boolean) {
  return cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
    active
      ? "bg-primary/12 text-primary font-medium border-l-2 border-primary"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground border-l-2 border-transparent",
  );
}

/**
 * Persistent documentation navigation (desktop: vertical rail; mobile: horizontal chips).
 */
export function HelpCenterSidebar() {
  const [location] = useLocation();
  const hubActive = location === "/help-center" || location === "/help-center/";

  return (
    <>
      <nav
        aria-label="Help topics"
        className="lg:hidden -mx-1 mb-8 flex gap-2 overflow-x-auto pb-1"
      >
        <Link
          href="/help-center"
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium",
            hubActive
              ? "border-primary/50 bg-primary/15 text-primary"
              : "border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted/50",
          )}
        >
          Overview
        </Link>
        {HELP_HUB_ITEMS.map((item) => {
          const path = `/help-center/${item.slug}`;
          const active = location === path;
          return (
            <Link
              key={item.slug}
              href={path}
              className={cn(
                "shrink-0 max-w-[220px] truncate rounded-full border px-3 py-1.5 text-xs font-medium",
                active
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted/50",
              )}
            >
              {item.title}
            </Link>
          );
        })}
      </nav>

      <aside className="hidden lg:block w-56 xl:w-60 shrink-0">
        <div className="sticky top-20 space-y-1">
          <p className="flex items-center gap-2 px-3 pb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            Documentation
          </p>
          <nav aria-label="Help topics" className="space-y-0.5 border-l border-border/50 pl-3">
            <Link href="/help-center" className={railLinkClass(hubActive)}>
              <LayoutGrid className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              <span>Overview</span>
            </Link>
            {HELP_HUB_ITEMS.map((item) => {
              const path = `/help-center/${item.slug}`;
              const active = location === path;
              const Icon = item.icon;
              return (
                <Link key={item.slug} href={path} className={railLinkClass(active)}>
                  <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                  <span className="min-w-0 leading-snug">{item.title}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
