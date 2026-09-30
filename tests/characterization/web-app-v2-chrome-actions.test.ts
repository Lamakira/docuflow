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

  it("signs off Timer Commands in the one top-center v2 toast, not a bottom-edge host", () => {
    const timerSource = source("V2TimerChip.tsx");
    expect(timerSource).toContain('notify.success("Timer paused")');
    expect(timerSource).toContain('notify.success("Timer started")');
    expect(timerSource).toContain('notify.info("Choose a Project before starting the Timer.")');
    expect(timerSource).not.toContain("onToast");
    expect(source("V2Shell.tsx")).not.toMatch(/V2ToastHost|showToast/);
    expect(css).not.toMatch(/\.df-toast\[data-state/);
    expect(css).not.toMatch(/@keyframes[^{]*toast/);
  });
});

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function source(file: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", file), "utf8");
}

describe("the command bar search shrinks with the window", () => {
  const commandBar = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2CommandBar.tsx"),
    "utf8",
  );

  // The command bar is at least the desktop content width (1060px); below the
  // mobile breakpoint the app bar replaces it. So the label only needs to give way.
  it("keeps its label on one line, cut with an ellipsis, instead of wrapping", () => {
    expect(rule(".df-search")).toMatch(/min-width:\s*0/);
    expect(rule(".df-search-label")).toMatch(/white-space:\s*nowrap/);
    expect(rule(".df-search-label")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(".df-search-label")).toMatch(/overflow:\s*hidden/);
    expect(commandBar).toContain('<span className="df-search-label">Search {workspaceName}</span>');
    // A cut label still leaves the button its whole name.
    expect(commandBar).toContain("aria-label={`Search ${workspaceName}`}");
  });
});
