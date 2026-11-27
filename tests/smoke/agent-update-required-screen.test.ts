import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentState, TimerState } from "../../desktop-agent/src/renderer/app/types";

/**
 * #398: the agent's v2 "update required" screen. No DOM in this suite, so the
 * screen is rendered to markup from the state the main process pushes; the
 * click on Download is checked in the UI harness (`?scenario=update-required`).
 */

const agent = vi.hoisted(() => ({ state: null as AgentState | null }));

vi.mock("../../desktop-agent/src/renderer/app/stores/AgentContext", () => ({
  useAgent: () => ({ state: { agentState: agent.state } }),
}));
// Reads `window.agentBridge` while rendering; the window buttons are not under test.
vi.mock("../../desktop-agent/src/renderer/app-v2/components/WindowControls", () => ({
  WindowControls: () => null,
}));

import { UpdateRequiredPage } from "../../desktop-agent/src/renderer/app-v2/pages/UpdateRequiredPage";

// The page's JSX takes React from desktop-agent's own install when there is one
// (local), and from the root when not (CI installs the root only). Render with
// that same copy: two Reacts refuse each other's elements.
const fromPage = createRequire(path.resolve(import.meta.dirname, "../../desktop-agent/src/renderer/app-v2/pages/UpdateRequiredPage.tsx"));
const { createElement } = fromPage("react") as typeof import("react");
const { renderToStaticMarkup } = fromPage("react-dom/server") as typeof import("react-dom/server");

const running: TimerState = {
  status: "running",
  elapsed: 600,
  elapsedToday: 600,
  workedToday: 600,
  thisSession: 600,
  dayKey: "Fri Nov 27 2026",
  entryId: "entry-1",
  taskId: "task-1",
  projectName: "Northwind",
  taskName: "Ledger rebuild",
  description: null,
};

const stopped: TimerState = { ...running, status: "stopped", entryId: null, taskId: null, taskName: null, projectName: null };

function render(overrides: Partial<AgentState>): string {
  agent.state = {
    isPaired: true,
    deviceName: "Workstation",
    userEmail: "member@example.com",
    apiHost: "docuflow.example.com",
    apiBase: "https://docuflow.example.com",
    apiBaseSource: "build",
    timer: running,
    updateRequired: { minProtocolVersion: 2, downloadUrl: "https://docuflow.example.com/downloads/linux" },
    ...overrides,
  };
  return renderToStaticMarkup(createElement(UpdateRequiredPage));
}

describe("agent update required screen (#398)", () => {
  it("says what happened, offers the download and names the version it needs", () => {
    const html = render({});
    expect(html).toContain("Update required");
    expect(html).toContain("This version of DocuFlow Agent is no longer supported.");
    expect(html).toContain("Download update");
    expect(html).toContain("Needs agent protocol 2 or later");
    expect(html).toContain("Tracking is stopped");
  });

  it("says a running Timer is still running on the server and can be stopped from the web app", () => {
    const html = render({});
    expect(html).toContain("Your Timer is still running");
    expect(html).toContain("Ledger rebuild (Northwind) keeps counting on the server.");
    expect(html).toContain("stop it from the DocuFlow web app");
  });

  it("says nothing about a Timer when none is running", () => {
    const html = render({ timer: stopped });
    expect(html).not.toContain("Your Timer");
    expect(html).toContain("Tracking is stopped");
  });

  it("leaves out the version line when the server sent none", () => {
    const html = render({ updateRequired: { minProtocolVersion: null, downloadUrl: "https://docuflow.example.com/downloads/linux" } });
    expect(html).not.toContain("Needs agent protocol");
  });

  it("points at the web app when this system has no installer", () => {
    const html = render({ updateRequired: { minProtocolVersion: 2, downloadUrl: null } });
    expect(html).not.toContain("Download update");
    expect(html).toContain("Open web app");
  });

  it("renders nothing once the state clears", () => {
    expect(render({ updateRequired: null })).toBe("");
  });
});
