/**
 * Timer Command ingest (#117, ADR-0009). Web and desktop submit the same
 * server-authoritative command: origin, per-origin sequence, claimed effective
 * time, Workspace scope. Duplicates apply once. Late arrivals rematerialize
 * command-sourced Time Entries; they are not rejected. Legacy entries stay
 * listed and are never given a synthesized command row.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import {
  timeEntries,
  timerCommands,
  type TimeEntry,
  type TimerCommand,
  type TimerCommandKind,
  type TimerCommandPayload,
} from "@shared/schema";
import { db, type Db } from "../../db";
import { appendAllowlistedOutboxEvent } from "../../outbox";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";

export type TimeWriter = Pick<Db, "insert" | "select" | "update" | "delete">;

export interface ApplyTimerCommandInput {
  userId: string;
  origin: string;
  sequence: number;
  kind: TimerCommandKind;
  claimedEffectiveAt: Date;
  receivedAt?: Date;
  payload: TimerCommandPayload;
}

export interface ApplyTimerCommandResult {
  duplicate: boolean;
  command: TimerCommand;
  timeEntry?: TimeEntry;
}

export function nextTimerSequence(idempotencyKey?: string): number {
  if (!idempotencyKey) {
    return Number(process.hrtime.bigint() % BigInt("8000000000000000"));
  }
  return Number(BigInt(`0x${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 13)}`));
}

export async function listTimerCommands(userId: string): Promise<TimerCommand[]> {
  requireWorkspaceContext();
  return db
    .select()
    .from(timerCommands)
    .where(and(eq(timerCommands.userId, userId), inWorkspace(timerCommands)))
    .orderBy(asc(timerCommands.claimedEffectiveAt), asc(timerCommands.sequence));
}

export async function applyTimerCommand(
  input: ApplyTimerCommandInput
): Promise<ApplyTimerCommandResult> {
  requireWorkspaceContext();
  const receivedAt = input.receivedAt ?? new Date();
  let claimedEffectiveAt = input.claimedEffectiveAt;
  let clamped = false;
  if (claimedEffectiveAt.getTime() > receivedAt.getTime()) {
    claimedEffectiveAt = receivedAt;
    clamped = true;
  }

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(timerCommands)
      .values(
        stampWorkspace({
          userId: input.userId,
          origin: input.origin,
          sequence: input.sequence,
          kind: input.kind,
          claimedEffectiveAt,
          receivedAt,
          clamped,
          payload: input.payload,
        })
      )
      .onConflictDoNothing()
      .returning();

    if (!inserted) {
      const existing = await loadCommand(tx, input.origin, input.sequence);
      const timeEntry = await loadTimeEntry(tx, existing.timeEntryId);
      return { duplicate: true, command: existing, timeEntry };
    }

    const late = await isLateArrival(tx, inserted);
    if (late) {
      await rematerializeUser(tx, input.userId);
    } else {
      await applyIncremental(tx, inserted);
    }

    const [command] = await tx
      .select()
      .from(timerCommands)
      .where(timerCommandWhere(inserted.id));
    const timeEntry = await loadTimeEntry(tx, command.timeEntryId);
    return { duplicate: false, command, timeEntry };
  });
}

async function loadCommand(
  writer: TimeWriter,
  origin: string,
  sequence: number
): Promise<TimerCommand> {
  const [existing] = await writer
    .select()
    .from(timerCommands)
    .where(
      and(
        eq(timerCommands.origin, origin),
        eq(timerCommands.sequence, sequence),
        inWorkspace(timerCommands)
      )
    );
  if (!existing) {
    throw new Error(`Timer Command ${origin}#${sequence} was not stored`);
  }
  return existing;
}

async function loadTimeEntry(
  writer: TimeWriter,
  id: string | null
): Promise<TimeEntry | undefined> {
  if (!id) return undefined;
  const [entry] = await writer
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, id), inWorkspace(timeEntries)));
  return entry;
}

function timeEntryWhere(id: string) {
  return and(eq(timeEntries.id, id), inWorkspace(timeEntries));
}

function timerCommandWhere(id: string) {
  return and(eq(timerCommands.id, id), inWorkspace(timerCommands));
}

function commandOrder(a: TimerCommand, b: TimerCommand): number {
  const claimed = a.claimedEffectiveAt.getTime() - b.claimedEffectiveAt.getTime();
  if (claimed !== 0) return claimed;
  const received = a.receivedAt.getTime() - b.receivedAt.getTime();
  if (received !== 0) return received;
  return a.sequence - b.sequence;
}

async function isLateArrival(writer: TimeWriter, command: TimerCommand): Promise<boolean> {
  const others = await writer
    .select()
    .from(timerCommands)
    .where(
      and(
        eq(timerCommands.userId, command.userId),
        ne(timerCommands.id, command.id),
        inWorkspace(timerCommands)
      )
    );
  return others.some((other) => commandOrder(command, other) < 0);
}

async function applyIncremental(writer: TimeWriter, command: TimerCommand): Promise<void> {
  switch (command.kind) {
    case "start":
      await startFromCommand(writer, command);
      return;
    case "pause":
      await pauseFromCommand(writer, command);
      return;
    case "resume":
      await resumeFromCommand(writer, command);
      return;
    case "stop":
      await stopFromCommand(writer, command);
      return;
    case "adjust":
      await adjustFromCommand(writer, command);
      return;
    default:
      throw new Error(`Unknown Timer Command kind: ${command.kind}`);
  }
}

async function loadTargetEntry(writer: TimeWriter, command: TimerCommand): Promise<TimeEntry | undefined> {
  const fromPayload = await loadTimeEntry(writer, command.payload.timeEntryId ?? command.timeEntryId);
  if (fromPayload) return fromPayload;
  return loadActiveTimer(writer, command.userId);
}

async function pauseFromCommand(writer: TimeWriter, command: TimerCommand): Promise<void> {
  const entry = await loadTargetEntry(writer, command);
  if (!entry || entry.status !== "running") return;
  const at = command.claimedEffectiveAt;
  const lastActivity = entry.lastActivityAt || entry.startTime;
  const elapsed = Math.floor((at.getTime() - lastActivity.getTime()) / 1000);
  await writer
    .update(timeEntries)
    .set({
      status: "paused",
      duration: (entry.duration || 0) + elapsed,
      lastActivityAt: at,
      updatedAt: at,
    })
    .where(timeEntryWhere(entry.id));
  await writer
    .update(timerCommands)
    .set({ timeEntryId: entry.id })
    .where(timerCommandWhere(command.id));
}

async function resumeFromCommand(writer: TimeWriter, command: TimerCommand): Promise<void> {
  const entry = await loadTargetEntry(writer, command);
  if (!entry || entry.status !== "paused") return;
  const at = command.claimedEffectiveAt;
  let idleTime = entry.idleTime || 0;
  if (!command.payload.discardIdleTime && entry.lastActivityAt) {
    idleTime += Math.floor((at.getTime() - entry.lastActivityAt.getTime()) / 1000);
  }
  await writer
    .update(timeEntries)
    .set({
      status: "running",
      idleTime,
      lastActivityAt: at,
      updatedAt: at,
    })
    .where(timeEntryWhere(entry.id));
  await writer
    .update(timerCommands)
    .set({ timeEntryId: entry.id })
    .where(timerCommandWhere(command.id));
}

async function stopFromCommand(writer: TimeWriter, command: TimerCommand): Promise<void> {
  const entry = await loadTargetEntry(writer, command);
  if (!entry || entry.status === "stopped") return;
  await stopEntry(writer, entry, command.claimedEffectiveAt);
  await writer
    .update(timerCommands)
    .set({ timeEntryId: entry.id })
    .where(timerCommandWhere(command.id));
}

async function adjustFromCommand(writer: TimeWriter, command: TimerCommand): Promise<void> {
  const entry = await loadTargetEntry(writer, command);
  if (!entry) return;
  const payload = command.payload;
  await writer
    .update(timeEntries)
    .set({
      description: payload.description !== undefined ? payload.description : entry.description,
      crmProjectId: payload.crmProjectId ?? entry.crmProjectId,
      taskId: payload.taskId !== undefined ? payload.taskId : entry.taskId,
      updatedAt: command.claimedEffectiveAt,
    })
    .where(timeEntryWhere(entry.id));
  await writer
    .update(timerCommands)
    .set({ timeEntryId: entry.id })
    .where(timerCommandWhere(command.id));
}

async function startFromCommand(writer: TimeWriter, command: TimerCommand): Promise<TimeEntry> {
  const at = command.claimedEffectiveAt;
  const active = await loadActiveTimer(writer, command.userId);
  if (active) {
    await stopEntry(writer, active, at);
  }

  const entryId = command.timeEntryId ?? randomUUID();
  const payload = command.payload;
  const [entry] = await writer
    .insert(timeEntries)
    .values(
      stampWorkspace({
        id: entryId,
        userId: command.userId,
        crmProjectId: payload.crmProjectId!,
        taskId: payload.taskId ?? null,
        description: payload.description ?? null,
        startTime: at,
        status: "running",
        lastActivityAt: at,
        duration: 0,
        idleTime: 0,
        provenance: "command",
        timerCommandId: command.id,
        clientCommandId: payload.clientCommandId ?? null,
      })
    )
    .returning();

  await writer
    .update(timerCommands)
    .set({ timeEntryId: entry.id })
    .where(timerCommandWhere(command.id));
  return entry;
}

async function loadActiveTimer(writer: TimeWriter, userId: string): Promise<TimeEntry | undefined> {
  const [entry] = await writer
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        or(eq(timeEntries.status, "running"), eq(timeEntries.status, "paused")),
        inWorkspace(timeEntries)
      )
    )
    .orderBy(desc(timeEntries.startTime))
    .limit(1);
  return entry;
}

async function stopEntry(writer: TimeWriter, entry: TimeEntry, at: Date): Promise<void> {
  let duration = entry.duration || 0;
  if (entry.status === "running" && entry.lastActivityAt) {
    duration += Math.floor((at.getTime() - entry.lastActivityAt.getTime()) / 1000);
  }
  const endTime = at.getTime() < entry.startTime.getTime() ? entry.startTime : at;
  await writer
    .update(timeEntries)
    .set({ status: "stopped", endTime, duration: Math.max(0, duration), updatedAt: endTime })
    .where(timeEntryWhere(entry.id));
  if (entry.status !== "stopped") {
    await appendAllowlistedOutboxEvent(writer, {
      type: "time_entry.stopped",
      aggregateType: "time_entry",
      aggregateId: entry.id,
      payload: { timeEntryId: entry.id },
      occurredAt: endTime,
    });
  }
}

/**
 * Replay this User's Timer Commands in claimed-effective-time order and upsert
 * command-sourced Time Entries. Legacy rows are left listed and never given a
 * command id.
 */
async function rematerializeUser(writer: TimeWriter, userId: string): Promise<void> {
  const commands = await writer
    .select()
    .from(timerCommands)
    .where(and(eq(timerCommands.userId, userId), inWorkspace(timerCommands)))
    .orderBy(asc(timerCommands.claimedEffectiveAt), asc(timerCommands.receivedAt), asc(timerCommands.sequence));

  const { entries: desired, commandEntryIds } = replayCommands(commands);
  const desiredActiveId = desired.find(
    (row) => row.status === "running" || row.status === "paused"
  )?.id;
  const closeAt = commands[commands.length - 1]?.claimedEffectiveAt ?? new Date();

  const leftoverActives = await writer
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        or(eq(timeEntries.status, "running"), eq(timeEntries.status, "paused")),
        inWorkspace(timeEntries)
      )
    );
  for (const row of leftoverActives) {
    if (row.id === desiredActiveId) continue;
    await stopEntry(writer, row, closeAt);
  }

  const existing = await writer
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), eq(timeEntries.provenance, "command"), inWorkspace(timeEntries)));

  for (const row of desired) {
    const current = existing.find((entry) => entry.id === row.id);
    if (current) {
      const wasStopped = current.status === "stopped";
      await writer
        .update(timeEntries)
        .set({
          crmProjectId: row.crmProjectId,
          taskId: row.taskId,
          description: row.description,
          startTime: row.startTime,
          endTime: row.endTime,
          status: row.status,
          duration: row.duration,
          idleTime: row.idleTime,
          lastActivityAt: row.lastActivityAt,
          timerCommandId: row.timerCommandId,
          updatedAt: closeAt,
        })
        .where(timeEntryWhere(row.id));
      if (!wasStopped && row.status === "stopped") {
        await appendAllowlistedOutboxEvent(writer, {
          type: "time_entry.stopped",
          aggregateType: "time_entry",
          aggregateId: row.id,
          payload: { timeEntryId: row.id },
          occurredAt: row.endTime ?? closeAt,
        });
      }
    } else {
      await writer.insert(timeEntries).values(stampWorkspace(row));
      if (row.status === "stopped") {
        await appendAllowlistedOutboxEvent(writer, {
          type: "time_entry.stopped",
          aggregateType: "time_entry",
          aggregateId: row.id,
          payload: { timeEntryId: row.id },
          occurredAt: row.endTime ?? closeAt,
        });
      }
    }
    if (row.timerCommandId) {
      await writer
        .update(timerCommands)
        .set({ timeEntryId: row.id })
        .where(timerCommandWhere(row.timerCommandId));
    }
  }

  for (const [commandId, entryId] of commandEntryIds) {
    await writer
      .update(timerCommands)
      .set({ timeEntryId: entryId })
      .where(timerCommandWhere(commandId));
  }
}

interface DesiredEntry {
  id: string;
  userId: string;
  crmProjectId: string;
  taskId: string | null;
  description: string | null;
  startTime: Date;
  endTime: Date | null;
  status: string;
  duration: number;
  idleTime: number;
  lastActivityAt: Date;
  provenance: "command";
  timerCommandId: string;
  clientCommandId: string | null;
}

function replayCommands(commands: TimerCommand[]): {
  entries: DesiredEntry[];
  commandEntryIds: Map<string, string>;
} {
  const completed: DesiredEntry[] = [];
  const commandEntryIds = new Map<string, string>();
  let active: DesiredEntry | undefined;

  const closeActive = (at: Date, status: "stopped" | "paused") => {
    if (!active) return;
    let duration = active.duration;
    if (active.status === "running") {
      duration += Math.floor((at.getTime() - active.lastActivityAt.getTime()) / 1000);
    }
    if (status === "paused") {
      active.status = "paused";
      active.duration = duration;
      active.lastActivityAt = at;
      active.endTime = null;
      return;
    }
    active.status = "stopped";
    active.duration = duration;
    active.endTime = at;
    active.lastActivityAt = at;
    completed.push(active);
    active = undefined;
  };

  for (const command of commands) {
    const at = command.claimedEffectiveAt;
    const payload = command.payload;
    switch (command.kind) {
      case "start": {
        closeActive(at, "stopped");
        active = {
          id: command.timeEntryId ?? command.id,
          userId: command.userId,
          crmProjectId: payload.crmProjectId!,
          taskId: payload.taskId ?? null,
          description: payload.description ?? null,
          startTime: at,
          endTime: null,
          status: "running",
          duration: 0,
          idleTime: 0,
          lastActivityAt: at,
          provenance: "command",
          timerCommandId: command.id,
          clientCommandId: payload.clientCommandId ?? null,
        };
        commandEntryIds.set(command.id, active.id);
        break;
      }
      case "pause": {
        const target = replayTarget(payload, active, completed);
        if (target) commandEntryIds.set(command.id, target.id);
        if (target && active && target.id === active.id) closeActive(at, "paused");
        break;
      }
      case "resume": {
        const target = replayTarget(payload, active, completed);
        if (target) commandEntryIds.set(command.id, target.id);
        if (target && active && target.id === active.id && active.status === "paused") {
          if (!payload.discardIdleTime) {
            active.idleTime += Math.floor((at.getTime() - active.lastActivityAt.getTime()) / 1000);
          }
          active.status = "running";
          active.lastActivityAt = at;
        }
        break;
      }
      case "stop": {
        const target = replayTarget(payload, active, completed);
        if (target) commandEntryIds.set(command.id, target.id);
        if (target && active && target.id === active.id) closeActive(at, "stopped");
        break;
      }
      case "adjust": {
        const target = replayTarget(payload, active, completed);
        if (!target) break;
        commandEntryIds.set(command.id, target.id);
        if (payload.description !== undefined) target.description = payload.description ?? null;
        if (payload.crmProjectId) target.crmProjectId = payload.crmProjectId;
        if (payload.taskId !== undefined) target.taskId = payload.taskId ?? null;
        break;
      }
    }
  }

  if (active) completed.push(active);
  return { entries: completed, commandEntryIds };
}

function replayTarget(
  payload: TimerCommandPayload,
  active: DesiredEntry | undefined,
  completed: DesiredEntry[]
): DesiredEntry | undefined {
  const id = payload.timeEntryId;
  if (!id) return active;
  if (active?.id === id) return active;
  return completed.find((entry) => entry.id === id);
}
