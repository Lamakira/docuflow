import type { HelpSlug } from "@/content/help-center/helpCenterConfig";

export interface HelpTocItem {
  id: string;
  label: string;
}

/** In-page anchors for major sections (must match DocSection `sectionId` on each article). */
export const HELP_ARTICLE_TOC: Partial<Record<HelpSlug, HelpTocItem[]>> = {
  "getting-started": [
    { id: "section-sign-in", label: "Sign in" },
    { id: "section-navigate", label: "Navigate the web app" },
    { id: "section-where-timer", label: "Where the timer is" },
    { id: "section-next", label: "Where to go next" },
  ],
  "time-tracking": [
    { id: "section-entry-points", label: "Where you start the timer" },
    { id: "section-controls", label: "Start, pause, resume, stop" },
    { id: "section-metrics-desktop", label: "Worked Today & This session" },
    { id: "section-idle-activity", label: "Idle and activity" },
    { id: "section-screenshots", label: "Screenshots and signals" },
    { id: "section-web-desktop", label: "Web vs desktop" },
  ],
  "desktop-app": [
    { id: "section-download", label: "Download and install" },
    { id: "section-sign-in-agent", label: "Sign in (device)" },
    { id: "section-picker", label: "Project and task picker" },
    { id: "section-header", label: "Header and timer" },
    { id: "section-idle", label: "Idle warning" },
    { id: "section-post-stop", label: "After idle stop" },
    { id: "section-activity-widget", label: "Activity bar & widget" },
    { id: "section-responsibilities", label: "Agent responsibilities" },
    { id: "section-server-web", label: "Server & web" },
  ],
  administration: [
    { id: "section-org-policy", label: "Organisation policy and agents" },
    { id: "section-screenshot-policy", label: "Screenshot capture policy" },
    { id: "section-idle-policy", label: "Idle behaviour policy" },
    { id: "section-user-impact", label: "What settings affect users" },
    { id: "section-screencasts-tz", label: "Screencasts timezones" },
    { id: "section-admin-followup", label: "User management or admin requests" },
  ],
  "faq-troubleshooting": [
    { id: "section-cannot-start", label: "Cannot start tracking" },
    { id: "section-desktop-message", label: "Use the desktop agent message" },
    { id: "section-numbers", label: "Numbers do not match" },
    { id: "section-admin-delay", label: "Admin changes not instant" },
    { id: "section-screenshots-missing", label: "Screenshots missing" },
    { id: "section-disconnected", label: "Desktop disconnected" },
    { id: "section-worked-today", label: "Worked Today vs This session" },
    { id: "section-timezone", label: "Timezone and today" },
  ],
};
