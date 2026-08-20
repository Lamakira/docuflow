export type { TimePersistence } from "./persistence";

export const TIME_TABLES = ["time_entries"] as const;

export const timeModule = {
  id: "time",
  name: "Time",
  tables: TIME_TABLES,
  persistence: "TimePersistence",
} as const;
