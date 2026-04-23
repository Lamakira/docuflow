import { Link, useRoute } from "wouter";
import { HelpDocLayout } from "@/components/help-center/HelpDocLayout";
import { Button } from "@/components/ui/button";
import { getHelpHubItem, isHelpSlug } from "@/content/help-center/helpCenterConfig";
import { HELP_ARTICLE_TOC } from "@/content/help-center/helpArticleToc";
import { HELP_ARTICLE_COMPONENTS } from "./articleRegistry";

export default function HelpCenterArticlePage() {
  const [, params] = useRoute("/help-center/:slug");
  const raw = params?.slug ?? "";
  const slug = isHelpSlug(raw) ? raw : null;

  if (!slug) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-4">This help topic was not found.</p>
        <Button asChild variant="default" size="sm">
          <Link href="/help-center">Back to Help Center</Link>
        </Button>
      </div>
    );
  }

  const meta = getHelpHubItem(slug);
  const Article = HELP_ARTICLE_COMPONENTS[slug];
  const toc = HELP_ARTICLE_TOC[slug];

  return (
    <HelpDocLayout title={meta?.title ?? "Help"} description={meta?.subtitle} toc={toc}>
      <Article />
    </HelpDocLayout>
  );
}
