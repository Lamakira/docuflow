/**
 * Start, with ADR-0031's add-or-switch question.
 *
 * With Simultaneous Timers on and a Timer already active, Start asks whether to
 * add this Timer beside the others or switch to it (stopping them). With the
 * option off, or nothing running, Start switches at once, as it always did.
 * Each screen that starts a Timer calls `useStartTimer()`, uses `start` in
 * place of `handleStart`, and renders `dialog` once.
 */

import { useState, type ReactNode } from "react";
import { useTimeTracker } from "@/contexts/TimeTrackerContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { notify } from "./notify";
import { useReturnFocus } from "./returnFocus";
import { addConflictLine, startChoice, switchStopsLine, type StartChoice } from "./time";

type PendingStart = { projectId?: string; taskId?: string; choice: Extract<StartChoice, { kind: "ask" }> };

export function useStartTimer(): {
  /** Resolves true when the Timer started; false when refused, or when the question was opened. */
  start: (projectId?: string, taskId?: string) => Promise<boolean>;
  dialog: ReactNode;
} {
  const { handleStart, simultaneousTimers, maxTimers, timers, projects, selectedProjectId, selectedTaskId } =
    useTimeTracker();
  const [pending, setPending] = useState<PendingStart | null>(null);
  // Kept after closing, so the dialog stays mounted while it closes and returns focus.
  const [shown, setShown] = useState<PendingStart["choice"] | null>(null);
  const [busy, setBusy] = useState(false);
  const open = pending !== null;
  const returnFocus = useReturnFocus(open);

  async function start(projectId?: string, taskId?: string): Promise<boolean> {
    // The Project and Task handleStart will use: the ones named, else the Timer's own.
    const pid = projectId || selectedProjectId;
    const tid = taskId || (pid === selectedProjectId ? selectedTaskId : "") || null;
    const choice = startChoice({
      simultaneousTimers,
      maxTimers,
      activeCount: timers.length,
      conflictLine: pid ? addConflictLine(timers, pid, tid) : null,
    });
    if (choice.kind === "switch") return handleStart(projectId, taskId);
    setPending({ projectId, taskId, choice });
    setShown(choice);
    return false;
  }

  async function confirm(mode: "add" | "switch") {
    if (!pending || busy) return;
    setBusy(true);
    const started = await handleStart(pending.projectId, pending.taskId, mode);
    setBusy(false);
    setPending(null);
    if (started) notify.success(mode === "add" ? "Timer added" : "Timer started");
  }

  const labels = timers.map((timer) => {
    const row = projects.find((item) => item.id === timer.crmProjectId);
    return row?.project?.name ?? "a Project";
  });

  const choice = shown;
  const dialog =
    choice ? (
      <Dialog open={open} onOpenChange={(next) => (!next && !busy ? setPending(null) : undefined)}>
        <DialogContent
          className="df-v2 df-alert df-form-dialog"
          data-testid="v2-start-choice"
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle className="df-form-dialog-title">A Timer is already running</DialogTitle>
            <DialogDescription className="df-form-dialog-copy">
              {choice.canAdd
                ? `Add this Timer beside ${timers.length === 1 ? "the one running" : "the others"}, or switch to it. `
                : `${choice.limitLine} `}
              {switchStopsLine(labels)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="df-form-dialog-actions">
            <DialogClose asChild>
              <Button variant="outline" type="button" className="df-btn" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant={choice.canAdd ? "outline" : "default"}
              type="button"
              className="df-btn"
              disabled={busy}
              onClick={() => confirm("switch")}
              data-testid="v2-start-choice-switch"
            >
              Switch
            </Button>
            {choice.canAdd ? (
              <Button
                variant="default"
                type="button"
                className="df-btn"
                disabled={busy}
                onClick={() => confirm("add")}
                data-testid="v2-start-choice-add"
              >
                Add Timer
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null;

  return { start, dialog };
}
