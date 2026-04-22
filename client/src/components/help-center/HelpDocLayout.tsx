import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HelpDocLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function HelpDocLayout({ title, description, children }: HelpDocLayoutProps) {
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
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">{children}</div>
    </div>
  );
}
