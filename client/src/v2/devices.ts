/**
 * Devices destination (#194) and the desktop-agent installer it needs (#215).
 * Novelty: the pairing code appears (rare explanation / state). The installer
 * rows carry none — a platform is offered or honestly unavailable.
 * Do not animate: the pairing spinner as decoration, "Coming soon" as a
 * spinner, the download control on becoming ready.
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

/** Shared with Administration analytics (#212): one relative clock for Devices. */
export function formatRelativeTime(dateStr: string | null, now: Date): string {
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

/**
 * The installer the User needs before pairing (#215). Composed from the
 * existing `/downloads/availability` and `/downloads/{platform}` routes — the
 * desktop agent itself is not redesigned here. A platform reads ready only
 * once the server has said the file exists, so nothing flashes ready first.
 */

export type InstallerPlatform = "windows" | "macos" | "linux";

export type InstallerAvailability = Record<InstallerPlatform, boolean>;

export type InstallersInput = {
  availability: InstallerAvailability | null;
  loading: boolean;
  failed: boolean;
};

export type InstallerRow = {
  platform: InstallerPlatform;
  label: string;
  requirement: string;
  ready: boolean;
  href: string | null;
  action: string;
  note: string | null;
};

export type InstallersModel = {
  heading: string;
  blurb: string;
  rows: InstallerRow[];
  unavailableCopy: string | null;
};

type InstallerPlatformCopy = {
  platform: InstallerPlatform;
  label: string;
  requirement: string;
  artifact: string;
  note: string;
};

const INSTALLER_PLATFORMS: InstallerPlatformCopy[] = [
  {
    platform: "windows",
    label: "Windows",
    requirement: "Windows 10 / 11 (x64)",
    artifact: ".exe",
    note: "SmartScreen may prompt — choose More info, then Run anyway.",
  },
  {
    platform: "macos",
    label: "macOS",
    requirement: "macOS 12+ (Apple Silicon / Intel)",
    artifact: ".dmg",
    note: "First launch: right-click the app and choose Open (unsigned build).",
  },
  {
    platform: "linux",
    label: "Linux",
    requirement: "Ubuntu 20.04+ (x64)",
    artifact: ".deb",
    note: "Install with sudo dpkg -i DocuFlow-Agent-*.deb.",
  },
];

/** What the availability check has told us so far. Ready is the server's word. */
type InstallerState = "ready" | "checking" | "uncheckable" | "unpublished";

export function downloadAvailabilityPath(): string {
  return "/downloads/availability";
}

export function installerHref(platform: InstallerPlatform): string {
  return `/downloads/${platform}`;
}

function stateFor(input: InstallersInput, platform: InstallerPlatform): InstallerState {
  // An answer already given outlives a later failed re-check: a Download that
  // works must not read Unavailable because a background refresh dropped.
  if (input.availability) return input.availability[platform] === true ? "ready" : "unpublished";
  if (input.loading) return "checking";
  if (input.failed) return "uncheckable";
  return "unpublished";
}

export function composeInstallers(input: InstallersInput): InstallersModel {
  const rows = INSTALLER_PLATFORMS.map<InstallerRow>((copy) => {
    const state = stateFor(input, copy.platform);
    const ready = state === "ready";
    return {
      platform: copy.platform,
      label: copy.label,
      requirement: copy.requirement,
      ready,
      href: ready ? installerHref(copy.platform) : null,
      action: ROW_ACTION[state](copy.artifact),
      note: ready ? copy.note : null,
    };
  });

  return {
    heading: "Install the desktop agent",
    blurb: "Install the agent, then pair it with a code from this page.",
    rows,
    unavailableCopy: rows.some((row) => row.ready) ? null : SECTION_COPY[stateFor(input, "windows")],
  };
}

const ROW_ACTION: Record<InstallerState, (artifact: string) => string> = {
  ready: (artifact) => `Download ${artifact}`,
  checking: () => "Checking\u2026",
  uncheckable: () => "Unavailable",
  unpublished: () => "Not published yet",
};

/** Read only when no platform is ready, so the ready case never speaks here. */
const SECTION_COPY: Record<InstallerState, string> = {
  ready: "",
  checking: "Checking which installers are published\u2026",
  uncheckable: "Installer availability could not be checked. Try again shortly.",
  unpublished: "Not published yet for any platform. This page offers an installer as soon as one is.",
};
