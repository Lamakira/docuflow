/**
 * v2 motion substrate (#182). Later tickets import this instead of inventing
 * curves. Frequency then purpose: if either fails, the output is no animation.
 *
 * Do not animate: search `/`, command-palette overlays, rail destination
 * clicks, focus jumps, Workspace chooser pointer/keyboard, Timer chip on switch,
 * search keystrokes, result-list filtering.
 * Workspace switch content may crossfade (occasional; preventing a jarring change).
 * Toasts enter and exit the same bottom edge (occasional; spatial consistency).
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
  | "workspace-chooser-pointer"
  | "workspace-chooser-keyboard"
  | "timer-chip"
  | "toast";

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
  "workspace-chooser-pointer": "keyboard-or-100+",
  "workspace-chooser-keyboard": "keyboard-or-100+",
  "timer-chip": "keyboard-or-100+",
  toast: "occasional",
};

export function motionForSurface(
  surface: MotionSurface,
  prefs: { reducedMotion?: boolean } = {},
): MotionRecipe {
  const frequency = FREQUENCY[surface];

  if (frequency === "keyboard-or-100+") {
    return { enterExit: "instant", press: "none", movement: "none", keepOpacity: true };
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
