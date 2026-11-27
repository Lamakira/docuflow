/**
 * The agent's declared protocol version and the "update required" state (#398).
 *
 * Pure: no electron import, so the gate is testable on its own.
 */

/**
 * Must equal server/agentProtocol.ts; a test pins the two together.
 * v2 (#400): the agent runs beside several Timers (ADR-0031).
 */
export const AGENT_PROTOCOL_VERSION = 2;
export const AGENT_PROTOCOL_VERSION_HEADER = "x-agent-protocol-version";
/** The server's 403 code for an agent below the minimum protocol version. */
export const PROTOCOL_BELOW_MINIMUM = "protocol_below_minimum";

/** Sent on every request to the server (#398). */
export const AGENT_PROTOCOL_HEADERS: Readonly<Record<string, string>> = {
  [AGENT_PROTOCOL_VERSION_HEADER]: String(AGENT_PROTOCOL_VERSION),
};

export type UpdateRequired = { minProtocolVersion: number | null };

/**
 * The state as saved on the Device, with the version the refused build declared.
 * The file outlives an install, so the updated build must not read it as its own.
 */
export type SavedUpdateRequired = UpdateRequired & { declaredProtocolVersion: number };

/** What ApiClient tells about the server's verdict on this agent's protocol version. */
export interface ProtocolListener {
  refused(state: UpdateRequired): void;
  accepted(): void;
}

/** The refusal carried by a 403 body, or null when the body is anything else. */
export function protocolRefusal(body: unknown): UpdateRequired | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { code?: unknown; minProtocolVersion?: unknown };
  if (b.code !== PROTOCOL_BELOW_MINIMUM) return null;
  const n = b.minProtocolVersion;
  return { minProtocolVersion: typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null };
}

export interface UpdateRequiredPorts {
  stopCapture(): void;
  startCapture(): void;
  save(state: SavedUpdateRequired | null): void;
  changed(): void;
}

/**
 * Holds the agent in "update required" after the server refuses its protocol
 * version: capture stops, the queue keeps draining (drain paths still succeed).
 *
 * A below-minimum agent's drain requests succeed, so only a NON-drain success
 * (the heartbeat) may clear it. In practice it clears when the Member installs
 * the new build and the restarted agent's heartbeat is accepted.
 */
export class UpdateRequiredGate implements ProtocolListener {
  private current: UpdateRequired | null;

  /**
   * `saved` blocks from the start only when this build declares the version
   * that was refused: the Member who installed the new build is not shown
   * "no longer supported" (offline, for as long as the server is unreachable).
   */
  constructor(
    private ports: UpdateRequiredPorts,
    saved: SavedUpdateRequired | null,
    private declared: number = AGENT_PROTOCOL_VERSION,
  ) {
    this.current = saved && saved.declaredProtocolVersion === declared
      ? { minProtocolVersion: saved.minProtocolVersion }
      : null;
  }

  private save(state: UpdateRequired | null): void {
    this.ports.save(state && { ...state, declaredProtocolVersion: this.declared });
  }

  get state(): UpdateRequired | null {
    return this.current;
  }

  get blocksCapture(): boolean {
    return this.current !== null;
  }

  /** Idempotent: the heartbeat and the worked-today tick are refused every minute. */
  refused(state: UpdateRequired): void {
    if (this.current === null) {
      this.current = state;
      this.save(state);
      this.ports.stopCapture();
      this.ports.changed();
      return;
    }
    if (this.current.minProtocolVersion !== state.minProtocolVersion) {
      this.current = state;
      this.save(state);
      this.ports.changed();
    }
  }

  accepted(): void {
    if (this.current === null) return;
    this.current = null;
    this.save(null);
    this.ports.startCapture();
    this.ports.changed();
  }

  /** Session cleared (unpair, revoke): forget the state without restarting capture. */
  reset(): void {
    this.current = null;
  }
}
