import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  agentDevicesPath,
  composeDevices,
  devicesWriteRefusal,
  pairingStartPath,
  revokeMachinePath,
  type DevicesInput,
} from "../../client/src/v2/devices";
import {
  composeHelp,
  helpArticleHref,
  helpHubPath,
} from "../../client/src/v2/help";

/**
 * Devices pairing and Help Center (#194).
 * Seams: matchV2Route (flagged app chrome) and compose helpers over existing
 * agent routes / Help Center content. HTTP `/api/*` and agent pairing stay
 * characterized elsewhere. Do not assert hex.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const devicesPageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Devices.tsx"),
  "utf8",
);

const helpPageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Help.tsx"),
  "utf8",
);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const NOW = new Date("2026-09-11T12:00:00.000Z");

function emptyDevices(overrides: Partial<DevicesInput> = {}): DevicesInput {
  return {
    now: NOW,
    workspaceName: "Harbor Co",
    condition: null,
    pairing: { pending: false, code: null, expiresAt: null },
    devices: [],
    ...overrides,
  };
}

describe("Devices and Help Center routing (#194)", () => {
  it("shows a live Devices destination on /devices, not a placeholder", () => {
    const match = matchV2Route("/devices");
    expect(match.kind).toBe("devices");
    expect(navIdForPath("/devices")).toBe("devices");
    expect(breadcrumbFor("/devices", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "DEVICES",
    ]);
    expect(appSource).toContain("V2DevicesPage");
    expect(appSource).toMatch(/path="\/devices"/);
    expect(appSource).not.toMatch(/path="\/time-tracking\/devices"[\s\S]{0,80}v2-placeholder/);
  });

  it("rewrites v1 /time-tracking/devices here", () => {
    expect(matchV2Route("/time-tracking/devices")).toMatchObject({ kind: "devices", href: "/devices" });
    expect(matchV2Route("/time-tracking/devices/pair")).toMatchObject({ kind: "devices", href: "/devices" });
    expect(appSource).toMatch(/path="\/time-tracking\/devices"/);
  });

  it("shows a live Help Center destination on /help, not a placeholder", () => {
    const match = matchV2Route("/help");
    expect(match.kind).toBe("help");
    expect(navIdForPath("/help")).toBe("help");
    expect(breadcrumbFor("/help", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "HELP CENTER",
    ]);
    expect(appSource).toContain("V2HelpPage");
    expect(appSource).toMatch(/path="\/help"/);
  });

  it("shows Help Center articles under v2 chrome for /help/:slug and /help-center/:slug", () => {
    expect(matchV2Route("/help/getting-started")).toMatchObject({
      kind: "help",
      href: "/help",
      slug: "getting-started",
    });
    expect(matchV2Route("/help-center")).toMatchObject({ kind: "help", href: "/help" });
    expect(matchV2Route("/help-center/getting-started")).toMatchObject({
      kind: "help",
      href: "/help",
      slug: "getting-started",
    });
    expect(navIdForPath("/help-center/desktop-app")).toBe("help");
    expect(breadcrumbFor("/help/getting-started", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "HELP CENTER",
      "GETTING STARTED",
    ]);
    expect(appSource).toMatch(/path="\/help-center\/:slug"/);
    expect(appSource).toMatch(/path="\/help\/:slug"/);
  });
});

describe("Devices from existing agent routes (#194)", () => {
  it("empty list uses empty geometry and never shows sample names", () => {
    const page = composeDevices(emptyDevices());
    const blob = JSON.stringify(page);

    expect(page.empty).toBe(true);
    expect(page.rows).toEqual([]);
    expect(page.emptyCopy.toLowerCase()).toContain("device");
    expect(page.pagePrimary).toBe("case-ink");
    expect(page.pairing.appear).toBe(false);
    expect(page.pairing.pending).toBe(false);
    expect(page.pairAllowed).toBe(true);
    expect(page.revokeAllowed).toBe(true);
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("lists the signed-in User's enrolled Devices with status and last seen", () => {
    const page = composeDevices(
      emptyDevices({
        devices: [
          {
            id: "dev-office",
            name: "Office Mac",
            os: "macOS",
            clientVersion: "1.4.0",
            lastSeenAt: "2026-09-11T11:58:00.000Z",
            revokedAt: null,
          },
          {
            id: "dev-old",
            name: "Office Mac",
            os: "macOS",
            clientVersion: "1.2.0",
            lastSeenAt: "2026-09-01T00:00:00.000Z",
            revokedAt: "2026-09-02T00:00:00.000Z",
          },
          {
            id: "dev-linux",
            name: "Lab Linux",
            os: "Linux",
            clientVersion: null,
            lastSeenAt: null,
            revokedAt: null,
          },
          {
            id: "dev-gone",
            name: "Retired",
            os: "Windows",
            clientVersion: "1.0.0",
            lastSeenAt: "2026-08-01T00:00:00.000Z",
            revokedAt: "2026-08-02T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(page.empty).toBe(false);
    expect(page.rows).toEqual([
      {
        key: "Office Mac||macOS",
        name: "Office Mac",
        os: "macOS",
        version: "v1.4.0",
        lastSeen: "2m ago",
        status: "ONLINE",
        revoke: true,
      },
      {
        key: "Lab Linux||Linux",
        name: "Lab Linux",
        os: "Linux",
        version: null,
        lastSeen: "Never",
        status: "NEVER SEEN",
        revoke: true,
      },
    ]);
    expect(JSON.stringify(page.rows)).not.toContain("Retired");
  });

  it("shows the pairing code when it appears and refuses writes in a Read-only Workspace", () => {
    const pairing = composeDevices(
      emptyDevices({
        pairing: {
          pending: false,
          code: "AB3K7Q",
          expiresAt: "2026-09-11T12:10:00.000Z",
        },
      }),
    );
    expect(pairing.pairing).toEqual({
      pending: false,
      appear: true,
      code: "AB3K7Q",
      expiresAt: "2026-09-11T12:10:00.000Z",
    });

    const generating = composeDevices(
      emptyDevices({
        pairing: { pending: true, code: null, expiresAt: null },
      }),
    );
    expect(generating.pairing.pending).toBe(true);
    expect(generating.pairing.appear).toBe(false);
    expect(generating.pairing.code).toBeNull();

    const readOnly = composeDevices(emptyDevices({ condition: "Read-only" }));
    expect(readOnly.pairAllowed).toBe(false);
    expect(readOnly.revokeAllowed).toBe(false);
    expect(readOnly.writeRefusal).toBe(
      "Harbor Co is read-only. Viewing, export, and recovery stay available.",
    );
    expect(
      devicesWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        errorMessage: "Workspace is read-only",
      }),
    ).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");
    expect(devicesWriteRefusal({ kind: "error", workspaceName: "Harbor Co", errorMessage: "Access denied" })).not.toMatch(
      /permission denied/i,
    );
  });

  it("asks existing agent pairing and revoke routes and does not invent a protocol", () => {
    expect(agentDevicesPath()).toBe("/api/agent/devices");
    expect(pairingStartPath()).toBe("/api/agent/pairing/start");
    expect(revokeMachinePath()).toBe("/api/agent/devices/revoke-machine");
    expect(devicesPageSource).toContain("agentDevicesPath");
    expect(devicesPageSource).toContain("pairingStartPath");
    expect(devicesPageSource).toContain("revokeMachinePath");
    expect(devicesPageSource).toContain("df-project-mobile");
    expect(devicesPageSource).not.toMatch(/websocket|new protocol/i);
    expect(devicesPageSource).not.toMatch(/\/downloads/);
  });
});

describe("Help Center from existing articles (#194)", () => {
  it("lists Help Center topics on the hub and filters without inventing articles", () => {
    const hub = composeHelp({ path: "/help", query: "" });
    expect(hub.kind).toBe("hub");
    if (hub.kind !== "hub") return;
    expect(hub.topics.map((topic) => topic.slug)).toEqual([
      "getting-started",
      "time-tracking",
      "crm-projects-tasks",
      "desktop-app",
      "devices-entries-screencasts",
      "administration",
      "faq-troubleshooting",
      "release-notes",
    ]);
    expect(hub.topics[0]).toEqual({
      slug: "getting-started",
      title: "Getting Started",
      subtitle: "Account, sign-in, navigation, and main areas of DocuFlow.",
      href: "/help/getting-started",
    });
    expect(helpArticleHref("desktop-app")).toBe("/help/desktop-app");
    expect(helpHubPath()).toBe("/help");

    const filtered = composeHelp({ path: "/help", query: "desktop app" });
    expect(filtered.kind).toBe("hub");
    if (filtered.kind !== "hub") return;
    expect(filtered.topics.map((topic) => topic.slug)).toEqual(["desktop-app"]);
    expect(JSON.stringify(filtered)).not.toContain("Keystone");
  });

  it("opens a live article for a known slug and an honest miss for an unknown one", () => {
    expect(composeHelp({ path: "/help-center/getting-started", query: "" }).kind).toBe("article");

    const article = composeHelp({ path: "/help/getting-started", query: "" });
    expect(article.kind).toBe("article");
    if (article.kind !== "article") return;
    expect(article.slug).toBe("getting-started");
    expect(article.title).toBe("Getting Started");
    expect(article.toc.map((item) => item.id)).toContain("section-sign-in");
    expect(article.backHref).toBe("/help");

    const missing = composeHelp({ path: "/help/not-a-topic", query: "" });
    expect(missing.kind).toBe("missing");
    if (missing.kind !== "missing") return;
    expect(missing.emptyCopy.toLowerCase()).toContain("help");
    expect(missing.backHref).toBe("/help");
    expect(helpPageSource).toContain("HELP_ARTICLE_COMPONENTS");
    expect(helpPageSource).toContain("df-project-mobile");
  });
});

describe("Devices pairing and Help article motion (#194)", () => {
  it("lets the pairing code appear without bounce and keeps Help article on opacity", () => {
    const pairing = motionForSurface("pairing-code");
    expect(pairing.enterExit).toBe("standard");
    expect(pairing.movement).toBe("allowed");

    const pairingReduced = motionForSurface("pairing-code", { reducedMotion: true });
    expect(pairingReduced.movement).toBe("none");
    expect(pairingReduced.keepOpacity).toBe(true);

    const article = motionForSurface("help-article");
    expect(article.enterExit).toBe("standard");
    expect(article.movement).toBe("none");
    expect(article.keepOpacity).toBe(true);

    const search = motionForSurface("help-search");
    expect(search.enterExit).toBe("instant");
    expect(search.movement).toBe("none");

    expect(rule('.df-pairing-code[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-pairing-code[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule('.df-pairing-code[data-motion="standard"]')).not.toMatch(/scale\(/);
    expect(rule(".df-help-article[data-motion=\"standard\"]")).toMatch(/opacity/);
    expect(rule(".df-help-article[data-motion=\"standard\"]")).not.toMatch(/translate/);
    expect(rule(".df-help-search")).toMatch(/animation:\s*none/);
    expect(rule(".df-pairing-pending")).toMatch(/animation:\s*none/);
    expect(rule(".df-help-toc")).toMatch(/animation:\s*none/);
    expect(reducedMotionCss()).toMatch(
      /\.df-pairing-code\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
    );
  });
});

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function reducedMotionCss(): string {
  return [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n");
}
