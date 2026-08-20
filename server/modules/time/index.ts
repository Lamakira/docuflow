import type { TimePersistence } from "./persistence";

export type { TimePersistence };

export const TIME_TABLES = ["time_entries"] as const;

export const timeModule = {
  id: "time",
  name: "Time",
  tables: TIME_TABLES,
  persistence: {} as TimePersistence,
} as const;
