/**
 * Timer Command ingest (#117, ADR-0009). Web and desktop submit the same
 * server-authoritative command: origin, per-origin sequence, claimed effective
 * time, Workspace scope. Duplicates apply once. Late arrivals rematerialize
 * command-sourced Time Entries; they are not rejected. Legacy entries stay
 * listed and are never given a synthesized command row.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";
import {
  MAX_SIMULTANEOUS_TIMERS,
  timeEntries,
  timerCommands,
  type TimeEntry,
  type TimerCommand,
  type TimerCommandKind,
  type TimerCommandPayload,
  type TimerStartMode,
} from "@shared/schema";
import { db, type Db } from "../../db";
import { inWorkspace, requireWorkspaceContext, runWithWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import { timeEntryWorkspaceForUser } from "../../workspaceLocators";
import { simultaneousTimersAllowed } from "../activity/policy";

export type TimeWriter = Pick<Db, "insert" | "select" | "update" | "delete">;
type TimeTransaction = TimeWriter & Pick<Db, "execute">;

/** Why a start was refused (ADR-0031). Nothing is recorded for a refused start. */
export type TimerStartRefusal =
  | "simultaneous_timers_off"
  | "timer_limit"
  | "task_has_timer"
  | "project_has_timer"
  | "timer_in_other_workspace";

const REFUSAL_MESSAGES: Record<TimerStartRefusal, string> = {
  simultaneous_timers_off: "This Workspace runs one Timer at a time. Switch to this Timer instead.",
  timer_limit: `You already run ${MAX_SIMULTANEOUS_TIMERS} Timers. Stop one before adding another.`,
  task_has_timer: "A Timer already runs on this Task.",
  project_has_timer: "A Timer without a Task already occupies this Project, or this Project already has a Timer.",
  timer_in_other_workspace: "A Timer runs in another Workspace. Stop it before starting one here.",
};

export class TimerStartRefusedError extends Error {
  readonly statusCode = 409;
  constructor(readonly code: TimerStartRefusal) {
    super(REFUSAL_MESSAGES[code]);
    this.name = "TimerStartRefusedError";
  }
}

export function startModeOf(payload: TimerCommandPayload): TimerStartMode {
  return payload.mode === "add" ? "add" : "switch";
}

export interface ApplyTimerCommandInput {
  userId: string;
  origin: string;
  sequence: number;
  kind: TimerCommandKind;
  claimedEffectiveAt: Date;
  receivedAt?: Date;
  payload: TimerCommandPayload;
  /**
   * Floor the claim at the target entry's start and at that Timer's latest
   * Timer Command (#333, ADR-0030, ADR-0031). A device dates a pause or stop
   * when the Member left; the floor keeps that claim from reaching back across
   * a start or resume the server already applied to that Timer, and keeps it an
   * incremental apply. Another Timer's later start does not raise it. Without a
   * target entry, the floor is the User's latest command, as before.
   */
  floorAtLastCommand?: boolean;
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

/**
 * Time Entry by id, ignoring Active Workspace. Ownership is checked at the HTTP boundary.
 * The Active Workspace is read first, so another User's entry there still answers 403. Past
 * it, only the caller's own entries are located: another User's entry in another Workspace
 * answers 404, so no existence signal crosses tenants.
 */
export async function loadTimeEntryById(id: string, userId: string): Promise<TimeEntry | undefined> {
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  if (entry) return entry;
  const workspaceId = await timeEntryWorkspaceForUser(id, userId);
  if (!workspaceId) return undefined;
  return runWithWorkspaceContext({ workspaceId, userId }, async () => {
    const [found] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
    return found;
  });
}

export function inTimeEntryWorkspace<T>(entry: TimeEntry, fn: () => T): T {
  return runWithWorkspaceContext({ workspaceId: entry.workspaceId, userId: entry.userId }, fn);
}

export async function listTimerCommands(userId: string): Promise<TimerCommand[]> {
  requireWorkspaceContext();
  return db
    .select()
    .from(timerCommands)
    .where(and(eq(timerCommands.userId, userId), inWorkspace(timerCommands)))
    .orderBy(asc(timerCommands.claimedEffectiveAt), asc(timerCommands.sequence));
}

/** The partial unique indexes that allow one active Timer per Task, and per Project without a Task. */
const ACTIVE_TIMER_INDEXES = [
  "idx_time_entries_one_active_timer_per_task",
  "idx_time_entries_one_taskless_timer_per_project",
];

/** A race with another start of the same User's Timer (#307). */
function isActiveTimerRace(error: unknown): boolean {
  for (let current = error as { code?: string; constraint?: string; cause?: unknown } | undefined; current; ) {
    if (current.code === "23505" && ACTIVE_TIMER_INDEXES.includes(current.constraint ?? "")) return true;
    current = current.cause as typeof current;
  }
  return false;
}

/**
 * Every Timer Command of one User applies under that User's lock, across
 * Workspaces: the cap of three, a task-less Timer occupying its Project and the
 * single Workspace cannot be an index (ADR-0031), so two starts must not both
 * read "room for one more" (#307). The indexes stay as the last guard; a start
 * that still meets one runs again and is checked again.
 */
const TIMER_RACE_ATTEMPTS = 3;

export async function applyTimerCommand(
  input: ApplyTimerCommandInput
): Promise<ApplyTimerCommandResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await applyTimerCommandOnce(input);
    } catch (error) {
      if (attempt < TIMER_RACE_ATTEMPTS && isActiveTimerRace(error)) continue;
      throw error;
    }
  }
}

async function applyTimerCommandOnce(
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
    await lockUserTimers(tx, input.userId);

    const stored = await findCommand(tx, input.origin, input.sequence);
    if (stored) {
      const timeEntry = await loadTimeEntry(tx, stored.timeEntryId);
      return { duplicate: true, command: stored, timeEntry };
    }
    if (input.kind === "start") await assertStartAllowed(tx, input);

    if (input.floorAtLastCommand) {
      const floor = await claimFloor(tx, input);
      if (floor && claimedEffectiveAt.getTime() < floor.getTime()) {
        claimedEffectiveAt = floor;
        clamped = true;
      }
    }

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

async function lockUserTimers(tx: TimeTransaction, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`docuflow:timer:${userId}`}, 0))`);
}

async function findCommand(writer: TimeWriter, origin: string, sequence: number): Promise<TimerCommand | undefined> {
  const [existing] = await writer
    .select()
    .from(timerCommands)
    .where(and(eq(timerCommands.origin, origin), eq(timerCommands.sequence, sequence), inWorkspace(timerCommands)));
  return existing;
}

/**
 * Refuses a start the Timers already active forbid (ADR-0031): one running in
 * another Workspace, whatever the mode; and for `add`, the option off, a fourth
 * Timer, a second on the same Task, or one beside a Timer that occupies the
 * whole Project. Checked at ingest only: a replay applies what was recorded.
 */
async function assertStartAllowed(tx: TimeTransaction, input: ApplyTimerCommandInput): Promise<void> {
  const { workspaceId } = requireWorkspaceContext();
  const located = await tx.execute(sql`SELECT * FROM app_active_time_entries_for_user(${input.userId})`);
  const rows = located.rows as Array<{ workspace_id: string }>;
  if (rows.some((row) => row.workspace_id !== workspaceId)) {
    throw new TimerStartRefusedError("timer_in_other_workspace");
  }
  if (startModeOf(input.payload) !== "add") return;
  if (!(await simultaneousTimersAllowed())) throw new TimerStartRefusedError("simultaneous_timers_off");

  const active = await loadActiveTimers(tx, input.userId);
  if (active.length >= MAX_SIMULTANEOUS_TIMERS) throw new TimerStartRefusedError("timer_limit");
  const taskId = input.payload.taskId ?? null;
  if (taskId !== null && active.some((entry) => entry.taskId === taskId)) {
    throw new TimerStartRefusedError("task_has_timer");
  }
  const projectId = input.payload.crmProjectId;
  if (active.some((entry) => occupiesSameProject(entry, projectId, taskId))) {
    throw new TimerStartRefusedError("project_has_timer");
  }
}

/** A Timer without a Task occupies its whole Project; so does a new one without a Task. */
function occupiesSameProject(
  entry: { crmProjectId: string; taskId: string | null },
  crmProjectId: string | undefined,
  taskId: string | null,
): boolean {
  return entry.crmProjectId === crmProjectId && (entry.taskId === null || taskId === null);
}

function conflictsWith(
  entry: { crmProjectId: string; taskId: string | null },
  crmProjectId: string | undefined,
  taskId: string | null,
): boolean {
  return (taskId !== null && entry.taskId === taskId) || occupiesSameProject(entry, crmProjectId, taskId);
}

/** The earliest a floored claim may take effect: the entry's start, or that Timer's latest Timer Command. */
async function claimFloor(writer: TimeWriter, input: ApplyTimerCommandInput): Promise<Date | undefined> {
  const entry = await loadTimeEntry(writer, input.payload.timeEntryId ?? null);
  const scope = entry
    ? and(eq(timerCommands.userId, input.userId), eq(timerCommands.timeEntryId, entry.id), inWorkspace(timerCommands))
    : and(eq(timerCommands.userId, input.userId), inWorkspace(timerCommands));
  const [latest] = await writer
    .select({ at: timerCommands.claimedEffectiveAt })
    .from(timerCommands)
    .where(scope)
    .orderBy(desc(timerCommands.claimedEffectiveAt))
    .limit(1);
  const candidates = [latest?.at, entry?.startTime].filter((d): d is Date => !!d);
  if (candidates.length === 0) return undefined;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
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

/**
 * Late when a command already applied comes after it and touches the same
 * Timer (ADR-0031): a command on that Timer, or a switch, which stops every
 * Timer. A switch is late behind any later command; an add only behind a later
 * switch. A command that names no Timer is judged against every command.
 */
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
  const later = others.filter((other) => commandOrder(command, other) < 0);
  if (later.length === 0) return false;
  const isSwitch = (other: TimerCommand) => other.kind === "start" && startModeOf(other.payload) === "switch";
  if (command.kind === "start") {
    return startModeOf(command.payload) === "switch" || later.some(isSwitch);
  }
  const target = command.payload.timeEntryId ?? command.timeEntryId;
  if (!target) return true;
  return later.some(
    (other) => isSwitch(other) || other.timeEntryId === target || other.payload.timeEntryId === target,
  );
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
  // Negative when heartbeats accrued past a pause dated earlier (#333): that time is taken back.
  const elapsed = Math.floor((at.getTime() - lastActivity.getTime()) / 1000);
  await writer
    .update(timeEntries)
    .set({
      status: "paused",
      duration: Math.max(0, (entry.duration || 0) + elapsed),
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
  const payload = command.payload;
  const taskId = payload.taskId ?? null;
  const switching = startModeOf(payload) === "switch";
  // An add was checked at ingest; a conflict left is stopped so the indexes hold.
  for (const active of await loadActiveTimers(writer, command.userId)) {
    if (switching || conflictsWith(active, payload.crmProjectId, taskId)) {
      await stopEntry(writer, active, at);
    }
  }

  const entryId = command.timeEntryId ?? randomUUID();
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

/** The latest active Timer: the one a command that names none addresses. */
async function loadActiveTimer(writer: TimeWriter, userId: string): Promise<TimeEntry | undefined> {
  const [entry] = await loadActiveTimers(writer, userId);
  return entry;
}

/** This User's running and paused Timers in the current Workspace, newest first. */
async function loadActiveTimers(writer: TimeWriter, userId: string): Promise<TimeEntry[]> {
  return writer
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        or(eq(timeEntries.status, "running"), eq(timeEntries.status, "paused")),
        inWorkspace(timeEntries)
      )
    )
    .orderBy(desc(timeEntries.startTime), desc(timeEntries.id));
}

async function stopEntry(writer: TimeWriter, entry: TimeEntry, at: Date): Promise<void> {
  let duration = entry.duration || 0;
  if (entry.status === "running" && entry.lastActivityAt) {
    duration += Math.floor((at.getTime() - entry.lastActivityAt.getTime()) / 1000);
  }
  // A paused entry ends when it was paused, so a pause left overnight is not a worked span (#330).
  const endAt = entry.status === "paused" ? (entry.lastActivityAt ?? at) : at;
  const endTime = endAt.getTime() < entry.startTime.getTime() ? entry.startTime : endAt;
  // The row changed when the stop happened, even when the entry ends earlier.
  const updatedAt = at.getTime() < endTime.getTime() ? endTime : at;
  await writer
    .update(timeEntries)
    .set({ status: "stopped", endTime, duration: Math.max(0, duration), updatedAt })
    .where(timeEntryWhere(entry.id));
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
  const desiredActiveIds = new Set(
    desired.filter((row) => row.status === "running" || row.status === "paused").map((row) => row.id)
  );
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
    if (desiredActiveIds.has(row.id)) continue;
    await stopEntry(writer, row, closeAt);
  }

  const existing = await writer
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), eq(timeEntries.provenance, "command"), inWorkspace(timeEntries)));

  for (const row of desired) {
    const current = existing.find((entry) => entry.id === row.id);
    if (current) {
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
    } else {
      await writer.insert(timeEntries).values(stampWorkspace(row));
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
  // Newest last; several when Timers were added beside one another (ADR-0031).
  let active: DesiredEntry[] = [];

  const close = (entry: DesiredEntry, at: Date, status: "stopped" | "paused") => {
    let duration = entry.duration;
    // A paused entry ends at its pause time (#330); lastActivityAt stays the pause time.
    const wasPaused = entry.status === "paused";
    if (entry.status === "running") {
      duration += Math.floor((at.getTime() - entry.lastActivityAt.getTime()) / 1000);
    }
    if (status === "paused") {
      entry.status = "paused";
      entry.duration = duration;
      entry.lastActivityAt = at;
      entry.endTime = null;
      return;
    }
    entry.status = "stopped";
    entry.duration = duration;
    const endAt = wasPaused ? entry.lastActivityAt : at;
    entry.endTime = endAt;
    entry.lastActivityAt = endAt;
    completed.push(entry);
    active = active.filter((other) => other !== entry);
  };

  for (const command of commands) {
    const at = command.claimedEffectiveAt;
    const payload = command.payload;
    switch (command.kind) {
      case "start": {
        const taskId = payload.taskId ?? null;
        const switching = startModeOf(payload) === "switch";
        for (const entry of [...active]) {
          if (switching || conflictsWith(entry, payload.crmProjectId, taskId)) close(entry, at, "stopped");
        }
        const started: DesiredEntry = {
          id: command.timeEntryId ?? command.id,
          userId: command.userId,
          crmProjectId: payload.crmProjectId!,
          taskId,
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
        active.push(started);
        commandEntryIds.set(command.id, started.id);
        break;
      }
      case "pause": {
        const target = replayTarget(payload, active, completed);
        if (target) commandEntryIds.set(command.id, target.id);
        if (target && active.includes(target) && target.status === "running") close(target, at, "paused");
        break;
      }
      case "resume": {
        const target = replayTarget(payload, active, completed);
        if (target) commandEntryIds.set(command.id, target.id);
        if (target && active.includes(target) && target.status === "paused") {
          if (!payload.discardIdleTime) {
            target.idleTime += Math.floor((at.getTime() - target.lastActivityAt.getTime()) / 1000);
          }
          target.status = "running";
          target.lastActivityAt = at;
        }
        break;
      }
      case "stop": {
        const target = replayTarget(payload, active, completed);
        if (target) commandEntryIds.set(command.id, target.id);
        if (target && active.includes(target)) close(target, at, "stopped");
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

  completed.push(...active);
  return { entries: completed, commandEntryIds };
}

/** The named Timer; a command that names none addresses the latest active one. */
function replayTarget(
  payload: TimerCommandPayload,
  active: DesiredEntry[],
  completed: DesiredEntry[]
): DesiredEntry | undefined {
  const id = payload.timeEntryId;
  if (!id) return active[active.length - 1];
  return active.find((entry) => entry.id === id) ?? completed.find((entry) => entry.id === id);
}
