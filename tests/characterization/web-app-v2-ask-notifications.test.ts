import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ASK_CHAT_MODE,
  composeAccountMenu,
  composeAsk,
  composeDeliveryPreference,
  composeNotifications,
  toggleDeliveryPreference,
} from "../../client/src/v2/chrome";
import { motionForSurface } from "../../client/src/v2/motion";

/**
 * Deepen Ask, Notifications, and the account menu (#210).
 * Seams: chrome presentation helpers + motionForSurface + tokens.css.
 * HTTP `/api/*` stays characterized elsewhere. Do not assert hex or
 * millisecond curves.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const askPanelSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2ContextPanel.tsx"),
  "utf8",
);

const railSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Rail.tsx"),
  "utf8",
);

const appBarSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AppBar.tsx"),
  "utf8",
);

describe("Ask DocuFlow (#210)", () => {
  it("answers from Workspace records with inspectable sources and hides restricted Documents", () => {
    const empty = composeAsk({ messages: [] });
    expect(empty.mode).toBe("workspace-records");
    expect(empty.messages).toEqual([]);
    expect(empty.emptyCopy.toLowerCase()).toContain("workspace");
    expect(empty.emptyCopy.toLowerCase()).toContain("document access");
    for (const name of SAMPLE_NAMES) {
      expect(empty.emptyCopy).not.toContain(name);
    }

    const answered = composeAsk({
      messages: [
        { role: "user", content: "Where is leave?" },
        {
          role: "assistant",
          content: "Leave is in the policy.",
          relevantDocs: 2,
          citations: [
            { id: "doc-open", title: "Leave policy", kind: "document", access: "workspace" },
            { id: "doc-hidden", title: "Payroll bands", kind: "document", access: "restricted" },
            { id: "page-1", title: "Runbook", kind: "project-document" },
          ],
        },
      ],
    });
    const assistant = answered.messages[1];
    expect(assistant?.source?.toLowerCase()).toContain("workspace");
    expect(assistant?.sources.map((source) => source.title)).toEqual(["Leave policy", "Runbook"]);
    expect(assistant?.sources.map((source) => source.title)).not.toContain("Payroll bands");
    expect(assistant?.sources.find((source) => source.title === "Leave policy")?.href).toBe(
      "/documents/doc-open",
    );
    expect(assistant?.sources.find((source) => source.title === "Runbook")?.href).toBe(
      "/document/page-1",
    );
    expect(JSON.stringify(assistant).toLowerCase()).not.toContain("payroll");
  });

  it("posts /api/chat as Workspace records and uses chromeRefusal, not a v1 ChatBot page", () => {
    expect(ASK_CHAT_MODE).toBe("both");
    expect(askPanelSource).toContain('"/api/chat"');
    expect(askPanelSource).toContain("ASK_CHAT_MODE");
    expect(askPanelSource).toContain("chromeRefusal");
    expect(askPanelSource).toContain("citations");
    expect(askPanelSource).not.toContain("ChatBot");
    expect(askPanelSource).not.toContain("Project Documentation");
    expect(askPanelSource).not.toContain("Company Documents");
    expect(askPanelSource).not.toContain('mode: "projects"');
    expect(askPanelSource).not.toContain('mode: "company"');
    expect(appBarSource).toContain('data-testid="v2-ask"');
  });
});

describe("Notifications inbox (#210)", () => {
  it("lists origin, unread, mark-one and mark-all against existing notification routes", () => {
    const live = composeNotifications({
      now: new Date(2026, 8, 11, 12, 52, 0),
      notifications: [
        {
          id: "n1",
          type: "mention",
          message: "Sam mentioned you on Harbour Rebuild",
          isRead: 0,
          createdAt: new Date(2026, 8, 11, 12, 41, 0),
          crmProjectId: "prj-live",
          workspace: { id: "ws-a", name: "Harbour View" },
        },
        {
          id: "n2",
          type: "assignment",
          message: "You were assigned Ledger rebuild",
          isRead: 1,
          createdAt: new Date(2026, 8, 10, 9, 0, 0),
          workspace: { id: "ws-b", name: "North Pier" },
        },
      ],
    });
    expect(live.rows).toHaveLength(2);
    expect(live.unreadCount).toBe(1);
    expect(live.rows[0]).toMatchObject({
      origin: "Harbour View",
      unread: true,
      href: "/projects/prj-live",
    });
    expect(live.rows[1].origin).toBe("North Pier");
    expect(askPanelSource).toContain("/api/notifications");
    expect(askPanelSource).toContain("/api/notifications/${id}/read");
    expect(askPanelSource).toContain("/api/notifications/mark-all-read");
    expect(askPanelSource).toContain("/api/notifications/delivery-preferences");
    expect(askPanelSource).not.toContain("localStorage");
    expect(askPanelSource).toContain("v2-delivery-preference");
  });

  it("reaches Delivery Preference from this chrome, not a v1 settings dump", () => {
    const model = composeDeliveryPreference({
      workspaceName: "Harbour View",
      emailByCategory: { reminders: false },
    });
    expect(model.title.toLowerCase()).toContain("delivery preference");
    expect(model.rows.map((row) => row.id)).toEqual([
      "work-assignments",
      "reminders",
      "approvals",
      "membership",
      "billing",
      "security",
    ]);
    expect(model.rows.every((row) => row.inbox.on && row.inbox.locked)).toBe(true);
    expect(model.rows.find((row) => row.id === "reminders")?.email).toEqual({ on: false, locked: false });
    expect(model.rows.find((row) => row.id === "security")?.email).toEqual({ on: true, locked: true });
    expect(model.rows.find((row) => row.id === "billing")?.email.locked).toBe(true);
    expect(model.rows.find((row) => row.id === "membership")?.email.locked).toBe(true);
    expect(askPanelSource).not.toContain("AdminPage");
    expect(askPanelSource).not.toContain("org-settings");

    const next = toggleDeliveryPreference(
      { reminders: false },
      { category: "reminders", email: true },
    );
    expect(next.reminders).toBe(true);
    expect(toggleDeliveryPreference({ reminders: false }, { category: "security", email: false }).security).toBe(
      true,
    );
  });
});

describe("Account menu (#210)", () => {
  it("holds theme and sign out, and does not duplicate Devices or a Clerk password field", () => {
    const menu = composeAccountMenu({ theme: "system" });
    expect(menu.themeOptions.map((option) => option.id)).toEqual(["light", "system"]);
    expect(menu.themeOptions.find((option) => option.id === "system")?.selected).toBe(true);
    expect(menu.signOutLabel).toBe("Sign out");
    expect(JSON.stringify(menu).toLowerCase()).not.toContain("password");
    expect(JSON.stringify(menu).toLowerCase()).not.toContain("device");
    expect(railSource).toContain("composeAccountMenu");
    expect(railSource).toContain("v2-account-menu");
    expect(railSource).toContain("v2-sign-out");
    expect(railSource).toContain("setTheme");
    expect(railSource).not.toContain("password");
    expect(railSource).not.toMatch(/href="\/devices"/);
  });

  it("drops Dark so the menu only offers themes that exist (#249)", () => {
    const storedDark = composeAccountMenu({ theme: "dark" });
    expect(storedDark.themeOptions.map((option) => option.id)).toEqual(["light", "system"]);
    expect(storedDark.themeOptions.find((option) => option.id === "light")?.selected).toBe(true);
    expect(storedDark.structure).toEqual(["theme", "separator", "account", "signOut"]);
    expect(railSource).toContain("account.structure");
    expect(railSource).toMatch(/theme === ["']dark["']/);
  });
});

describe("Ask and Notifications motion (#210)", () => {
  it("lets a Notification enter the inbox from the same bottom edge as toasts", () => {
    const inbox = motionForSurface("notification-inbox");
    expect(inbox.enterExit).toBe("standard");
    expect(inbox.movement).toBe("allowed");
    expect(motionForSurface("toast").movement).toBe("allowed");

    const reduced = motionForSurface("notification-inbox", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-notice-row[data-enter="true"]')).toMatch(/translateY\(100%\)|translateY\(0\)/);
    expect(css).toMatch(
      /\.df-notice-row\[data-enter="true"\][^{]*\{[^}]*@starting-style|@starting-style\s*\{[^}]*\.df-notice-row\[data-enter="true"\]/,
    );
    expect(reducedMotionCss()).toMatch(
      /\.df-notice-row\[data-enter="true"\][^{]*\{[^}]*transform:\s*none/,
    );
  });

  it("does not animate search keystrokes, result filtering, Ask composer, or Delivery Preference toggles", () => {
    expect(motionForSurface("search-overlay").enterExit).toBe("instant");
    expect(motionForSurface("ask-composer").enterExit).toBe("instant");
    expect(motionForSurface("delivery-preference").enterExit).toBe("instant");
    expect(rule(".df-v2.df-command-palette")).toMatch(/transition:\s*none/);
    expect(rule(".df-search-hits")).toMatch(/transition:\s*none/);
    expect(rule(".df-ask-composer input")).toMatch(/transition:\s*none/);
    expect(rule(".df-delivery-toggle")).toMatch(/transition:\s*none/);
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
