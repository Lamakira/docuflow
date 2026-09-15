/**
 * v2 motion substrate (#182). Later tickets import this instead of inventing
 * curves. Frequency then purpose: if either fails, the output is no animation.
 *
 * Do not animate: search `/`, command-palette overlays, rail destination
 * clicks, focus jumps, Workspace chooser pointer/keyboard, Timer chip on switch,
 * search keystrokes, result-list filtering, Ask composer keystrokes, Delivery
 * Preference toggles, library filter typing, editor keystrokes.
 * Folder expand may animate height (occasional; state indication).
 * Save state may morph color/opacity without a celebration.
 * Workspace switch content may crossfade (occasional; preventing a jarring change).
 * Client register → record may fade the body while identity stays (occasional; preventing a jarring change).
 * Dossier tab content may crossfade; the tab underline is state, not a parade (occasional; preventing a jarring change).
 * Opportunity Stage-change moves the card to another Stage column (occasional; state indication).
 * Time Entry add/remove uses an enter/exit bridge (occasional; preventing a jarring change).
 * Remind from Today resolves the row or opens a refusal from that control (occasional; state indication).
 * Activity Evidence expands from its row (occasional; spatial consistency).
 * A File opens from its Dossier row (occasional; spatial consistency) — the row is the origin.
 * Do not animate: note composer keystrokes, Reminder date typing, module-field option drag
 * as decoration unless the drag is the write.
 * Capability refusal opens from the control that failed (occasional; spatial consistency).
 * A shown-once secret confirmation is rare state indication, not a celebration overlay.
 * Toasts enter and exit the same bottom edge (occasional; spatial consistency).
 * A Notification appearing in the inbox enters from that same edge (occasional; spatial consistency).
 * Accepting an Invitation is rare state indication (Membership appears in People). No bounce.
 * Pairing code appears as rare explanation / state — no bounce, there is no gesture.
 * A saved Tracking Policy is signed off (occasional; state indication) — no celebration.
 * A loading skeleton carries the destination's real geometry and breathes on opacity only,
 * so nothing moves when the data lands; reduced motion stops the breathe outright.
 * Do not animate: analytics charts or figures as decoration, billing figures counting up,
 * Tracking Policy keystrokes, timezone list typing.
 * Help article open is tens/day — opacity only, no page-slide.
 * Do not animate: Help search keystrokes, pairing spinner as decoration, article TOC highlight chasing scroll,
 * register filter typing, role dropdown as decoration, seat digits counting.
 * Changing the Time stats period is occasional (preventing a jarring change) — opacity only, no movement.
 * Do not animate: ticking elapsed seconds, by-Project histogram bars as a parade,
 * Activity Evidence thumbnail layout shift, gallery filter applying.
 */

export const V2_MOTION_TOKENS = {
  easeOut: "--ease-out",
  easeInOut: "--ease-in-out",
  easeDrawer: "--ease-drawer",
  durationPress: "--duration-press",
  durationUi: "--duration-ui",
  durationDrawer: "--duration-drawer",
} as const;

export type MotionSurface =
  | "search-overlay"
  | "rail-destination"
  | "command-palette"
  | "focus-jump"
  | "chrome-press"
  | "rail-collapse"
  | "workspace-switch"
  | "client-register-record"
  | "dossier-tab-swap"
  | "opportunity-stage-change"
  | "time-entry"
  | "time-stats-period"
  | "activity-evidence-expand"
  | "activity-gallery-filter"
  | "dossier-file-open"
  | "capability-refusal"
  | "secret-once"
  | "tracking-policy-save"
  | "skeleton"
  | "workspace-chooser-pointer"
  | "workspace-chooser-keyboard"
  | "timer-chip"
  | "toast"
  | "folder-expand"
  | "library-filter"
  | "editor-typing"
  | "editor-save"
  | "pairing-code"
  | "help-article"
  | "help-search"
  | "daily-update-remind"
  | "notification-inbox"
  | "ask-composer"
  | "delivery-preference"
  | "invitation-accept"
  | "people-filter"
  | "people-role"
  | "people-seats";

export type MotionRecipe = {
  enterExit: "instant" | "standard" | "none";
  press: "scale" | "none";
  movement: "allowed" | "none";
  keepOpacity: true;
};

type Frequency = "keyboard-or-100+" | "tens" | "occasional";

const FREQUENCY: Record<MotionSurface, Frequency> = {
  "search-overlay": "keyboard-or-100+",
  "rail-destination": "keyboard-or-100+",
  "command-palette": "keyboard-or-100+",
  "focus-jump": "keyboard-or-100+",
  "chrome-press": "tens",
  "rail-collapse": "occasional",
  "workspace-switch": "occasional",
  "client-register-record": "occasional",
  "dossier-tab-swap": "occasional",
  "opportunity-stage-change": "occasional",
  "time-entry": "occasional",
  "time-stats-period": "occasional",
  "activity-evidence-expand": "occasional",
  "activity-gallery-filter": "tens",
  "dossier-file-open": "occasional",
  "capability-refusal": "occasional",
  "secret-once": "occasional",
  "tracking-policy-save": "occasional",
  // Shown on most navigations: no enter/exit, no movement, opacity only.
  skeleton: "keyboard-or-100+",
  "workspace-chooser-pointer": "keyboard-or-100+",
  "workspace-chooser-keyboard": "keyboard-or-100+",
  "timer-chip": "keyboard-or-100+",
  toast: "occasional",
  "folder-expand": "occasional",
  "library-filter": "keyboard-or-100+",
  "editor-typing": "keyboard-or-100+",
  "editor-save": "occasional",
  "pairing-code": "occasional",
  "help-article": "tens",
  "help-search": "keyboard-or-100+",
  "daily-update-remind": "occasional",
  "notification-inbox": "occasional",
  "ask-composer": "keyboard-or-100+",
  "delivery-preference": "keyboard-or-100+",
  "invitation-accept": "occasional",
  "people-filter": "keyboard-or-100+",
  "people-role": "keyboard-or-100+",
  "people-seats": "keyboard-or-100+",
};

const OPACITY_ONLY = new Set<MotionSurface>(["help-article", "editor-save", "time-stats-period"]);

export function motionForSurface(
  surface: MotionSurface,
  prefs: { reducedMotion?: boolean } = {},
): MotionRecipe {
  const frequency = FREQUENCY[surface];

  if (frequency === "keyboard-or-100+") {
    return { enterExit: "instant", press: "none", movement: "none", keepOpacity: true };
  }

  // Surfaces that may bridge but must not move: opacity carries the change.
  // A Help article must not page-slide; a save state must not celebrate; the
  // Time stats figures must not slide under a new period.
  if (OPACITY_ONLY.has(surface)) {
    return { enterExit: "standard", press: "none", movement: "none", keepOpacity: true };
  }

  // Drop movement; keep opacity/color. Occasional surfaces may still fade.
  if (prefs.reducedMotion) {
    return {
      enterExit: frequency === "occasional" ? "standard" : "none",
      press: "none",
      movement: "none",
      keepOpacity: true,
    };
  }

  if (frequency === "tens") {
    return { enterExit: "none", press: "scale", movement: "none", keepOpacity: true };
  }

  return { enterExit: "standard", press: "none", movement: "allowed", keepOpacity: true };
}
