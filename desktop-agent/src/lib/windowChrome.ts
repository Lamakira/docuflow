/**
 * How the agent's window wears its chrome.
 *
 * The v2 UI draws its own title bar, and on Linux it draws the whole window:
 * frameless and transparent, so the rounded corners show the desktop instead of
 * a square frame underneath. What that costs is not the same on every OS, so
 * the mode is not either.
 *
 *   app         Frameless and transparent — the app draws the corners and the
 *               three window buttons. A Linux compositor gives a transparent
 *               window nothing of its own, so there is nothing to lose.
 *   app-opaque  Frameless but opaque, for Windows. A transparent window there
 *               loses the drop shadow and the edge regions that drive snap and
 *               resize, and Windows 11 already rounds the corners the app would
 *               otherwise cut for itself.
 *   inset       macOS: the native frame stays, with the traffic lights hidden
 *               inside the app's own bar. Drawing our own would put the three
 *               buttons on the side of the window macOS users do not reach for,
 *               and cost the native shadow, corners and zoom behaviour with them.
 *   native      v1's ordinary framed window.
 *
 * Only the main process can act on this — `frame`, `transparent` and
 * `titleBarStyle` are construction-time BrowserWindow options — but the
 * renderer has to know which one it got, because the mode decides whether it
 * owes the user window buttons and whether it may cut its own corners.
 */
export type ChromeMode = 'app' | 'app-opaque' | 'inset' | 'native';

/**
 * Where macOS puts the traffic lights in `inset`.
 *
 * They land over the icon rail, not the stage's bar, because the rail is the
 * window's left edge. The rail's own top padding is what keeps the logo clear
 * of them (see `[data-chrome="inset"] .v2-rail` in app-v2/styles/app.css) —
 * move one and the other has to follow.
 */
export const TRAFFIC_LIGHT_POSITION = { x: 18, y: 18 };

export function chromeModeFor(platform: NodeJS.Platform, usesV2Ui: boolean): ChromeMode {
  if (!usesV2Ui) return 'native';
  if (platform === 'darwin') return 'inset';
  if (platform === 'win32') return 'app-opaque';
  return 'app';
}

/** True when the app owes the user the minimise / maximise / close buttons. */
export function drawsWindowControls(mode: ChromeMode): boolean {
  return mode === 'app' || mode === 'app-opaque';
}
