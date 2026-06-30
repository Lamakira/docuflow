/**
 * Platform detection helpers.
 *
 * Centralises environment-specific checks so workers can adapt their behaviour
 * without each duplicating the same env-var lookups.
 */

/**
 * Returns true when the running Linux session is Wayland (either via
 * XDG_SESSION_TYPE=wayland or a non-empty WAYLAND_DISPLAY variable).
 *
 * On Wayland, Electron's desktopCapturer triggers the XDG Desktop Portal
 * screen-picker dialog on every call, which resets powerMonitor.getSystemIdleTime()
 * to zero and prevents the idle threshold from ever being reached in practice.
 */
export function isWaylandSession(): boolean {
  return (
    process.platform === "linux" &&
    (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY)
  );
}

/**
 * Whether screenshot capture should be skipped on Wayland.
 * Default: captures are enabled; the portal dialog pauses the timer locally first.
 * Set DOCUFLOW_SKIP_WAYLAND_CAPTURES=true to disable captures on Wayland entirely.
 * (Legacy: DOCUFLOW_ALLOW_WAYLAND_CAPTURES=false also disables captures.)
 */
export function shouldSkipWaylandCaptures(): boolean {
  if (!isWaylandSession()) return false;
  if (process.env.DOCUFLOW_SKIP_WAYLAND_CAPTURES === "true") return true;
  if (process.env.DOCUFLOW_ALLOW_WAYLAND_CAPTURES === "false") return true;
  return false;
}

export function getTestCaptureIntervalSeconds(): number | null {
  const raw = process.env.DOCUFLOW_TEST_CAPTURE_INTERVAL_SECONDS;
  if (!raw) return null;
  const sec = parseInt(raw, 10);
  return Number.isFinite(sec) && sec >= 5 ? sec : null;
}
