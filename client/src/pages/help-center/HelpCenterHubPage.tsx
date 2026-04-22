import { HelpCategoryCard } from "@/components/help-center/HelpCategoryCard";
import { HELP_HUB_ITEMS } from "@/content/help-center/helpCenterConfig";
import { CircleHelp } from "lucide-react";

export default function HelpCenterHubPage() {
  return (
    <div className="min-h-full bg-background">
      <div className="border-b bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10 sm:py-12">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
            <div className="rounded-xl bg-primary/10 p-3 text-primary shrink-0 self-start">
              <CircleHelp className="h-8 w-8 sm:h-10 sm:w-10" aria-hidden />
            </div>
            <div className="min-w-0 space-y-3">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Help Center</h1>
              <p className="text-sm sm:text-base text-muted-foreground max-w-2xl leading-relaxed">
                Documentation for DocuFlow — time tracking, projects, desktop agent, and administration. Choose a topic
                below; each guide is self-contained and updated as the product evolves.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-10">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Browse by category</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {HELP_HUB_ITEMS.map((item) => (
            <HelpCategoryCard key={item.slug} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
