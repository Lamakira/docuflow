/**
 * Process lifetime for the desktop agent (#237).
 *
 * Ctrl+C on `electron-forge start` killed the forge parent and returned the
 * prompt while the Electron main process kept running — same server, same
 * credential, same workers. Nothing in the terminal said the application was
 * still alive. A second launch then shared `agent-queue.json` with the first.
 *
 * These helpers are the decisions the main process makes. The wiring is
 * `main/index.ts` (signals, orphan watchdog, single-instance lock before any
 * store is opened) and `scripts/start-dev.js` (Ctrl+C kills the Electron tree).
 * Unpackaged Electron may already be reparented to init, so the wrapper
 * exports `DOCUFLOW_DEV_PARENT_PID` and the main process watches that pid,
 * not `process.ppid`.
 */

export const INSTANCE_RECORD_FILENAME = "instance.json";

export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export type InstanceRecord = {
  pid: number;
  apiBase: string;
};

export function formatInstanceRecord(record: InstanceRecord): string {
  return JSON.stringify({ pid: record.pid, apiBase: record.apiBase });
}

export function parseInstanceRecord(raw: string): InstanceRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const pid = (parsed as { pid?: unknown }).pid;
    const apiBase = (parsed as { apiBase?: unknown }).apiBase;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
    if (typeof apiBase !== "string" || !apiBase.startsWith("http")) return null;
    return { pid, apiBase };
  } catch {
    return null;
  }
}

/**
 * A packaged Device launched from a desktop session is often born under init
 * (ppid 1). That is not an orphaned `electron-forge` child, and it must keep
 * running. Only an unpackaged agent that *had* a real parent and then lost it
 * is the Ctrl+C leftover this module exists to stop.
 */
export function shouldQuitAsOrphan(opts: {
  packaged: boolean;
  launchParentPid: number;
  currentParentPid: number;
  launchParentAlive: boolean;
}): boolean {
  if (opts.packaged) return false;
  if (opts.launchParentPid <= 1) return false;
  if (opts.currentParentPid !== opts.launchParentPid) return true;
  return !opts.launchParentAlive;
}

export function pidIsAlive(
  pid: number,
  killFn: (pid: number, signal?: NodeJS.Signals | number) => unknown = process.kill,
): boolean {
  if (pid <= 0) return false;
  try {
    killFn(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // Exists, but this process may not signal it (pid 1, another uid).
    if (code === "EPERM") return true;
    return false;
  }
}

export function instanceAlreadyRunningMessage(opts: {
  runningApiBase: string | null;
  thisApiBase: string;
}): string {
  const running = opts.runningApiBase;
  if (running && running !== opts.thisApiBase) {
    return (
      `A DocuFlow desktop agent is already running against ${running}. ` +
      `This launch wanted ${opts.thisApiBase}. ` +
      `Two agents must not share agent-queue.json. Stop the running agent first.`
    );
  }
  if (running) {
    return (
      `A DocuFlow desktop agent is already running against ${running}. ` +
      `Stop it before launching another.`
    );
  }
  return "A DocuFlow desktop agent is already running. Stop it before launching another.";
}
