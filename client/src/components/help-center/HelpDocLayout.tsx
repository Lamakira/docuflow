import { Link } from "wouter";
import type { HelpTocItem } from "@/content/help-center/helpArticleToc";
import { HelpCenterSidebar } from "@/components/help-center/HelpCenterSidebar";
import { cn } from "@/lib/utils";

interface HelpDocLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Optional in-page navigation (anchor ids must exist in the article body). */
  toc?: HelpTocItem[];
}

export function HelpDocLayout({ title, description, children, toc }: HelpDocLayoutProps) {
  return (
    <div className="min-h-full bg-background">
      <div className="border-b border-border/50 bg-muted/15">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 text-sm">
          <Link href="/help-center" className="text-muted-foreground hover:text-foreground transition-colors">
            Help Center
          </Link>
          <span className="text-muted-foreground/35 mx-2 select-none" aria-hidden>
            /
          </span>
          <span className="font-medium text-foreground/90">{title}</span>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 lg:py-12">
        <div className="flex flex-col lg:flex-row lg:items-start gap-8 lg:gap-12">
          <HelpCenterSidebar />

          <main className="min-w-0 flex-1">
            <header className="mb-8 lg:mb-10 max-w-3xl">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
              {description ? (
                <p className="mt-3 text-base sm:text-[1.05rem] text-muted-foreground leading-relaxed">{description}</p>
              ) : null}
            </header>

            {toc && toc.length > 0 ? (
              <nav
                aria-label="On this page"
                className="mb-10 max-w-3xl rounded-xl border border-border/60 bg-card/35 p-4 sm:p-5 shadow-sm ring-1 ring-border/20"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  On this page
                </p>
                <ul className="space-y-1 border-l-2 border-primary/20 pl-4">
                  {toc.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={cn(
                          "block py-1.5 text-sm text-muted-foreground transition-colors",
                          "hover:text-primary border-l-2 border-transparent -ml-[2px] pl-3 -mr-1",
                          "hover:border-primary/50",
                        )}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}

            <article className="max-w-3xl rounded-xl border border-border/60 bg-card/20 px-6 py-8 sm:px-9 sm:py-10 shadow-sm ring-1 ring-border/25">
              <div className="space-y-8">{children}</div>
            </article>
          </main>
        </div>
      </div>
    </div>
  );
}
