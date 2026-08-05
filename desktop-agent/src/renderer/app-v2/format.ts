/**
 * Display formatters for v2.
 *
 * The shared `formatTime` in app/types zero-pads hours (`01:36:12`). The design
 * drops that leading zero (`1:36:12`) — a running clock reads faster without a
 * digit that is almost always zero. Kept here rather than changed in app/types
 * so the shipping UI is untouched.
 */

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Durations in tables and totals: "2h 10m", "48m". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/**
 * Stat cards and totals: always "0h 48m".
 *
 * The hours part stays even at zero. These numbers sit in a fixed grid beside
 * each other, and a value that drops from "1h 02m" to "2m" changes width mid
 * count — the column stops being scannable exactly when it is moving.
 */
export function formatHM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
