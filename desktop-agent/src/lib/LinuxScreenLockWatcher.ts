/**
 * Linux screen-lock detection.
 *
 * Electron's powerMonitor lock-screen / unlock-screen events are not emitted on
 * Linux (Super+L locks the session but does not suspend). This watcher polls the
 * desktop's ScreenSaver D-Bus interface to detect lock/unlock transitions.
 */

import { execSync } from "child_process";

const POLL_MS = 2_000;

export class LinuxScreenLockWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastLocked: boolean | null = null;
  private onLock: () => void;
  private onUnlock: () => void;

  constructor(onLock: () => void, onUnlock: () => void) {
    this.onLock = onLock;
    this.onUnlock = onUnlock;
  }

  start(): void {
    if (this.interval) return;
    if (process.platform !== "linux") return;

    this.interval = setInterval(() => this.poll(), POLL_MS);
    // Initial sample so we don't fire unlock on first tick after start
    this.lastLocked = this.queryScreenLocked();
    console.log(`[LinuxScreenLockWatcher] Started (poll ${POLL_MS}ms, initial locked=${this.lastLocked})`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.lastLocked = null;
    console.log("[LinuxScreenLockWatcher] Stopped");
  }

  private poll(): void {
    const locked = this.queryScreenLocked();
    if (locked === null) return;

    if (this.lastLocked === null) {
      this.lastLocked = locked;
      return;
    }
    if (locked === this.lastLocked) return;

    this.lastLocked = locked;
    if (locked) {
      console.log("[LinuxScreenLockWatcher] Screen locked");
      this.onLock();
    } else {
      console.log("[LinuxScreenLockWatcher] Screen unlocked");
      this.onUnlock();
    }
  }

  /** Returns true/false when detectable, null when no ScreenSaver API is available. */
  private queryScreenLocked(): boolean | null {
    // GNOME / Ubuntu default
    const gnome = this.tryGdbus(
      "org.gnome.ScreenSaver",
      "/org/gnome/ScreenSaver",
      "org.gnome.ScreenSaver.GetActive"
    );
    if (gnome !== null) return gnome;

    // KDE / generic freedesktop
    const fd = this.tryDbusSend(
      "org.freedesktop.ScreenSaver",
      "/org/freedesktop/ScreenSaver",
      "org.freedesktop.ScreenSaver.GetActive"
    );
    if (fd !== null) return fd;

    return null;
  }

  private tryGdbus(dest: string, path: string, method: string): boolean | null {
    try {
      const out = execSync(
        `gdbus call -e -d ${dest} -o ${path} -m ${method}`,
        { timeout: 1_500, encoding: "utf8" }
      );
      if (out.includes("true")) return true;
      if (out.includes("false")) return false;
      return null;
    } catch {
      return null;
    }
  }

  private tryDbusSend(dest: string, path: string, method: string): boolean | null {
    try {
      const out = execSync(
        `dbus-send --print-reply --dest=${dest} ${path} ${method}`,
        { timeout: 1_500, encoding: "utf8" }
      );
      if (out.includes("boolean true")) return true;
      if (out.includes("boolean false")) return false;
      return null;
    } catch {
      return null;
    }
  }
}
