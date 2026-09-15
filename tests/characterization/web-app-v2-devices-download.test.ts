import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  composeInstallers,
  downloadAvailabilityPath,
  installerHref,
  type InstallersInput,
} from "../../client/src/v2/devices";

/**
 * Desktop-agent download on Devices (#215).
 * Seams: matchV2Route (the v1 download path rewrites here) and composeInstallers
 * over the existing `/downloads/availability` and `/downloads/{platform}` routes.
 * The HTTP behaviour of those routes stays characterized in desktop-downloads.
 * Novelty: none — the installer rows do not animate. Do not assert hex.
 */

const here = dirname(fileURLToPath(import.meta.url));

const appSource = readFileSync(join(here, "../../client/src/v2/V2AuthenticatedApp.tsx"), "utf8");

const devicesPageSource = readFileSync(join(here, "../../client/src/v2/V2Devices.tsx"), "utf8");

const css = readFileSync(join(here, "../../client/src/v2/tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function installersInput(overrides: Partial<InstallersInput> = {}): InstallersInput {
  return { availability: null, loading: false, failed: false, ...overrides };
}

describe("the v1 download path lands on Devices (#215)", () => {
  it("rewrites /time-tracking/download to the Devices destination, not a placeholder", () => {
    expect(matchV2Route("/time-tracking/download")).toMatchObject({ kind: "devices", href: "/devices" });
    expect(matchV2Route("/time-tracking/download/windows")).toMatchObject({
      kind: "devices",
      href: "/devices",
    });
    expect(navIdForPath("/time-tracking/download")).toBe("devices");
    expect(appSource).toMatch(/path="\/time-tracking\/download"/);
    expect(appSource).not.toMatch(/path="\/time-tracking\/download"[\s\S]{0,120}v2-placeholder/);
  });

  it("keeps the other v1 Time paths on their own destinations", () => {
    expect(matchV2Route("/time-tracking/dashboard")).toMatchObject({ kind: "time", tab: "stats" });
    expect(matchV2Route("/time-tracking/devices")).toMatchObject({ kind: "devices", href: "/devices" });
    expect(matchV2Route("/time-tracking/screencasts")).toMatchObject({ kind: "activity" });
  });
});

describe("installers come from the existing download routes (#215)", () => {
  it("asks the existing availability and per-platform routes", () => {
    expect(downloadAvailabilityPath()).toBe("/downloads/availability");
    expect(installerHref("windows")).toBe("/downloads/windows");
    expect(installerHref("macos")).toBe("/downloads/macos");
    expect(installerHref("linux")).toBe("/downloads/linux");
    expect(devicesPageSource).toContain("downloadAvailabilityPath");
    expect(devicesPageSource).toContain("composeInstallers");
    expect(devicesPageSource).not.toContain("/api/internal/desktop-releases");
  });

  it("keeps the authored platform copy in Switzer, not the recorded-value mono", () => {
    // Amendment 1: mono means the system recorded it. A platform requirement
    // and an install note are authored prose, so they read as prose.
    expect(devicesPageSource).toMatch(/className="df-card-sub">\{row\.requirement\}/);
    expect(devicesPageSource).not.toMatch(/df-mono[^>]*>\{row\.(requirement|note)\}/);
  });

  it("offers a platform only once the server says the file exists", () => {
    const page = composeInstallers(
      installersInput({ availability: { windows: true, macos: true, linux: false } }),
    );

    expect(page.rows.map((row) => row.platform)).toEqual(["windows", "macos", "linux"]);
    expect(page.unavailableCopy).toBeNull();

    const windows = page.rows[0];
    expect(windows.ready).toBe(true);
    expect(windows.href).toBe("/downloads/windows");
    expect(windows.action).toBe("Download .exe");
    expect(windows.note).toMatch(/SmartScreen/);

    const macos = page.rows[1];
    expect(macos.ready).toBe(true);
    expect(macos.href).toBe("/downloads/macos");
    expect(macos.action).toBe("Download .dmg");

    const linux = page.rows[2];
    expect(linux.ready).toBe(false);
    expect(linux.href).toBeNull();
    expect(linux.note).toBeNull();
    expect(linux.action).toBe("Not published yet");
  });

  it("keeps a published platform offered when a later availability check fails", () => {
    const refetchFailed = composeInstallers(
      installersInput({
        availability: { windows: true, macos: false, linux: false },
        failed: true,
      }),
    );

    expect(refetchFailed.rows[0].ready).toBe(true);
    expect(refetchFailed.rows[0].href).toBe("/downloads/windows");
    expect(refetchFailed.rows[1].action).toBe("Not published yet");
    expect(refetchFailed.unavailableCopy).toBeNull();
  });

  it("never reads as ready while availability is still loading", () => {
    const page = composeInstallers(installersInput({ loading: true }));

    for (const row of page.rows) {
      expect(row.ready).toBe(false);
      expect(row.href).toBeNull();
      expect(row.action).not.toMatch(/download/i);
    }
    expect(page.unavailableCopy).not.toBeNull();
    expect(page.unavailableCopy?.toLowerCase()).toContain("checking");
  });

  it("is honest when nothing is published and when the check fails", () => {
    const nothing = composeInstallers(
      installersInput({ availability: { windows: false, macos: false, linux: false } }),
    );
    expect(nothing.unavailableCopy?.toLowerCase()).toContain("not published");
    for (const row of nothing.rows) {
      expect(row.action.toLowerCase()).toContain("not published");
      expect(row.action.toLowerCase()).not.toContain("coming soon");
    }

    const failed = composeInstallers(installersInput({ failed: true }));
    for (const row of failed.rows) {
      expect(row.ready).toBe(false);
      expect(row.href).toBeNull();
    }
    expect(failed.unavailableCopy?.toLowerCase()).toContain("could not");
  });

  it("names each platform and what it needs without redesigning the agent", () => {
    const page = composeInstallers(
      installersInput({ availability: { windows: true, macos: true, linux: true } }),
    );
    expect(page.rows.map((row) => row.label)).toEqual(["Windows", "macOS", "Linux"]);
    expect(page.rows.map((row) => row.action)).toEqual([
      "Download .exe",
      "Download .dmg",
      "Download .deb",
    ]);
    for (const row of page.rows) {
      expect(row.requirement.length).toBeGreaterThan(0);
      expect(row.href).toBe(`/downloads/${row.platform}`);
    }
    expect(page.heading.toLowerCase()).toContain("install");
    expect(page.blurb.toLowerCase()).toContain("pair");
  });
});

describe("the installer rows do not animate (#215)", () => {
  it("keeps the ready state off motion — no spinner, no bounce", () => {
    expect(rule(".df-installer-row")).toMatch(/animation:\s*none/);
    expect(rule(".df-installer-row")).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule(".df-installer-row")).not.toMatch(/scale\(/);
    expect(rule(".df-installer-state")).toMatch(/animation:\s*none/);
    expect(devicesPageSource).not.toMatch(/data-motion=\{[^}]*installer/i);
  });
});

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}
