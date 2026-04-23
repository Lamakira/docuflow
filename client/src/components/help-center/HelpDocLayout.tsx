import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HelpTocItem } from "@/content/help-center/helpArticleToc";

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
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" className="-ml-2 h-8 text-muted-foreground" asChild>
              <Link href="/help-center">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Help Center
              </Link>
            </Button>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mt-1 truncate">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        {toc && toc.length > 0 ? (
          <nav
            aria-label="On this page"
            className="mb-10 rounded-xl border border-border bg-muted/20 p-4 sm:p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">On this page</p>
            <ul className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-x-4 sm:gap-y-2 text-sm">
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="text-primary hover:underline underline-offset-4 decoration-primary/50"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
