/**
 * The start of a Timer as the web and the desktop agent send it (#400,
 * ADR-0031): the mode they ask for, and the answer to a refused start. One
 * place, so both routes read and refuse a start the same way.
 */

import type { Response } from "express";
import { timerStartModes, type TimerCommandPayload, type TimerStartMode } from "@shared/schema";
import { TimerStartRefusedError } from "./modules/time/commands";

/** The mode a start asks for: `switch` when it names none; null when it names something else. */
export function readStartMode(body: { mode?: unknown } | undefined): TimerStartMode | null {
  const mode = body?.mode ?? "switch";
  return timerStartModes.find((known) => known === mode) ?? null;
}

/** Recorded only for `add`: a start without a mode is a switch, so its payload stays as it always was. */
export function startModePayload(mode: TimerStartMode): Pick<TimerCommandPayload, "mode"> {
  return mode === "add" ? { mode } : {};
}

/** Answers a start the active Timers forbid with 409 and its reason; false for any other error. */
export function sendStartRefusal(res: Response, error: unknown): boolean {
  if (!(error instanceof TimerStartRefusedError)) return false;
  res.status(409).json({ code: error.code, message: error.message });
  return true;
}
