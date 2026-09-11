/**
 * Devices destination (#194).
 * Novelty: the pairing code appears (rare explanation / state).
 * Do not animate: the pairing spinner as decoration.
 */

import { chromeRefusal } from "./chrome";

export type DeviceInput = {
  id: string;
  name: string;
  os: string | null;
  clientVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type PairingInput = {
  pending: boolean;
  code: string | null;
  expiresAt: string | null;
};

export type DevicesInput = {
  now: Date;
  workspaceName: string;
  condition: "Trial" | "Read-only" | "Past due" | null;
  pairing: PairingInput;
  devices: DeviceInput[];
};

export type DeviceRow = {
  key: string;
  name: string;
  os: string | null;
  version: string | null;
  lastSeen: string;
  status: "ONLINE" | "OFFLINE" | "NEVER SEEN";
  revoke: boolean;
};

export type PairingModel = {
  pending: boolean;
  appear: boolean;
  code: string | null;
  expiresAt: string | null;
};

export type DevicesModel = {
  subhead: string;
  empty: boolean;
  emptyCopy: string;
  rows: DeviceRow[];
  pairing: PairingModel;
  pairAllowed: boolean;
  revokeAllowed: boolean;
  writeRefusal: string | null;
  pagePrimary: "case-ink";
};

export function agentDevicesPath(): string {
  return "/api/agent/devices";
}

export function pairingStartPath(): string {
  return "/api/agent/pairing/start";
}

export function revokeMachinePath(): string {
  return "/api/agent/devices/revoke-machine";
}

function formatRelativeTime(dateStr: string | null, now: Date): string {
  if (!dateStr) return "Never";
  const minutes = Math.floor((now.getTime() - new Date(dateStr).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusFor(device: DeviceInput, now: Date): DeviceRow["status"] {
  if (!device.lastSeenAt) return "NEVER SEEN";
  const minutesSinceSeen = (now.getTime() - new Date(device.lastSeenAt).getTime()) / 60000;
  if (minutesSinceSeen < 5) return "ONLINE";
  return "OFFLINE";
}

function timestamp(device: DeviceInput): number {
  return device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
}

function groupByMachine(raw: DeviceInput[], now: Date): DeviceRow[] {
  const map = new Map<string, DeviceInput[]>();
  for (const device of raw) {
    const key = `${device.name}||${device.os ?? ""}`;
    const group = map.get(key);
    if (group) group.push(device);
    else map.set(key, [device]);
  }

  const rows: Array<{ row: DeviceRow; lastSeenAt: number }> = [];
  for (const [key, group] of map) {
    const active = group.filter((device) => !device.revokedAt);
    if (active.length === 0) continue;
    const representative = active.reduce((best, device) => (timestamp(device) > timestamp(best) ? device : best));
    rows.push({
      lastSeenAt: timestamp(representative),
      row: {
        key,
        name: representative.name,
        os: representative.os,
        version: representative.clientVersion ? `v${representative.clientVersion}` : null,
        lastSeen: formatRelativeTime(representative.lastSeenAt, now),
        status: statusFor(representative, now),
        revoke: true,
      },
    });
  }

  return rows.sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((entry) => entry.row);
}

export function composeDevices(input: DevicesInput): DevicesModel {
  const readOnly = input.condition === "Read-only";
  const rows = groupByMachine(input.devices, input.now);
  const empty = rows.length === 0;
  return {
    subhead: `Enrolled Devices for you in ${input.workspaceName}.`,
    empty,
    emptyCopy: empty ? "No enrolled Devices. Pair the desktop agent with a code from this page." : "",
    rows,
    pairing: {
      pending: input.pairing.pending,
      appear: Boolean(input.pairing.code),
      code: input.pairing.code,
      expiresAt: input.pairing.expiresAt,
    },
    pairAllowed: !readOnly,
    revokeAllowed: !readOnly,
    writeRefusal: readOnly
      ? chromeRefusal({
          kind: "workspace-condition",
          workspaceName: input.workspaceName,
          condition: "Read-only",
        })
      : null,
    pagePrimary: "case-ink",
  };
}

export type DevicesWriteRefusal =
  | { kind: "workspace-condition"; workspaceName: string; condition: "Read-only" | "Trial" | "Past due" }
  | { kind: "error"; workspaceName: string; errorMessage: string };

export function devicesWriteRefusal(input: DevicesWriteRefusal): string {
  if (input.kind === "workspace-condition") {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: input.condition,
    });
  }
  const message = input.errorMessage;
  if (/read-only/i.test(message)) {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: "Read-only",
    });
  }
  return chromeRefusal({ kind: "generic", message });
}
