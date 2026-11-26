import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeDevices, osLabel, pairingExpiry, type DevicesInput } from "../../client/src/v2/devices";
import { statusTone } from "../../client/src/v2/palette";

/**
 * The Devices review (F115 to F118, screen part): the pairing code's expiry, the
 * list's words, a failed refresh and Revoke.
 */

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Devices.tsx"),
  "utf8",
);

const NOW = new Date("2026-09-11T12:00:00.000Z");

function input(overrides: Partial<DevicesInput> = {}): DevicesInput {
  return {
    now: NOW,
    workspaceName: "Harbor Co",
    condition: null,
    pairing: { pending: false, code: null, expiresAt: null },
    devices: [],
    ...overrides,
  };
}

function inMs(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

describe("the pairing code's expiry (F115)", () => {
  it("reads relative and keeps the minutes whole", () => {
    expect(pairingExpiry(inMs(10 * 60_000), NOW)).toEqual({ expired: false, label: "Expires in 10 minutes" });
    expect(pairingExpiry(inMs(10 * 60_000 - 200), NOW).label).toBe("Expires in 10 minutes");
    expect(pairingExpiry(inMs(60_000), NOW)).toEqual({ expired: false, label: "Expires in 1 minute" });
    expect(pairingExpiry(inMs(59_000), NOW)).toEqual({ expired: false, label: "Expires in less than a minute" });
    expect(pairingExpiry(inMs(1), NOW).expired).toBe(false);
  });

  it("is expired from the expiry time on", () => {
    expect(pairingExpiry(inMs(0), NOW).expired).toBe(true);
    expect(pairingExpiry(inMs(-60_000), NOW).expired).toBe(true);
  });

  it("keeps the expiry current, drops the code once expired and announces a new one", () => {
    expect(source).toContain("pairingExpiry(page.pairing.expiresAt, new Date())");
    expect(source).toMatch(/window\.setInterval\([^)]*\)[^;]*EXPIRY_TICK_MS\)/);
    expect(source).toMatch(/return \(\) => window\.clearInterval\(timer\)/);
    expect(source).toMatch(/EXPIRY_TICK_MS = 15_000/);
    expect(source).not.toContain("toLocaleTimeString");
    expect(source).toContain("Enter it once in the desktop agent.");
    // Expired: no code and no Copy code, New code is the primary action.
    const expired = source.slice(source.indexOf("expiry?.expired ? ("), source.indexOf(") : page.pairing.appear && page.pairing.code ? ("));
    expect(expired).toContain("This code has expired.");
    expect(expired).not.toContain("df-pairing-code");
    expect(expired).not.toContain("Copy code");
    expect(expired).toMatch(/<Button variant="default"[^>]*onClick=\{onPair\}[\s\S]*?New code/);
    expect(source).toMatch(/<p className="df-sr-only" role="status">\s*\{codeShown \? "Pairing code ready" : ""\}/);
  });

  it("draws a failed generation with the shared failed state and Try again", () => {
    expect(source).not.toContain("Could not generate a code");
    expect(source).toMatch(/<V2LoadFailed\s+title="A pairing code could not be generated"[\s\S]*?onRetry=\{onPair\}/);
  });
});

describe("the list's words (F116)", () => {
  it("names the OS the agent sends", () => {
    expect(osLabel("win32")).toBe("Windows");
    expect(osLabel("darwin")).toBe("macOS");
    expect(osLabel("linux")).toBe("Linux");
    expect(osLabel("freebsd")).toBe("freebsd");
    expect(osLabel(null)).toBe("-");
    expect(osLabel("")).toBe("-");
  });

  it("writes statuses in sentence case and keeps their tones", () => {
    const page = composeDevices(
      input({
        devices: [
          { id: "a", name: "Desk", os: "win32", clientVersion: "1.0.0", lastSeenAt: "2026-09-11T11:59:00.000Z", revokedAt: null },
          { id: "b", name: "Laptop", os: "darwin", clientVersion: null, lastSeenAt: "2026-09-11T10:00:00.000Z", revokedAt: null },
          { id: "c", name: "Lab", os: "linux", clientVersion: null, lastSeenAt: null, revokedAt: null },
        ],
      }),
    );
    expect(page.rows.map((row) => [row.name, row.os, row.osLabel, row.status])).toEqual([
      ["Desk", "win32", "Windows", "Online"],
      ["Laptop", "darwin", "macOS", "Offline"],
      ["Lab", "linux", "Linux", "Never seen"],
    ]);
    expect(statusTone("Online")).toBe("positive");
    expect(statusTone("Offline")).toBe("neutral");
    expect(statusTone("Never seen")).toBe("neutral");
    expect(source).toContain("{row.osLabel}");
    expect(source).not.toContain('row.os ?? "-"');
  });
});

describe("a failed refresh (F117)", () => {
  it("keeps the list in hand and says once that it could not be refreshed", () => {
    expect(source).toContain(
      'useRefreshFailure(isError && data !== undefined, "Your Devices could not be refreshed.", "v2-devices-refresh-failed")',
    );
    expect(source).toMatch(/\{isError && data === undefined \? \(\s*<V2LoadFailed/);
  });
});

describe("Revoke (F118, screen part)", () => {
  it("allows Revoke in a Read-only Workspace and still refuses pairing", () => {
    const page = composeDevices(input({ condition: "Read-only" }));
    expect(page.revokeAllowed).toBe(true);
    expect(page.pairAllowed).toBe(false);
    expect(page.writeRefusal).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");
    expect(composeDevices(input()).revokeAllowed).toBe(true);
  });

  it("confirms through the shared DestructiveConfirm, saying what ends and what is lost", () => {
    expect(source).toContain('import { DestructiveConfirm } from "./V2DestructiveConfirm"');
    expect(source).not.toMatch(/AlertDialog/);
    expect(source).toContain(
      "consequence={`${row.name} stops recording time and is signed out of DocuFlow in every Workspace. Captures it has not sent yet are lost; to use it again, pair it with a new code.`}",
    );
    expect(source).toContain("testId={`v2-devices-revoke-${row.key}`}");
  });

  it("moves focus to the next row's Revoke, else the previous one's, else Pair a device", () => {
    expect(source).toMatch(/const next = rows\[index \+ 1\] \?\? rows\[index - 1\]/);
    expect(source).toContain("pendingFocus.current = { removed: row.key, next: row.focusNext }");
    expect(source).toMatch(/v2-devices-revoke-\$\{target\.next\}/);
    expect(source).toContain(`'[data-testid="v2-devices-pair"]'`);
  });

  it("shows no em or en dash", () => {
    expect(source).not.toMatch(/[–—]/);
  });
});
