import { Link } from "wouter";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import type { HelpHubItem } from "@/content/help-center/helpCenterConfig";

interface HelpCategoryCardProps {
  item: HelpHubItem;
}

export function HelpCategoryCard({ item }: HelpCategoryCardProps) {
  const Icon = item.icon;
  return (
    <Link href={`/help-center/${item.slug}`} className="block group">
      <Card className="h-full border-border/70 shadow-sm transition-all hover:border-primary/40 hover:bg-muted/35 hover:shadow-md">
        <CardHeader className="space-y-3 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold leading-snug">{item.title}</CardTitle>
            <CardDescription className="mt-2 text-sm leading-relaxed">{item.subtitle}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
