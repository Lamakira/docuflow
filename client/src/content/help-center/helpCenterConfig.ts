import type { LucideIcon } from "lucide-react";
import {
  Rocket,
  Timer,
  FolderKanban,
  Monitor,
  Layers,
  Shield,
  MessageCircleQuestion,
  ScrollText,
} from "lucide-react";

export const HELP_SLUGS = [
  "getting-started",
  "time-tracking",
  "crm-projects-tasks",
  "desktop-app",
  "devices-entries-screencasts",
  "administration",
  "faq-troubleshooting",
  "release-notes",
] as const;

export type HelpSlug = (typeof HELP_SLUGS)[number];

export function isHelpSlug(value: string): value is HelpSlug {
  return (HELP_SLUGS as readonly string[]).includes(value);
}

export interface HelpHubItem {
  slug: HelpSlug;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export const HELP_HUB_ITEMS: HelpHubItem[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    subtitle: "Account, sign-in, navigation, and main areas of DocuFlow.",
    icon: Rocket,
  },
  {
    slug: "time-tracking",
    title: "Time Tracking",
    subtitle: "Timer, sessions, Worked Today, idle handling, screenshots, and activity.",
    icon: Timer,
  },
  {
    slug: "crm-projects-tasks",
    title: "Projects & Tasks",
    subtitle: "CRM projects, tasks, assignment, and naming tips.",
    icon: FolderKanban,
  },
  {
    slug: "desktop-app",
    title: "Desktop App Guides",
    subtitle: "Download, install, sign-in, background behaviour, idle, and activity bar.",
    icon: Monitor,
  },
  {
    slug: "devices-entries-screencasts",
    title: "Devices, Entries & Screencasts",
    subtitle: "What each area is for, how to read data, and common filters.",
    icon: Layers,
  },
  {
    slug: "administration",
    title: "Administration",
    subtitle: "Policies, users, and settings — including admin-only areas.",
    icon: Shield,
  },
  {
    slug: "faq-troubleshooting",
    title: "FAQ & Troubleshooting",
    subtitle: "Timer issues, sync, desktop connection, screenshots, and time display.",
    icon: MessageCircleQuestion,
  },
  {
    slug: "release-notes",
    title: "Release Notes",
    subtitle: "What changed recently and how to follow updates.",
    icon: ScrollText,
  },
];

export function getHelpHubItem(slug: HelpSlug): HelpHubItem | undefined {
  return HELP_HUB_ITEMS.find((item) => item.slug === slug);
}
