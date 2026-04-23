import { Link } from "wouter";
import { HelpCategoryCard } from "@/components/help-center/HelpCategoryCard";
import { HelpCenterSidebar } from "@/components/help-center/HelpCenterSidebar";
import { HELP_HUB_ITEMS } from "@/content/help-center/helpCenterConfig";
import { CircleHelp } from "lucide-react";

export default function HelpCenterHubPage() {
  return (
    <div className="min-h-full bg-background">
      <div className="border-b border-border/50 bg-muted/15">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 text-sm font-medium text-foreground/90">Help Center</div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 lg:py-12">
        <div className="flex flex-col lg:flex-row lg:items-start gap-8 lg:gap-12">
          <HelpCenterSidebar />

          <div className="min-w-0 flex-1 space-y-10 lg:space-y-12">
            <header className="rounded-xl border border-border/50 bg-gradient-to-br from-card/80 to-muted/20 px-5 py-8 sm:px-8 sm:py-10 shadow-sm ring-1 ring-border/20">
              <div className="flex flex-col sm:flex-row sm:items-start gap-5 sm:gap-6">
                <div className="rounded-xl bg-primary/12 p-3 text-primary shrink-0 self-start ring-1 ring-primary/20">
                  <CircleHelp className="h-8 w-8 sm:h-10 sm:w-10" aria-hidden />
                </div>
                <div className="min-w-0 space-y-3">
                  <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Help Center</h1>
                  <p className="text-sm sm:text-base text-muted-foreground max-w-2xl leading-relaxed">
                    Documentation for DocuFlow — time tracking, projects, desktop agent, and administration. Choose a topic
                    below; each guide is self-contained and updated as the product evolves.
                  </p>
                </div>
              </div>
            </header>

            <section aria-labelledby="browse-heading">
              <div className="flex items-end justify-between gap-4 border-b border-border/50 pb-4 mb-6">
                <h2 id="browse-heading" className="text-lg font-semibold text-foreground tracking-tight">
                  Browse topics
                </h2>
                <p className="hidden sm:block text-xs text-muted-foreground">Updated as the product evolves</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
                {HELP_HUB_ITEMS.map((item) => (
                  <HelpCategoryCard key={item.slug} item={item} />
                ))}
              </div>
            </section>

            <p className="text-center text-xs text-muted-foreground pt-2">
              Looking for something else?{" "}
              <Link href="/" className="text-primary underline-offset-4 hover:underline">
                Return to the app
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
