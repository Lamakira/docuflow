/** The Analytics export: one CSV line per Time Entry. */

import type { DayCalendar } from "./dayCalendar";

export interface TimeExportRow {
  startTime: Date;
  /** Null while the entry is not stopped. */
  endTime: Date | null;
  userName: string;
  clientName: string | null;
  projectName: string | null;
  taskName: string | null;
  description: string | null;
  status: string;
  /** Inside the range. */
  seconds: number;
  idleSeconds: number;
  /**
   * This entry's part of its Member's Worked Time (ADR-0031): time it ran
   * beside other Timers is shared between them, so a Member's lines add up to
   * their Worked Time. Equal to `seconds` when nothing overlapped.
   */
  workedSeconds: number;
}

const COLUMNS = "Date,Start,End,Member,Client,Project,Task,Description,Status,Tracked (h),Idle (h),Worked (h)";

/** A cell that starts like a formula is kept as text, or a spreadsheet would run it. */
export function csvText(value: string | null): string {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

const hours = (seconds: number) => (seconds / 3600).toFixed(2);

/** Starts with the UTF-8 mark, without which Excel garbles the accents. */
export function timeExportCsv(rows: TimeExportRow[], calendar: DayCalendar): string {
  const lines = rows.map((row) =>
    [
      calendar.dayOf(row.startTime),
      calendar.clockOf(row.startTime),
      row.endTime ? calendar.clockOf(row.endTime) : "",
      csvText(row.userName),
      csvText(row.clientName),
      csvText(row.projectName),
      csvText(row.taskName),
      csvText(row.description),
      csvText(row.status),
      hours(row.seconds),
      hours(row.idleSeconds),
      hours(row.workedSeconds),
    ].join(",")
  );
  return "﻿" + [COLUMNS, ...lines].join("\r\n");
}
