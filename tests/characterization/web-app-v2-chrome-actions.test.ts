import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chromeRefusal,
  composeAsk,
  composeNotifications,
  composeRefusalPlacement,
  composeSearch,
  selectCommandPanel,
  timerChipCommands,
  toastModel,
} from "../../client/src/v2/chrome";
import { motionForSurface } from "../../client/src/v2/motion";
import { timerChipModel } from "../../client/src/v2/presentation";
import { EMPTY_TIMESHEET_APPROVALS } from "../../client/src/v2/today";

/**
 * v2 chrome actions: search, Timer, Ask, Notifications, toasts (#184).
 * Seam: chrome presentation helpers + motionForSurface + tokens.css.
 * HTTP `/api/*` stays characterized elsewhere. Do not assert cubic-beziers,
 * millisecond durations, or hex.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("v2 chrome actions (#184)", () => {
  it("opens search with / instantly and does not animate keystrokes or result filtering", () => {
    const search = motionForSurface("search-overlay");
    expect(search.enterExit).toBe("instant");
    expect(search.movement).toBe("none");
    expect(rule(".df-v2.df-command-palette")).toMatch(/transition:\s*none/);
    expect(rule(".df-v2.df-command-palette")).toMatch(/animation:\s*none/);
    expect(rule(".df-search-hits")).toMatch(/transition:\s*none/);
    expect(rule(".df-search-hits")).toMatch(/animation:\s*none/);
  });

  it("returns Active Workspace search hits and hides restricted Documents without inventing a restricted count", () => {
    const model = composeSearch({
      query: "ledger",
      searchHits: [
        { type: "project", id: "prj-1", title: "Harbour Rebuild" },
        { type: "document", id: "doc-legacy", title: "Runbook", projectName: "Harbour Rebuild" },
      ],
      workspaceDocuments: [
        { id: "doc-open", name: "Leave policy", access: "workspace", folderName: "Policies" },
        { id: "doc-hidden", name: "Payroll bands", access: "restricted", folderName: "Policies" },
      ],
      folders: [{ id: "fld-1", name: "Ledger folder" }],
    });

    const titles = model.rows.map((row) => row.title);
    expect(titles).toContain("Harbour Rebuild");
    expect(titles).toContain("Runbook");
    expect(titles).toContain("Leave policy");
    expect(titles).toContain("Ledger folder");
    expect(titles).not.toContain("Payroll bands");
    expect(model.footer).toBeNull();
    expect(JSON.stringify(model).toLowerCase()).not.toContain("restricted items hidden");
    expect(model.rows.find((row) => row.title === "Leave policy")?.href).toBe("/documents/doc-open");
    expect(model.rows.find((row) => row.title === "Harbour Rebuild")?.href).toBe("/projects/prj-1");
  });

  it("states access filtering only when the BFF provides that fact", () => {
    const silent = composeSearch({
      query: "policy",
      searchHits: [],
      workspaceDocuments: [{ id: "doc-open", name: "Leave policy", access: "workspace" }],
      folders: [],
    });
    expect(silent.footer).toBeNull();

    const withFact = composeSearch({
      query: "policy",
      searchHits: [],
      workspaceDocuments: [{ id: "doc-open", name: "Leave policy", access: "workspace" }],
      folders: [],
      accessFact: { filteredByAccess: true },
    });
    expect(withFact.footer).toBe("RESULTS FILTERED BY YOUR ACCESS");
    expect(withFact.footer).not.toMatch(/\d/);

    const withCount = composeSearch({
      query: "policy",
      searchHits: [],
      workspaceDocuments: [],
      folders: [],
      accessFact: { filteredByAccess: true, restrictedHidden: 3 },
    });
    expect(withCount.footer).toContain("RESULTS FILTERED BY YOUR ACCESS");
    expect(withCount.footer).toContain("3");
  });

  it("maps Timer chip start / pause / resume / stop and keeps one amber while running", () => {
    expect(timerChipCommands("idle")).toEqual({ primary: "start", stop: null });
    expect(timerChipCommands("running")).toEqual({ primary: "pause", stop: "stop" });
    expect(timerChipCommands("paused")).toEqual({ primary: "resume", stop: "stop" });

    const running = timerChipModel({
      isRunning: true,
      isPaused: false,
      hasActiveEntry: true,
      displayDuration: 12,
      projectLabel: "Harbour Rebuild",
      taskLabel: "Import",
    });
    expect(running.holdsAmber).toBe(true);
    expect(running.appearance).toBe("running");
  });

  it("opens Ask or Notifications by replacing the other panel and keeps Timesheet approvals an honest empty", () => {
    expect(selectCommandPanel(null, "ask")).toBe("ask");
    expect(selectCommandPanel("ask", "notifications")).toBe("notifications");
    expect(selectCommandPanel("notifications", "ask")).toBe("ask");
    expect(selectCommandPanel("ask", "ask")).toBeNull();
    expect(selectCommandPanel("approvals", "notifications")).toBe("notifications");

    expect(EMPTY_TIMESHEET_APPROVALS.empty).toBe(true);
    for (const name of SAMPLE_NAMES) {
      expect(EMPTY_TIMESHEET_APPROVALS.copy).not.toContain(name);
      expect(EMPTY_TIMESHEET_APPROVALS.title).not.toContain(name);
    }
  });

  it("loads Notifications as a global inbox that names origin, or an honest empty", () => {
    const empty = composeNotifications({ notifications: [], now: new Date(2026, 8, 8, 12, 0, 0) });
    expect(empty.rows).toEqual([]);
    expect(empty.emptyCopy.toLowerCase()).toContain("notification");
    for (const name of SAMPLE_NAMES) {
      expect(empty.emptyCopy).not.toContain(name);
    }

    const live = composeNotifications({
      now: new Date(2026, 8, 8, 12, 52, 0),
      notifications: [
        {
          id: "n1",
          type: "mention",
          message: "Sam mentioned you on Harbour Rebuild",
          isRead: 0,
          createdAt: new Date(2026, 8, 8, 12, 41, 0),
          crmProjectId: "prj-live",
          workspace: { id: "ws-a", name: "Harbour View" },
        },
      ],
    });
    expect(live.rows).toHaveLength(1);
    expect(live.rows[0]).toMatchObject({
      kind: "MENTION",
      title: "Sam mentioned you on Harbour Rebuild",
      origin: "Harbour View",
      href: "/projects/prj-live",
    });
    expect(live.rows[0].when).toBe("12:41");
  });

  it("loads Ask as live answers with a source line, or an honest empty that honors Document Access", () => {
    const empty = composeAsk({ messages: [] });
    expect(empty.messages).toEqual([]);
    expect(empty.emptyCopy.toLowerCase()).toContain("workspace");
    expect(empty.emptyCopy.toLowerCase()).toContain("document access");
    for (const name of SAMPLE_NAMES) {
      expect(empty.emptyCopy).not.toContain(name);
    }

    const answered = composeAsk({
      messages: [
        { role: "user", content: "Where is budget?" },
        { role: "assistant", content: "62% consumed.", relevantDocs: 2 },
      ],
    });
    expect(answered.messages[1]?.source).toMatch(/workspace/i);
    expect(answered.messages[1]?.source?.toLowerCase()).not.toContain("restricted");
    expect(answered.footnote.toLowerCase()).toContain("restricted");
  });

  it("names Capability, Workspace condition, or seat capacity and never a generic permission denied", () => {
    expect(
      chromeRefusal({ kind: "capability", capability: "Billing", ownerName: "Sam Lee" }),
    ).toBe("You do not have the Billing Capability. Sam Lee (Owner) can grant it.");
    expect(
      chromeRefusal({
        kind: "workspace-condition",
        workspaceName: "Harbour View",
        condition: "Read-only",
      }),
    ).toBe("Harbour View is read-only. Viewing, export, and recovery stay available.");
    // The refusal names the way out, not only the wall (#245, F3).
    expect(chromeRefusal({ kind: "seat", purchased: 4 })).toBe(
      "All 4 purchased seats are consumed. Add seats in Administration → Billing.",
    );
    expect(chromeRefusal({ kind: "generic", message: "permission denied" }).toLowerCase()).not.toContain(
      "permission denied",
    );
  });

  it("opens a Capability refusal from the control that failed, not from a distant ancestor (#249)", () => {
    const invite = composeRefusalPlacement({ failedControlId: "invite", controlId: "invite" });
    expect(invite).toEqual({ open: true, align: "end", side: "bottom" });
    expect(composeRefusalPlacement({ failedControlId: "invite", controlId: "row-archive" }).open).toBe(false);
    expect(composeRefusalPlacement({ failedControlId: null, controlId: "invite" }).open).toBe(false);
  });

  it("enters and exits toasts from the same bottom edge, interruptible, with optional UNDO", () => {
    const toast = toastModel({ message: "Timer paused", undo: true });
    expect(toast.edge).toBe("bottom");
    expect(toast.undoLabel).toBe("UNDO");
    expect(toast.message).toBe("Timer paused");

    const motion = motionForSurface("toast");
    expect(motion.enterExit).toBe("standard");
    expect(motion.movement).toBe("allowed");

    const reduced = motionForSurface("toast", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule(".df-toast")).toMatch(/translateY\(100%\)|translateY\(0\)/);
    expect(css).toMatch(/\.df-toast[^{]*\{[^}]*@starting-style|@starting-style\s*\{[^}]*\.df-toast/);
    expect(rule('.df-toast[data-state="leaving"]')).toMatch(/translateY\(100%\)/);
    expect(reducedMotionCss()).toMatch(/\.df-toast[^{]*\{[^}]*transform:\s*none|translateX\(-50%\)/);
    expect(css).not.toMatch(/@keyframes[^{]*toast/);
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
