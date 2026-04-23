/**
 * Allowlisted Help Center screenshot slot ids (org_settings.help_center_screenshots keys).
 * Keep in sync with <HelpScreenshot slotId="…" /> usage in client articles.
 */
export const HELP_SCREENSHOT_SLOT_IDS = [
  "getting-started-timer-popover",
  "time-tracking-web-popover-task",
  "time-tracking-web-popover-disabled",
  "time-tracking-desktop-header-metrics",
  "time-tracking-idle-modal",
  "desktop-login",
  "desktop-picker-two-columns",
  "desktop-header-running",
  "desktop-idle-warning-countdown",
  "desktop-post-stop-modal",
  "admin-screenshot-capture-card",
  "admin-idle-behaviour-card",
  "faq-web-popover-desktop-message",
  "faq-admin-screenshot-master-switch",
] as const;

export type HelpScreenshotSlotId = (typeof HELP_SCREENSHOT_SLOT_IDS)[number];

export function isHelpScreenshotSlotId(value: string): value is HelpScreenshotSlotId {
  return (HELP_SCREENSHOT_SLOT_IDS as readonly string[]).includes(value);
}
