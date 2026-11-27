/**
 * Desktop agent protocol (#128, ADR-0011). Handshake fields are additive;
 * `/api/agent/*` URLs stay. Below-minimum agents may still upload queued Timer
 * Commands, evidence batches, and screenshot finalize.
 *
 * v2 (#400, ADR-0031) is the agent that runs beside several Timers. Until the
 * launch of Simultaneous Timers the minimum stays 1, and an agent that declares
 * nothing counts as 1, as agents before 0.2.8 spoke it. From the launch the
 * minimum is 2: v1 agents, declared or not, may no longer start a Timer, while
 * their pause, resume, stop and queued evidence still pass.
 */

import type { Request, Response } from "express";
import { TRACKING_POLICY_VERSION } from "./modules/activity";
import { simultaneousTimersLaunched } from "./simultaneousTimersLaunch";

export const AGENT_PROTOCOL_VERSION = 2;
/** The minimum from the launch of Simultaneous Timers. */
export const LAUNCH_MIN_AGENT_PROTOCOL_VERSION = 2;
/** The minimum before it. */
export const PRE_LAUNCH_MIN_AGENT_PROTOCOL_VERSION = 1;
/** What an agent that declares nothing is taken for. */
export const UNDECLARED_AGENT_PROTOCOL_VERSION = 1;
export const AGENT_PROTOCOL_VERSION_HEADER = "x-agent-protocol-version";

export function minAgentProtocolVersion(now: Date = new Date()): number {
  return simultaneousTimersLaunched(now) ? LAUNCH_MIN_AGENT_PROTOCOL_VERSION : PRE_LAUNCH_MIN_AGENT_PROTOCOL_VERSION;
}

export function agentProtocolHandshake(now: Date = new Date()) {
  return {
    clockAnchor: now.toISOString(),
    trackingPolicyVersion: TRACKING_POLICY_VERSION,
    minProtocolVersion: minAgentProtocolVersion(now),
    directives: [] as const,
  };
}

function parseDeclaredProtocolVersion(req: Request): number | "missing" | "invalid" {
  const raw = req.headers[AGENT_PROTOCOL_VERSION_HEADER];
  if (raw === undefined) return "missing";
  const value = (Array.isArray(raw) ? raw[0] : raw).trim();
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) return "invalid";
  return parsed;
}

/** The version the request declares; null when it declares nothing or something unreadable. */
export function declaredAgentProtocolVersion(req: Request): number | null {
  const parsed = parseDeclaredProtocolVersion(req);
  return typeof parsed === "number" ? parsed : null;
}

export function isAgentDrainPath(method: string, path: string, now: Date = new Date()): boolean {
  const verb = method.toUpperCase();
  if (verb === "POST" && path === "/api/agent/events/batch") return true;
  // Queued screenshot sync is presign → upload → confirm (desktop SyncWorker).
  if (verb === "POST" && path === "/api/agent/screenshots/presign") return true;
  if (verb === "POST" && path === "/api/agent/screenshots/confirm") return true;
  if (verb === "PUT" && path.startsWith("/api/agent/screenshots/upload/")) return true;
  // A v1 agent cannot run beside several Timers: from the launch it may not start one (ADR-0031).
  if (verb === "POST" && path === "/api/agent/timer/start") return !simultaneousTimersLaunched(now);
  return verb === "POST" && /^\/api\/agent\/timer\/[^/]+\/(pause|resume|stop)$/.test(path);
}

/** Returns false after writing the refusal; true means the request may continue. */
export function allowAgentProtocol(req: Request, res: Response): boolean {
  const parsed = parseDeclaredProtocolVersion(req);
  if (parsed === "invalid") {
    res.status(400).json({ message: "Invalid request" });
    return false;
  }
  const now = new Date();
  const minimum = minAgentProtocolVersion(now);
  const version = parsed === "missing" ? UNDECLARED_AGENT_PROTOCOL_VERSION : parsed;
  if (version >= minimum) return true;
  if (isAgentDrainPath(req.method, req.path, now)) return true;
  res.status(403).json({
    code: "protocol_below_minimum",
    message: "Agent protocol is below the minimum supported version",
    minProtocolVersion: minimum,
  });
  return false;
}
