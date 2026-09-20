import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatInstanceRecord,
  instanceAlreadyRunningMessage,
  parseInstanceRecord,
  pidIsAlive,
  shouldQuitAsOrphan,
} from "../../desktop-agent/src/lib/processLifetime";

/**
 * #237. Ctrl+C on `npm run dev` / `dev:v2` killed electron-forge and returned
 * the prompt while the Electron main process kept heartbeating against
 * whatever host it booted on. A second launch then shared `agent-queue.json`
 * with the first. These are the decisions the main process makes so that
 * cannot happen again; the wiring is `main/index.ts` and `scripts/start-dev.js`.
 */

const pkgPath = path.resolve(
  import.meta.dirname,
  "../../desktop-agent/package.json",
);

describe("desktop agent process lifetime", () => {
  it("routes every forge start through the wrapper that kills Electron on Ctrl+C", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    const startScripts = Object.entries(pkg.scripts).filter(([, cmd]) =>
      cmd.includes("electron-forge start"),
    );
    expect(startScripts).toEqual([]);
    expect(pkg.scripts.dev).toContain("scripts/start-dev.js");
    expect(pkg.scripts["dev:v2"]).toContain("scripts/start-dev.js");
    const startDev = readFileSync(
      path.resolve(import.meta.dirname, "../../desktop-agent/scripts/start-dev.js"),
      "utf8",
    );
    expect(startDev).toContain("DOCUFLOW_DEV_PARENT_PID");
    expect(startDev).toContain('pkill -KILL -f "desktop-agent/node_modules/electron"');
  });

  it("does not treat a packaged Device, born under init, as orphaned", () => {
    expect(
      shouldQuitAsOrphan({
        packaged: true,
        launchParentPid: 1,
        currentParentPid: 1,
        launchParentAlive: true,
      }),
    ).toBe(false);
  });

  it("does not quit a packaged Device if its launcher pid later changes", () => {
    expect(
      shouldQuitAsOrphan({
        packaged: true,
        launchParentPid: 8841,
        currentParentPid: 1,
        launchParentAlive: false,
      }),
    ).toBe(false);
  });

  it("does not quit a dev agent whose electron-forge parent is still there", () => {
    expect(
      shouldQuitAsOrphan({
        packaged: false,
        launchParentPid: 4321,
        currentParentPid: 4321,
        launchParentAlive: true,
      }),
    ).toBe(false);
  });

  it("quits a dev agent once Ctrl+C has reparented it to init", () => {
    expect(
      shouldQuitAsOrphan({
        packaged: false,
        launchParentPid: 4321,
        currentParentPid: 1,
        launchParentAlive: false,
      }),
    ).toBe(true);
  });

  it("quits a dev agent whose launch parent is gone even if ppid has not moved yet", () => {
    expect(
      shouldQuitAsOrphan({
        packaged: false,
        launchParentPid: 4321,
        currentParentPid: 4321,
        launchParentAlive: false,
      }),
    ).toBe(true);
  });

  it("does not quit a dev agent that was itself started under init", () => {
    expect(
      shouldQuitAsOrphan({
        packaged: false,
        launchParentPid: 1,
        currentParentPid: 1,
        launchParentAlive: true,
      }),
    ).toBe(false);
  });

  it("treats ESRCH as dead and EPERM as alive", () => {
    const esrch = Object.assign(new Error("No such process"), { code: "ESRCH" });
    const eperm = Object.assign(new Error("Operation not permitted"), { code: "EPERM" });
    expect(
      pidIsAlive(99, () => {
        throw esrch;
      }),
    ).toBe(false);
    expect(
      pidIsAlive(1, () => {
        throw eperm;
      }),
    ).toBe(true);
    expect(pidIsAlive(7, () => true)).toBe(true);
    expect(pidIsAlive(0)).toBe(false);
  });

  it("tells the operator which host the running agent is already on", () => {
    expect(
      instanceAlreadyRunningMessage({
        runningApiBase: "https://from-running.invalid",
        thisApiBase: "http://localhost:5000",
      }),
    ).toBe(
      "A DocuFlow desktop agent is already running against https://from-running.invalid. " +
        "This launch wanted http://localhost:5000. " +
        "Two agents must not share agent-queue.json. Stop the running agent first.",
    );
  });

  it("still refuses a second instance aimed at the same host", () => {
    expect(
      instanceAlreadyRunningMessage({
        runningApiBase: "http://localhost:5000",
        thisApiBase: "http://localhost:5000",
      }),
    ).toBe(
      "A DocuFlow desktop agent is already running against http://localhost:5000. " +
        "Stop it before launching another.",
    );
  });

  it("refuses a second instance even when the running host is not yet recorded", () => {
    expect(
      instanceAlreadyRunningMessage({
        runningApiBase: null,
        thisApiBase: "http://localhost:5000",
      }),
    ).toBe(
      "A DocuFlow desktop agent is already running. Stop it before launching another.",
    );
  });

  it("round-trips the instance record the second launch reads", () => {
    const raw = formatInstanceRecord({ pid: 18842, apiBase: "http://localhost:5000" });
    expect(parseInstanceRecord(raw)).toEqual({
      pid: 18842,
      apiBase: "http://localhost:5000",
    });
    expect(parseInstanceRecord("{not json")).toBeNull();
    expect(parseInstanceRecord(JSON.stringify({ pid: 1 }))).toBeNull();
  });
});
