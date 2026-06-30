/**
 * Linux idle-time query — GNOME Mutter IdleMonitor via D-Bus.
 *
 * Electron's powerMonitor.getSystemIdleTime() returns 0 on Linux/Wayland when
 * Chromium runs with the default X11 Ozone platform. Ubuntu GNOME exposes idle
 * time through org.gnome.Mutter.IdleMonitor.GetIdletime (milliseconds).
 */

import { execSync } from "child_process";

/** Idle seconds from the desktop compositor, or null when unavailable. */
export function getLinuxIdleSeconds(): number | null {
  if (process.platform !== "linux") return null;

  try {
    const out = execSync(
      "gdbus call -e -d org.gnome.Mutter.IdleMonitor -o /org/gnome/Mutter/IdleMonitor/Core " +
        "-m org.gnome.Mutter.IdleMonitor.GetIdletime",
      { timeout: 1_500, encoding: "utf8" }
    );
    const match = out.match(/\(uint64\s+(\d+),?\)/);
    if (match) {
      return Math.floor(parseInt(match[1], 10) / 1000);
    }
  } catch {
    // Non-GNOME compositor or gdbus unavailable
  }

  return null;
}
