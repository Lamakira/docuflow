import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createFromTimerPanel } from "../../desktop-agent/src/lib/createFromTimerPanel";

/**
 * #397: in the agent's v2 Timer panel, creating a Task (or a Project, when the
 * Workspace has no Tasks) used to start the Timer on it. Creating now only
 * creates; starting stays its own gesture, a click on the row.
 *
 * The panel cannot be clicked through here (no DOM in this suite), so the create
 * step lives in `createFromTimerPanel`, and the panel is held to calling it and
 * nothing that starts the Timer.
 */

type Timer = { taskId: string | null; crmProjectId: string | null; status: "running" | "paused" | "stopped" };

/** The agent as the panel sees it: a Timer, plus the create and start calls. */
function fakeAgent(timer: Timer) {
  const state = { timer: { ...timer } };
  const startTimer = vi.fn(async (input: { crmProjectId: string; taskId?: string }) => {
    state.timer = { taskId: input.taskId ?? null, crmProjectId: input.crmProjectId, status: "running" };
    return { ok: true };
  });
  const createTask = vi.fn(async (data: { crmProjectId: string; name: string }) => ({
    ok: true,
    data: { id: "task-new", name: data.name, crmProjectId: data.crmProjectId },
  }));
  const createProject = vi.fn(async (data: { name: string }) => ({
    ok: true,
    data: { id: "project-new", name: data.name },
  }));
  return { state, startTimer, createTask, createProject };
}

const openProject = { id: "project-1", name: "Website" };

describe("creating from the agent's Timer panel does not start the Timer (#397)", () => {
  it("creates a Task and leaves the Timer running on the other Task", async () => {
    const agent = fakeAgent({ taskId: "task-other", crmProjectId: "project-1", status: "running" });

    const outcome = await createFromTimerPanel("Write the brief", openProject, agent);

    expect(agent.createTask).toHaveBeenCalledWith({ crmProjectId: "project-1", name: "Write the brief" });
    expect(outcome).toEqual({
      ok: true,
      kind: "task",
      task: { id: "task-new", name: "Write the brief", crmProjectId: "project-1" },
      toast: "Task “Write the brief” created",
    });
    expect(agent.startTimer).not.toHaveBeenCalled();
    expect(agent.state.timer).toEqual({ taskId: "task-other", crmProjectId: "project-1", status: "running" });
  });

  it("creates a Task and leaves a stopped Timer stopped", async () => {
    const agent = fakeAgent({ taskId: null, crmProjectId: null, status: "stopped" });

    const outcome = await createFromTimerPanel("Write the brief", openProject, agent);

    expect(outcome.ok).toBe(true);
    expect(agent.startTimer).not.toHaveBeenCalled();
    expect(agent.state.timer.status).toBe("stopped");
  });

  it("creates a Project (project-only Workspace) and leaves a stopped Timer stopped", async () => {
    const agent = fakeAgent({ taskId: null, crmProjectId: null, status: "stopped" });

    const outcome = await createFromTimerPanel("Acme rebrand", null, agent);

    expect(agent.createProject).toHaveBeenCalledWith({ name: "Acme rebrand" });
    expect(outcome).toEqual({
      ok: true,
      kind: "project",
      project: { id: "project-new", name: "Acme rebrand" },
      toast: "Project “Acme rebrand” created",
    });
    expect(agent.startTimer).not.toHaveBeenCalled();
    expect(agent.state.timer.status).toBe("stopped");
  });

  it("creates a Project and leaves the Timer running on the other Project", async () => {
    const agent = fakeAgent({ taskId: null, crmProjectId: "project-1", status: "running" });

    await createFromTimerPanel("Acme rebrand", null, agent);

    expect(agent.startTimer).not.toHaveBeenCalled();
    expect(agent.state.timer).toEqual({ taskId: null, crmProjectId: "project-1", status: "running" });
  });

  it("passes on the server's refusal, and says what failed when it gives no reason", async () => {
    const agent = fakeAgent({ taskId: null, crmProjectId: null, status: "stopped" });
    agent.createTask.mockResolvedValueOnce({ ok: false, error: "Name is too long" } as never);
    agent.createProject.mockResolvedValueOnce({ ok: false } as never);

    expect(await createFromTimerPanel("x", openProject, agent)).toEqual({ ok: false, error: "Name is too long" });
    expect(await createFromTimerPanel("x", null, agent)).toEqual({ ok: false, error: "Could not create the project" });
    agent.createTask.mockResolvedValueOnce({ ok: true } as never);
    expect(await createFromTimerPanel("x", openProject, agent)).toEqual({ ok: false, error: "Could not create the task" });
    expect(agent.startTimer).not.toHaveBeenCalled();
  });
});

describe("the v2 Timer panel's create form (#397)", () => {
  const panel = readFileSync("desktop-agent/src/renderer/app-v2/panels/TimerPanel.tsx", "utf8");
  const submitCreate = panel.match(/async function submitCreate[\s\S]*?\n  }\n/)?.[0] ?? "";

  it("creates through createFromTimerPanel and starts nothing", () => {
    expect(submitCreate).not.toBe("");
    expect(submitCreate).toContain("createFromTimerPanel(");
    expect(submitCreate).not.toMatch(/\bstart\(|startProject\(|startTimer\(/);
    expect(submitCreate).not.toContain("Tracking");
  });

  it("no longer describes creating as starting", () => {
    expect(panel).not.toContain("creating a task starts tracking it");
    expect(panel).not.toContain("creating a project starts tracking it");
  });

  it("does not open a Project created in a project-only Workspace", () => {
    // An opened Project shows a Task list and a `+` that creates a Task, which a
    // Workspace without Tasks has no use for.
    expect(submitCreate).toMatch(/if \(!projectOnly\) setOpenProjectId\(/);
  });
});
