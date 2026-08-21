/**
 * Desktop agent protocol v1 (#128, ADR-0011). Handshake fields are additive;
 * `/api/agent/*` URLs stay. Minimum protocol version is 1, so current agents
 * (which declare nothing) remain at the minimum. Below-minimum agents may still
 * upload queued Timer Commands, evidence batches, and screenshot finalize.
 */

import type { Request, Response } from "express";
import { TRACKING_POLICY_VERSION } from "./modules/activity";

export const AGENT_PROTOCOL_VERSION = 1;
export const MIN_AGENT_PROTOCOL_VERSION = 1;
export const AGENT_PROTOCOL_VERSION_HEADER = "x-agent-protocol-version";

export function agentProtocolHandshake(now: Date = new Date()) {
  return {
    clockAnchor: now.toISOString(),
    trackingPolicyVersion: TRACKING_POLICY_VERSION,
    minProtocolVersion: MIN_AGENT_PROTOCOL_VERSION,
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

export function isAgentDrainPath(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "POST" && path === "/api/agent/events/batch") return true;
  // Queued screenshot sync is presign → upload → confirm (desktop SyncWorker).
  if (verb === "POST" && path === "/api/agent/screenshots/presign") return true;
  if (verb === "POST" && path === "/api/agent/screenshots/confirm") return true;
  if (verb === "PUT" && path.startsWith("/api/agent/screenshots/upload/")) return true;
  if (verb === "POST" && path === "/api/agent/timer/start") return true;
  return verb === "POST" && /^\/api\/agent\/timer\/[^/]+\/(pause|resume|stop)$/.test(path);
}

/** Returns false after writing the refusal; true means the request may continue. */
export function allowAgentProtocol(req: Request, res: Response): boolean {
  const parsed = parseDeclaredProtocolVersion(req);
  if (parsed === "invalid") {
    res.status(400).json({ message: "Invalid request" });
    return false;
  }
  const version = parsed === "missing" ? AGENT_PROTOCOL_VERSION : parsed;
  if (version >= MIN_AGENT_PROTOCOL_VERSION) return true;
  if (isAgentDrainPath(req.method, req.path)) return true;
  res.status(403).json({
    code: "protocol_below_minimum",
    message: "Agent protocol is below the minimum supported version",
    minProtocolVersion: MIN_AGENT_PROTOCOL_VERSION,
  });
  return false;
}
