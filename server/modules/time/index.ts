import { timePersistence, type TimePersistence } from "./persistence";

export type { TimePersistence };
export { timePersistence };
export { applyTimerCommand, listTimerCommands, nextTimerSequence } from "./commands";
export type { ApplyTimerCommandInput, ApplyTimerCommandResult } from "./commands";
export { getAllowedTimezones, upsertAllowedTimezones } from "./schedule";

export const TIME_TABLES = ["time_entries", "timer_commands"] as const;

export const timeModule = {
  id: "time",
  name: "Time",
  tables: TIME_TABLES,
  persistence: timePersistence,
} as const;
