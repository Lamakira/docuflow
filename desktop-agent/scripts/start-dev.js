#!/usr/bin/env node
/**
 * Run `electron-forge start` so Ctrl+C takes Electron down with it (#237).
 *
 * Forge is the process the terminal talks to. Interrupt killed that parent and
 * returned the prompt; the Electron main process was left running — workers,
 * heartbeats, the same API_BASE it booted against. This wrapper is the
 * foreground process. On SIGINT/SIGTERM/SIGHUP it kills forge and every
 * descendant, then SIGKILLs anything still standing, including the local
 * `node_modules/electron` binary if a child was reparented to init.
 */
"use strict";

const { spawn, execFileSync } = require("child_process");
const path = require("path");

const AGENT_ROOT = path.resolve(__dirname, "..");
const ELECTRON_BIN = path.join(AGENT_ROOT, "node_modules", "electron", "dist", "electron");

const STOP_HINT = [
  "[dev] Ctrl+C stops the agent, including Electron.",
  "[dev] If the prompt returns and the agent is still alive:",
  '[dev]   pkill -KILL -f "desktop-agent/node_modules/electron"',
].join("\n");

function childPids(pid) {
  if (process.platform === "win32") {
    try {
      const out = execFileSync(
        "wmic",
        ["process", "where", `ParentProcessId=${pid}`, "get", "ProcessId"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
      return out
        .split(/\s+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n > 0);
    } catch {
      return [];
    }
  }
  try {
    const out = execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out
      .trim()
      .split("\n")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function collectTree(pid) {
  const pids = [pid];
  for (const child of childPids(pid)) {
    pids.push(...collectTree(child));
  }
  return [...new Set(pids)];
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone */
  }
}

function killProcessGroup(pid, signal) {
  if (process.platform === "win32") return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* group already gone, or pid is not a group leader */
  }
}

function killLocalElectron(signal) {
  try {
    execFileSync(
      "pkill",
      [signal === "SIGKILL" ? "-KILL" : "-TERM", "-f", escapeRegex(ELECTRON_BIN)],
      { stdio: "pipe" },
    );
  } catch {
    /* none running */
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function killTree(rootPid, signal) {
  if (process.platform === "win32") {
    const args = ["/T", "/PID", String(rootPid)];
    if (signal === "SIGKILL") args.unshift("/F");
    try {
      execFileSync("taskkill", args, { stdio: "pipe" });
    } catch {
      /* already gone */
    }
    return;
  }
  killProcessGroup(rootPid, signal);
  for (const pid of collectTree(rootPid)) signalPid(pid, signal);
  killLocalElectron(signal);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

console.log(STOP_HINT);

const forgeBin =
  process.platform === "win32"
    ? path.join(AGENT_ROOT, "node_modules", ".bin", "electron-forge.cmd")
    : path.join(AGENT_ROOT, "node_modules", ".bin", "electron-forge");

const forge = spawn(forgeBin, ["start"], {
  cwd: AGENT_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    // Electron may already be reparented to init by the time it boots, so it
    // cannot watch process.ppid. It watches this pid instead (#237).
    DOCUFLOW_DEV_PARENT_PID: String(process.pid),
  },
  // Own process group so Ctrl+C (which hits this wrapper) can kill(-pid).
  detached: process.platform !== "win32",
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const pid = forge.pid;
  console.log(`\n[dev] ${signal} — stopping Electron and electron-forge`);
  if (!pid) {
    process.exit(0);
    return;
  }
  killTree(pid, "SIGTERM");
  const deadline = Date.now() + 3000;
  const timer = setInterval(() => {
    if (!pidAlive(pid) && !localElectronAlive()) {
      clearInterval(timer);
      process.exit(0);
      return;
    }
    if (Date.now() >= deadline) {
      clearInterval(timer);
      console.log("[dev] still alive after SIGTERM — SIGKILL");
      killTree(pid, "SIGKILL");
      process.exit(0);
    }
  }, 200);
}

function localElectronAlive() {
  if (process.platform === "win32") return false;
  try {
    execFileSync("pgrep", ["-f", escapeRegex(ELECTRON_BIN)], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));

forge.on("error", (err) => {
  console.error("[dev] failed to start electron-forge:", err.message);
  process.exit(1);
});

forge.on("exit", (code, signal) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log("[dev] electron-forge exited — ensuring Electron is gone");
  killLocalElectron("SIGTERM");
  setTimeout(() => {
    if (localElectronAlive()) killLocalElectron("SIGKILL");
    process.exit(code ?? (signal ? 1 : 0));
  }, 500);
});
