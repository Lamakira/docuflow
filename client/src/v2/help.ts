/**
 * Help Center destination (#194).
 * Novelty: article open is opacity only (tens/day).
 * Do not animate: Help search keystrokes, article TOC highlight chasing scroll.
 */

import { HELP_ARTICLE_TOC } from "../content/help-center/helpArticleToc";
import {
  getHelpHubItem,
  HELP_HUB_ITEMS,
  isHelpSlug,
  type HelpSlug,
} from "../content/help-center/helpCenterConfig";

export type HelpTopic = {
  slug: HelpSlug;
  title: string;
  subtitle: string;
  href: string;
};

export type HelpTocItem = {
  id: string;
  label: string;
};

export type HelpHubModel = {
  kind: "hub";
  topics: HelpTopic[];
};

export type HelpArticleModel = {
  kind: "article";
  slug: HelpSlug;
  title: string;
  subtitle: string;
  toc: HelpTocItem[];
  backHref: "/help";
};

export type HelpMissingModel = {
  kind: "missing";
  emptyCopy: string;
  backHref: "/help";
};

export type HelpModel = HelpHubModel | HelpArticleModel | HelpMissingModel;

export function helpHubPath(): string {
  return "/help";
}

export function helpArticleHref(slug: HelpSlug): string {
  return `/help/${slug}`;
}

function slugFromPath(path: string): string | undefined {
  const parts = (path.split("?")[0] || "/").split("/").filter(Boolean);
  if (parts[0] !== "help" && parts[0] !== "help-center") return undefined;
  return parts[1];
}

function topicFromHub(slug: HelpSlug): HelpTopic {
  const item = getHelpHubItem(slug)!;
  return {
    slug: item.slug,
    title: item.title,
    subtitle: item.subtitle,
    href: helpArticleHref(item.slug),
  };
}

export function composeHelp(input: { path: string; query: string }): HelpModel {
  const slug = slugFromPath(input.path);
  if (slug) {
    if (!isHelpSlug(slug)) {
      return {
        kind: "missing",
        emptyCopy: "This Help Center topic was not found.",
        backHref: "/help",
      };
    }
    const meta = getHelpHubItem(slug);
    return {
      kind: "article",
      slug,
      title: meta?.title ?? "Help",
      subtitle: meta?.subtitle ?? "",
      toc: HELP_ARTICLE_TOC[slug] ?? [],
      backHref: "/help",
    };
  }

  const query = input.query.trim().toLowerCase();
  const topics = HELP_HUB_ITEMS
    .filter((item) => {
      if (!query) return true;
      return item.title.toLowerCase().includes(query) || item.subtitle.toLowerCase().includes(query);
    })
    .map((item) => topicFromHub(item.slug));

  return { kind: "hub", topics };
}

/* ------------------------------------------------------- Contact support --- */

export const SUPPORT_REQUESTS_PATH = "/api/support-requests";
export const SUPPORT_REQUEST_MAX = 5000;

export const supportRequestCategories: Array<{ value: "billing" | "bug" | "account" | "other"; label: string }> = [
  { value: "billing", label: "Billing" },
  { value: "bug", label: "Bug" },
  { value: "account", label: "Account" },
  { value: "other", label: "Other" },
];

export const CONTACT_SUPPORT_COPY = {
  title: "Contact support",
  description:
    "Platform Staff answer by email. Your request carries your Workspace and your account, never anything inside the Workspace.",
  sent: "Support Request sent. Platform Staff answer by email.",
} as const;

export function validateSupportRequest(input: {
  category: string;
  message: string;
}):
  | { ok: true; body: { category: string; message: string } }
  | { ok: false; reason: string } {
  if (!supportRequestCategories.some((category) => category.value === input.category)) {
    return { ok: false, reason: "Choose a category." };
  }
  const message = input.message.trim();
  if (!message) return { ok: false, reason: "Describe what you need help with." };
  if (message.length > SUPPORT_REQUEST_MAX) {
    return { ok: false, reason: `Keep your message under ${SUPPORT_REQUEST_MAX} characters.` };
  }
  return { ok: true, body: { category: input.category, message } };
}
